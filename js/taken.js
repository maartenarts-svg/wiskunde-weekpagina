import { db, auth } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';
import { haalCache, wisCache, checkResetSignaal } from './appCache.js';
import { parseMarkdown, zorgCache as zorgTemplatesCache } from './templates.js';
import { laadDropdownData, cdFilter, cdKies, cdVerberg } from './doelen.js';
import { zorgCache as zorgHoofdstukkenCache } from './hoofdstukken.js';

// ===== STATE =====
let huidigeTaak = {};           // werkkopie doorheen de stappen
let bewerkId = null;            // Firestore doc-ID bij aanpassen
let isBewerkModus = false;
let huidigStap = 0;

// Per-stap state
let geselecteerdeVK = [];       // [{id, tekst, ...}]
let geselecteerdeSC = {
  leren: [],                    // [{id, tekst, ...}]
  eval: [],                     // [{id, tekst, ...}]
};
let alleDoelen = null;          // cache
let alleBronnen = null;         // cache
let geselecteerdeBronnen = [];  // [{id, label, ...}]
let templateData = null;        // {id, inhoud, parameters:{}, naam}

// ===== SCHOOLJAAR =====
function huidigSchooljaar() {
  const nu = new Date();
  const jaar = nu.getFullYear();
  return nu.getMonth() >= 6 ? `${jaar}-${jaar + 1}` : `${jaar - 1}-${jaar}`;
}

// ===== PASEN BEREKENING (Meeus/Jones/Butcher) =====
function berekenPasen(jaar) {
  const a = jaar % 19;
  const b = Math.floor(jaar / 100);
  const c = jaar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maand = Math.floor((h + l - 7 * m + 114) / 31); // 3=maart, 4=april
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jaar, maand - 1, dag);
}

// ===== VAKANTIEWEKEN BEREKENEN =====
function berekenVakantieWeken(schooljaar) {
  const [startJaar, eindJaar] = schooljaar.split('-').map(Number);
  const vakantieWeken = new Set(); // Set van 'YYYY-MM-DD' van maandagen

  function maandag(datum) {
    const d = new Date(datum);
    const dag = d.getDay();
    const diff = dag === 0 ? -6 : 1 - dag;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function voegWeekToe(datum) {
    vakantieWeken.add(maandag(datum).toISOString().slice(0, 10));
  }

  // Herfstvakantie: week van 1 november
  const nov1 = new Date(startJaar, 10, 1);
  voegWeekToe(nov1.getDay() === 0 ? new Date(startJaar, 10, 2) : nov1);

  // Kerstvakantie: 2 weken, start maandag van week met 25 dec
  const dec25 = new Date(startJaar, 11, 25);
  let kerstStart = maandag(dec25);
  if (dec25.getDay() === 6) kerstStart = new Date(startJaar + 1, 0, 0); // zondag → week na 25/12... maar zat = maandag erna
  if (dec25.getDay() === 6) { kerstStart = new Date(startJaar, 11, 28); kerstStart = maandag(kerstStart); }
  voegWeekToe(kerstStart);
  const kerstWeek2 = new Date(kerstStart); kerstWeek2.setDate(kerstStart.getDate() + 7);
  voegWeekToe(kerstWeek2);

  // Krokusvakantie: week van Aswoensdag (Pasen - 46 dagen)
  const pasen = berekenPasen(eindJaar);
  const aswoensdag = new Date(pasen); aswoensdag.setDate(pasen.getDate() - 46);
  voegWeekToe(aswoensdag);

  // Paasvakantie: 2 weken
  let paasStart;
  const april1 = new Date(eindJaar, 3, 1);
  if (pasen.getMonth() === 2) {
    // Pasen in maart → start maandag na Pasen
    paasStart = new Date(pasen); paasStart.setDate(pasen.getDate() + 1);
    paasStart = maandag(paasStart);
  } else if (pasen.getDate() > 15) {
    // Pasen na 15 april → tweede maandag vóór Pasen
    paasStart = maandag(pasen); paasStart.setDate(paasStart.getDate() - 7);
  } else {
    // Normaal: eerste maandag van april
    paasStart = maandag(april1);
    if (paasStart < april1) paasStart.setDate(paasStart.getDate() + 7);
  }
  voegWeekToe(paasStart);
  const paasWeek2 = new Date(paasStart); paasWeek2.setDate(paasStart.getDate() + 7);
  voegWeekToe(paasWeek2);

  // Zomervakantie: 1 juli t/m 31 augustus (meerdere weken)
  let zomerDatum = new Date(eindJaar, 6, 1);
  const zomerEinde = new Date(eindJaar, 8, 1);
  while (zomerDatum < zomerEinde) {
    voegWeekToe(zomerDatum);
    zomerDatum.setDate(zomerDatum.getDate() + 7);
  }

  return vakantieWeken;
}

// ===== SCHOOLWEKEN GENEREREN =====
function genereerSchoolweken(schooljaar) {
  const [startJaar, eindJaar] = schooljaar.split('-').map(Number);
  const vakantieWeken = berekenVakantieWeken(schooljaar);

  // Schooljaar start eerste september, einde 30 juni
  // Eerste week = week die de eerste schooldag van september bevat
  let datum = new Date(startJaar, 8, 1); // 1 september
  // Ga naar de maandag van die week
  const dag = datum.getDay();
  const diff = dag === 0 ? -6 : 1 - dag;
  datum.setDate(datum.getDate() + diff);

  const einde = new Date(eindJaar, 5, 30); // 30 juni
  const weken = [];
  let weekNr = 0;

  while (datum <= einde) {
    const sleutel = datum.toISOString().slice(0, 10);
    if (!vakantieWeken.has(sleutel)) {
      weekNr++;
      const zondag = new Date(datum); zondag.setDate(datum.getDate() + 6);
      weken.push({
        nr: weekNr,
        maandag: new Date(datum),
        zondag,
        label: `Week ${weekNr} — ${formatDatum(datum)} t/m ${formatDatum(zondag)}`
      });
    }
    datum.setDate(datum.getDate() + 7);
  }
  return weken;
}

function formatDatum(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ===== DOELEN CACHE =====
async function zorgDoelenCache() {
  if (!alleDoelen) alleDoelen = await haalCache('doelen', db);
  return alleDoelen;
}

async function zorgBronnenCache() {
  if (!alleBronnen) alleBronnen = await haalCache('bronnen', db);
  return alleBronnen;
}

// ===== STAP NAVIGATIE =====
const STAP_TITELS = ['Start', 'Coördinaten', 'Voorkennis', 'Succescriteria', 'Instructie', 'Bronnen', 'Indienen'];

export function initTaken() {
  toonStap(0);
}

function toonStap(nr) {
  huidigStap = nr;
  // Scope tot taak-formulier zodat andere .taak-stap elementen niet geraakt worden
  const formulier = document.getElementById('taak-formulier');
  if (!formulier) return;
  formulier.querySelectorAll('.taak-stap').forEach((s, i) => {
    s.style.display = i === nr ? 'block' : 'none';
  });
  // Voortgangsbalk
  formulier.querySelectorAll('.stap-indicator').forEach((el, i) => {
    el.classList.toggle('actief', i === nr);
    el.classList.toggle('klaar', i < nr);
  });
  // Knoppen
  document.getElementById('taak-vorige-knop').style.display = nr > 0 ? 'inline-flex' : 'none';
  document.getElementById('taak-volgende-knop').style.display = nr < 6 ? 'inline-flex' : 'none';
  document.getElementById('taak-voltooien-knop').style.display = nr === 6 ? 'inline-flex' : 'none';
  // Stap-specifieke init
  if (nr === 1) initStap1();
  if (nr === 2) initStap2();
  if (nr === 3) initStap3();
  if (nr === 4) initStap4();
  if (nr === 5) initStap5();
}

export function vorigeStap() {
  if (huidigStap > 0) toonStap(huidigStap - 1);
}

export function volgendeStap() {
  if (!valideerStap(huidigStap)) return;
  verzamelStapData(huidigStap);
  if (huidigStap < 6) toonStap(huidigStap + 1);
}

// ===== VALIDATIE =====
function valideerStap(nr) {
  const fout = (tekst) => { toonMelding('taken', tekst, 'fout'); return false; };

  if (nr === 0) {
    const keuze = document.querySelector('input[name="taak-start-keuze"]:checked');
    if (!keuze) return fout('Kies een optie om te starten.');
    return true;
  }

  if (nr === 1) {
    if (!document.getElementById('taak-code').value.trim()) return fout('Vul een code in.');
    if (!document.getElementById('taak-titel').value.trim()) return fout('Vul een titel in.');
    const type = document.getElementById('taak-type').value;
    if (type === 'taak') {
      const geselecteerdeRoutes = ['G', 'B', 'Z'].filter(r => document.getElementById('route-' + r)?.checked);
      const tijdKeuze = document.querySelector('input[name="tijd-keuze"]:checked')?.value || 'zelfde';
      if (tijdKeuze === 'verschilt' && geselecteerdeRoutes.length >= 2) {
        const ontbreekt = geselecteerdeRoutes.some(r => !document.querySelector(`.tijd-route-veld[data-route="${r}"]`)?.value.trim());
        if (ontbreekt) return fout('Vul de tijd in voor alle geselecteerde routes.');
      } else if (!document.getElementById('taak-tijd')?.value.trim()) {
        return fout('Vul de tijd in.');
      }
    }
    if (!document.getElementById('taak-klas').value) return fout('Kies een klas.');
    if (!document.getElementById('taak-lesweek').value) return fout('Kies een lesweek.');
    const routes = ['G', 'B', 'Z', 'geen'].filter(r => document.getElementById('route-' + r)?.checked);
    if (!routes.length) return fout('Kies minstens één route.');
    const fases = ['verkennen','verwerken','inprenten','evalueren','herhalen'].filter(f => document.getElementById('fase-' + f)?.checked);
    if (!fases.length) return fout('Kies minstens één leerprocesfase.');
    return true;
  }

  if (nr === 2) {
    const keuze = document.querySelector('input[name="vk-keuze"]:checked')?.value;
    if (!keuze) return fout('Kies voor "geen voorkennis" of "voorkennis nodig".');
    if (keuze === 'ja' && !geselecteerdeVK.length) return fout('Voeg minstens één voorkennis-doel toe.');
    return true;
  }

  if (nr === 3) {
    const heeftLeren = document.getElementById('sc-leren-actief')?.checked;
    const heeftEval = document.getElementById('sc-eval-actief')?.checked;
    if (!heeftLeren && !heeftEval) return fout('Activeer minstens één type succescriterium.');
    if (heeftLeren && !geselecteerdeSC.leren.length) return fout('Voeg minstens één "Wat leer je"-doel toe.');
    if (heeftEval && !geselecteerdeSC.eval.length) return fout('Voeg minstens één "Waarop geëvalueerd"-doel toe.');
    return true;
  }

  if (nr === 4) {
    if (!templateData) return fout('Voeg een instructie toe.');
    return true;
  }

  if (nr === 6) {
    const indienOpties = ['digitaal','map','vakje','anders'].filter(o => document.getElementById('indienen-' + o)?.checked);
    if (!indienOpties.length) return fout('Kies minstens één indienwijze.');
    return true;
  }

  return true;
}

// ===== DATA VERZAMELEN PER STAP =====
function verzamelStapData(nr) {
  if (nr === 0) {
    huidigeTaak.startKeuze = document.querySelector('input[name="taak-start-keuze"]:checked')?.value;
  }
  if (nr === 1) {
    const typeEl = document.getElementById('taak-type');
    const type = typeEl?.value || 'taak';
    huidigeTaak.code = document.getElementById('taak-code')?.value.trim() || '';
    huidigeTaak.titel = document.getElementById('taak-titel')?.value.trim() || '';
    huidigeTaak.type = type;
    if (type === 'les') {
      huidigeTaak.tijd = 'rooster';
      huidigeTaak.tijdVerschilt = false;
      huidigeTaak.tijdPerRoute = {};
    } else {
      const geselecteerdeRoutes = ['G', 'B', 'Z'].filter(r => document.getElementById('route-' + r)?.checked);
      const tijdKeuze = document.querySelector('input[name="tijd-keuze"]:checked')?.value || 'zelfde';
      if (tijdKeuze === 'verschilt' && geselecteerdeRoutes.length >= 2) {
        huidigeTaak.tijdVerschilt = true;
        huidigeTaak.tijd = '';
        const perRoute = {};
        document.querySelectorAll('.tijd-route-veld').forEach(el => { perRoute[el.dataset.route] = el.value.trim(); });
        huidigeTaak.tijdPerRoute = perRoute;
      } else {
        huidigeTaak.tijdVerschilt = false;
        huidigeTaak.tijd = document.getElementById('taak-tijd')?.value.trim() || '';
        huidigeTaak.tijdPerRoute = {};
      }
    }
    huidigeTaak.vak = document.getElementById('taak-vak')?.value || 'Wiskunde';
    huidigeTaak.klas = document.getElementById('taak-klas')?.value || '1a';
    huidigeTaak.schooljaar = document.getElementById('taak-schooljaar')?.value.trim() || huidigSchooljaar();
    huidigeTaak.lesweek = parseInt(document.getElementById('taak-lesweek')?.value) || null;
    huidigeTaak.omschrijving = document.getElementById('taak-omschrijving')?.value.trim() || '';
    huidigeTaak.tags = (document.getElementById('taak-tags')?.value.trim() || '').split(',').map(t => t.trim()).filter(Boolean);
    huidigeTaak.routes = ['G','B','Z','geen'].filter(r => document.getElementById('route-' + r)?.checked);
    huidigeTaak.referenties = Array.from(document.querySelectorAll('.taak-ref-waarde')).map(i => i.value.trim()).filter(Boolean);
    huidigeTaak.volgtijdelijkheid = document.getElementById('taak-volgtijdelijkheid')?.value.trim() || '0.0';
    huidigeTaak.volgorde = parseInt(document.getElementById('taak-volgorde')?.value) || null;
    huidigeTaak.fases = ['verkennen','verwerken','inprenten','evalueren','herhalen'].filter(f => document.getElementById('fase-' + f)?.checked);
    huidigeTaak.extraPapier = document.getElementById('taak-extra-papier')?.checked ? 'ja' : 'nee';
    huidigeTaak.status = document.getElementById('taak-status')?.value || 'concept';
  }
  if (nr === 2) {
    const keuze = document.querySelector('input[name="vk-keuze"]:checked')?.value;
    huidigeTaak.heeftVoorkennis = keuze === 'ja';
    huidigeTaak.voorkennis = keuze === 'ja' ? geselecteerdeVK.map(d => d.id) : [];
    huidigeTaak.voorkennisData = keuze === 'ja' ? geselecteerdeVK : [];
  }
  if (nr === 3) {
    huidigeTaak.scLeren = document.getElementById('sc-leren-actief')?.checked;
    huidigeTaak.scEval = document.getElementById('sc-eval-actief')?.checked;
    huidigeTaak.succescriteria = [
      ...geselecteerdeSC.leren.map(d => ({ id: d.id, scIndeling: 'leren' })),
      ...geselecteerdeSC.eval.map(d => ({ id: d.id, scIndeling: 'eval' })),
    ];
    huidigeTaak.scData = {
      leren: geselecteerdeSC.leren,
      eval: geselecteerdeSC.eval,
    };
  }
  if (nr === 4) {
    huidigeTaak.templateId = templateData?.id || null;
    huidigeTaak.templateParams = templateData?.parameters || {};
    huidigeTaak.templateInhoud = templateData?.inhoud || '';
  }
  if (nr === 5) {
    // Standaardbronnen ophalen uit aangevinkte checkboxes
    const standaard = [];
    document.querySelectorAll('.standaard-bron-check:checked').forEach(cb => {
      standaard.push({
        id: 'std-' + cb.dataset.label.replace(/\s/g, '-'),
        label: cb.dataset.label,
        type: cb.dataset.type || 'bestand',
        link: cb.dataset.link || '',
        icoon: cb.dataset.icoon || '📄',
        standaard: true,
      });
    });
    huidigeTaak.bronnenData = [...standaard, ...geselecteerdeBronnen];
    huidigeTaak.bronnen = huidigeTaak.bronnenData; // bewaar volledige objecten
  }
  if (nr === 6) {
    huidigeTaak.indienwijze = {
      digitaal: document.getElementById('indienen-digitaal')?.checked || false,
      map: document.getElementById('indienen-map')?.checked || false,
      vakje: document.getElementById('indienen-vakje')?.checked || false,
      anders: document.getElementById('indienen-anders')?.checked || false,
      andersText: document.getElementById('indienen-anders-tekst')?.value.trim() || '',
    };
  }
}

// ===== STAP 0: START =====
// HTML staat vast in beheer.html — reset alleen staat en koppel listeners eenmalig
function renderStap0() {
  // Deselecteer radio's
  document.querySelectorAll('input[name="taak-start-keuze"]').forEach(r => r.checked = false);
  // Verberg bestaande takenlijst
  const blok = document.getElementById('bestaande-taak-keuze');
  if (blok) { blok.style.display = 'none'; blok.innerHTML = ''; }
}

export function initStap0Listeners() {
  const stap0 = document.getElementById('taak-stap-0');
  if (!stap0) return;
  stap0.querySelectorAll('input[name="taak-start-keuze"]').forEach(radio => {
    radio.addEventListener('change', async () => {
      const blok = document.getElementById('bestaande-taak-keuze');
      if (radio.value === 'aanpassen' || radio.value === 'kopie') {
        blok.style.display = 'block';
        await laadBestaandeTaken();
      } else {
        blok.style.display = 'none';
        blok.innerHTML = '';
        bewerkId = null;
        isBewerkModus = false;
      }
    });
  });
}
let alleBestaandeTaken = [];

async function laadBestaandeTaken() {
  const blok = document.getElementById('bestaande-taak-keuze');
  if (!blok) return;

  blok.innerHTML = '<div style="color:var(--tekst-licht);font-size:9.5pt;margin-top:8px;">Laden...</div>';

  alleBestaandeTaken = await haalCache('taken', db);
  alleBestaandeTaken.sort((a, b) => {
    if (a.schooljaar !== b.schooljaar) return (b.schooljaar || '').localeCompare(a.schooljaar || '');
    if ((a.lesweek || 0) !== (b.lesweek || 0)) return (a.lesweek || 0) - (b.lesweek || 0);
    return (a.code || '').localeCompare(b.code || '', 'nl');
  });

  // Unieke schooljaren en weken voor filters
  const schooljaren = [...new Set(alleBestaandeTaken.map(t => t.schooljaar).filter(Boolean))].sort().reverse();
  const weken = [...new Set(alleBestaandeTaken.map(t => t.lesweek).filter(Boolean))].sort((a,b) => a-b);
  const referenties = [...new Set(alleBestaandeTaken.flatMap(t => t.referenties || []))].sort();

  blok.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;margin-bottom:8px;">
      <select id="bt-filter-sj" onchange="window._filterBestaandeTaken()" style="padding:5px 8px;border:1.5px solid var(--grijs-rand);border-radius:6px;font-size:9.5pt;">
        <option value="">Alle schooljaren</option>
        ${schooljaren.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <select id="bt-filter-week" onchange="window._filterBestaandeTaken()" style="padding:5px 8px;border:1.5px solid var(--grijs-rand);border-radius:6px;font-size:9.5pt;">
        <option value="">Alle weken</option>
        ${weken.map(w => `<option value="${w}">Week ${w}</option>`).join('')}
      </select>
      <select id="bt-filter-ref" onchange="window._filterBestaandeTaken()" style="padding:5px 8px;border:1.5px solid var(--grijs-rand);border-radius:6px;font-size:9.5pt;">
        <option value="">Alle referenties</option>
        ${referenties.map(r => `<option value="${r}">${r}</option>`).join('')}
      </select>
      <input type="text" id="bt-filter-zoek" placeholder="Zoeken op code/titel..." oninput="window._filterBestaandeTaken()"
        style="padding:5px 8px;border:1.5px solid var(--grijs-rand);border-radius:6px;font-size:9.5pt;flex:1;min-width:140px;">
    </div>
    <div class="doel-lijst-container" id="bt-lijst" style="max-height:260px;"></div>
  `;
  renderBestaandeTakenLijst();
}

function renderBestaandeTakenLijst() {
  const filterSj = document.getElementById('bt-filter-sj')?.value || '';
  const filterWeek = document.getElementById('bt-filter-week')?.value || '';
  const filterRef = document.getElementById('bt-filter-ref')?.value || '';
  const zoek = document.getElementById('bt-filter-zoek')?.value.toLowerCase() || '';

  let lijst = alleBestaandeTaken.filter(t => {
    if (filterSj && t.schooljaar !== filterSj) return false;
    if (filterWeek && String(t.lesweek) !== filterWeek) return false;
    if (filterRef && !(t.referenties || []).includes(filterRef)) return false;
    if (zoek && !`${t.code} ${t.titel}`.toLowerCase().includes(zoek)) return false;
    return true;
  });

  const container = document.getElementById('bt-lijst');
  if (!container) return;
  if (!lijst.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--tekst-licht);font-size:9.5pt;">Geen taken gevonden.</div>';
    return;
  }
  container.innerHTML = lijst.map(t => `
    <div class="doel-keuze-item" style="cursor:pointer;" onclick="window._kiesBestaandeTaak('${t.id}')">
      <div class="doel-keuze-tekst">
        <strong>${t.code}</strong> — ${t.titel}
        <div class="doel-keuze-meta">
          ${t.schooljaar || ''}${t.lesweek ? ' · Week ' + t.lesweek : ''}${t.klas ? ' · ' + t.klas : ''}
          ${(t.referenties || []).length ? ' · §' + t.referenties.join(', ') : ''}
          ${(t.routes || []).filter(r => r !== 'geen').length ? ' · ' + t.routes.filter(r => r !== 'geen').join('/') : ''}
          · <span class="badge ${t.status === 'actief' ? 'badge-basis' : t.status === 'archief' ? 'badge-bg' : 'badge-verdieping'}">${t.status || 'concept'}</span>
          · v${t.versienummer || 1}
        </div>
      </div>
    </div>
  `).join('');
}

export function filterBestaandeTaken() {
  renderBestaandeTakenLijst();
}

export function kiesBestaandeTaak(id) {
  const keuze = document.querySelector('input[name="taak-start-keuze"]:checked')?.value;
  if (!keuze) return;
  const taak = alleBestaandeTaken.find(t => t.id === id);
  if (!taak) return;
  // Markeer de geselecteerde rij
  document.querySelectorAll('#bt-lijst .doel-keuze-item').forEach(el => el.style.background = '');
  event?.currentTarget?.style && (event.currentTarget.style.background = 'var(--blauw-licht)');
  if (keuze === 'aanpassen') {
    laadTaakInFormulier(id, taak, false);
  } else {
    laadTaakInFormulier(null, taak, true);
  }
}

// ===== STAP 1: COÖRDINATEN =====
function initStap1() {
  // Zet standaardwaarden als het veld leeg is (= nieuwe taak)
  const sjVeld = document.getElementById('taak-schooljaar');
  if (sjVeld && !sjVeld.value) sjVeld.value = huidigSchooljaar();

  const vakVeld = document.getElementById('taak-vak');
  if (vakVeld && !vakVeld.value) vakVeld.value = 'Wiskunde';

  const klasVeld = document.getElementById('taak-klas');
  if (klasVeld && !klasVeld.value) klasVeld.value = '1a';

  const statusVeld = document.getElementById('taak-status');
  if (statusVeld && !statusVeld.value) statusVeld.value = 'concept';

  const typeVeld = document.getElementById('taak-type');
  if (typeVeld && !typeVeld.value) typeVeld.value = 'taak';

  const vtVeld = document.getElementById('taak-volgtijdelijkheid');
  if (vtVeld && !vtVeld.value) vtVeld.value = '0.0';

  // Schooljaar weken vullen
  vulLesweekDropdown(sjVeld?.value || huidigSchooljaar());
  // Tijdveld bijwerken op basis van huidig type en routes
  toggleTijdVeld();
}

export function vulLesweekDropdown(schooljaar) {
  const sel = document.getElementById('taak-lesweek');
  if (!sel) return;
  const huidig = sel.value;
  const weken = genereerSchoolweken(schooljaar);
  sel.innerHTML = '<option value="">Kies een week...</option>' +
    weken.map(w => `<option value="${w.nr}" ${w.nr == huidig ? 'selected' : ''}>${w.label}</option>`).join('');
}

// Referenties (zelfde patroon als doelen.js)
let taakRefTeller = 0;
export function voegTaakRefToe(waarde = '') {
  const container = document.getElementById('taak-ref-container');
  document.getElementById('geen-taak-refs').style.display = 'none';
  taakRefTeller++;
  const id = 'taak-ref-' + taakRefTeller;
  const div = document.createElement('div');
  div.className = 'subdoel-item';
  div.id = id;
  div.innerHTML = `
    <div class="cd-wrapper" style="flex:1;">
      <input type="text" class="cd-input taak-ref-waarde" placeholder="bv. 7.1" value="${waarde}"
        autocomplete="off" data-type="referentie"
        oninput="window._cdFilter(this)" onfocus="window._cdFilter(this)" onblur="window._cdVerberg(this)">
      <div class="cd-lijst"></div>
      <div class="cd-waarschuwing">⚠ Onbekende referentie.</div>
    </div>
    <button class="subdoel-verwijder" onclick="window._verwijderTaakRef('${id}')">✕</button>
  `;
  container.appendChild(div);
}

export function verwijderTaakRef(id) {
  document.getElementById(id)?.remove();
  if (!document.querySelectorAll('.taak-ref-waarde').length)
    document.getElementById('geen-taak-refs').style.display = 'block';
}

export function toggleTijdVeld() {
  const type = document.getElementById('taak-type')?.value;
  const tijdVeld = document.getElementById('taak-tijd');
  const routesKeuze = document.getElementById('tijd-routes-keuze');
  const perRouteContainer = document.getElementById('tijd-per-route-container');
  if (!tijdVeld) return;

  const geselecteerdeRoutes = ['G', 'B', 'Z'].filter(r => document.getElementById('route-' + r)?.checked);

  if (type === 'les') {
    tijdVeld.value = 'rooster';
    tijdVeld.readOnly = true;
    tijdVeld.style.display = '';
    tijdVeld.style.background = '#f4f5f7';
    if (routesKeuze) routesKeuze.style.display = 'none';
    return;
  }

  if (tijdVeld.value === 'rooster') tijdVeld.value = '';
  tijdVeld.readOnly = false;
  tijdVeld.style.background = '';

  if (geselecteerdeRoutes.length < 2) {
    tijdVeld.style.display = '';
    if (routesKeuze) routesKeuze.style.display = 'none';
    return;
  }

  // ≥2 routes en type = taak
  if (routesKeuze) routesKeuze.style.display = 'block';
  const keuze = document.querySelector('input[name="tijd-keuze"]:checked')?.value || 'zelfde';

  if (keuze === 'zelfde') {
    tijdVeld.style.display = '';
    if (perRouteContainer) perRouteContainer.style.display = 'none';
  } else {
    tijdVeld.style.display = 'none';
    if (perRouteContainer) {
      const huidigeWaarden = {};
      perRouteContainer.querySelectorAll('.tijd-route-veld').forEach(el => {
        huidigeWaarden[el.dataset.route] = el.value;
      });
      perRouteContainer.style.display = 'flex';
      perRouteContainer.innerHTML = geselecteerdeRoutes.map(r => `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:9pt;font-weight:600;">${r}-route</label>
          <input type="text" class="tijd-route-veld" data-route="${r}"
                 placeholder="50" style="width:80px;"
                 value="${huidigeWaarden[r] || ''}">
        </div>
      `).join('');
    }
  }
}

// ===== STAP 2: VOORKENNIS =====
async function initStap2() {
  await laadDropdownData();
  await zorgDoelenCache();
  renderDoelSectie('vk');
}

// ===== STAP 3: SUCCESCRITERIA =====
async function initStap3() {
  await zorgDoelenCache();
  renderDoelSectie('sc');
}

// ===== HERBRUIKBAAR DOEL-KEUZE PANEL =====
function renderDoelSectie(modus) {
  // modus = 'vk' | 'sc'
  const container = document.getElementById(`taak-stap-${modus === 'vk' ? 2 : 3}`);

  if (modus === 'vk') {
    container.querySelector('.doel-keuze-sectie').innerHTML = renderDoelKeuzeBlok('vk', 'voorkennis');
    container.querySelector('.gekozen-doelen-sectie').innerHTML = renderGekozenDoelenBlok('vk');
    bindDoelKeuzeEvents('vk');
  } else {
    container.querySelector('.doel-keuze-sectie-leren').innerHTML = renderDoelKeuzeBlok('sc-leren', 'succescriterium');
    container.querySelector('.doel-keuze-sectie-eval').innerHTML = renderDoelKeuzeBlok('sc-eval', 'succescriterium');
    container.querySelector('.gekozen-doelen-sectie-leren').innerHTML = renderGekozenDoelenBlok('sc-leren');
    container.querySelector('.gekozen-doelen-sectie-eval').innerHTML = renderGekozenDoelenBlok('sc-eval');
    bindDoelKeuzeEvents('sc-leren');
    bindDoelKeuzeEvents('sc-eval');
  }
}

function renderDoelKeuzeBlok(prefix, typeFilter) {
  const doelen = (alleDoelen || []).filter(d => d.type === typeFilter);
  return `
    <div class="doel-zoek-blok" id="${prefix}-zoek-blok">
      <div class="doel-zoek-rij">
        <input type="text" placeholder="Zoeken op tekst..." id="${prefix}-zoek" oninput="window._filterDoelen('${prefix}')"
          style="flex:2;padding:7px 10px;border:1.5px solid var(--grijs-rand);border-radius:7px;font-size:10pt;">
        <select id="${prefix}-filter-ref" onchange="window._filterDoelen('${prefix}')"
          style="flex:1;padding:7px 10px;border:1.5px solid var(--grijs-rand);border-radius:7px;font-size:9.5pt;">
          <option value="">Alle referenties</option>
          ${[...new Set(doelen.flatMap(d => d.referenties || []))].sort().map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
        <select id="${prefix}-filter-lp" onchange="window._filterDoelen('${prefix}')"
          style="flex:1;padding:7px 10px;border:1.5px solid var(--grijs-rand);border-radius:7px;font-size:9.5pt;">
          <option value="">Alle leerplandoelen</option>
          ${[...new Set(doelen.flatMap(d => d.leerplandoel_codes || []))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="doel-lijst-container" id="${prefix}-lijst">
        ${renderDoelLijst(prefix, doelen)}
      </div>
    </div>
    <div style="margin-top:8px;">
      <button class="knop knop-secundair knop-klein" onclick="window._toggleNieuwDoelFormulier('${prefix}')">+ Nieuw doel toevoegen</button>
    </div>
    <div id="${prefix}-nieuw-formulier" style="display:none;background:var(--grijs);border-radius:8px;padding:14px;margin-top:10px;">
      <div class="formulier-rij">
        <div class="formulier-groep vol">
          <label>Tekst</label>
          <textarea id="${prefix}-nieuw-tekst" rows="2" placeholder="Tekst van het doel..."></textarea>
        </div>
      </div>
      <div class="formulier-rij">
        <div class="formulier-groep">
          <label>Leerplandoel-code</label>
          <input type="text" id="${prefix}-nieuw-lp" placeholder="bv. 6.1">
        </div>
        <div class="formulier-groep">
          <label>Referentie</label>
          <input type="text" id="${prefix}-nieuw-ref" placeholder="bv. 7.1">
        </div>
        ${typeFilter === 'succescriterium' ? `
        <div class="formulier-groep">
          <label>Evalueerbaar</label>
          <select id="${prefix}-nieuw-eval" onchange="window._toggleNieuwDoelScores('${prefix}')">
            <option value="nee">Nee</option><option value="ja">Ja</option>
          </select>
        </div>` : ''}
      </div>
      ${typeFilter === 'succescriterium' ? `
      <div id="${prefix}-nieuw-scores-blok" style="display:none;" class="formulier-rij">
        <div class="formulier-groep vol">
          <label>Scores <span style="font-weight:400;text-transform:none;">(gebruik ### voor nieuwe regel)</span></label>
          <textarea id="${prefix}-nieuw-scores" rows="2"></textarea>
        </div>
      </div>` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="knop knop-primair knop-klein" onclick="window._slaaNieuwDoelOp('${prefix}', '${typeFilter}')">Opslaan</button>
        <button class="knop knop-secundair knop-klein" onclick="window._toggleNieuwDoelFormulier('${prefix}')">Annuleren</button>
      </div>
    </div>
  `;
}

function renderDoelLijst(prefix, doelen) {
  if (!doelen.length) return '<div style="padding:10px;color:var(--tekst-licht);font-size:9.5pt;">Geen doelen gevonden.</div>';
  return doelen.map(d => {
    const codes = (d.leerplandoel_codes || []).join(', ');
    const refs = (d.referenties || []).join(', ');
    return `
      <div class="doel-keuze-item" data-id="${d.id}" data-ref="${refs}" data-lp="${codes}">
        <div class="doel-keuze-tekst">
          ${d.tekst}
          <div class="doel-keuze-meta">${codes ? `(${codes})` : ''} ${refs ? `§${refs}` : ''}</div>
        </div>
        <button class="knop knop-primair knop-klein" style="flex-shrink:0;" onclick="window._kiesDoel('${prefix}', '${d.id}')">+</button>
      </div>
    `;
  }).join('');
}

function renderGekozenDoelenBlok(prefix) {
  return `
    <div style="margin-top:14px;">
      <label style="font-size:9.5pt;font-weight:700;color:var(--tekst-licht);text-transform:uppercase;letter-spacing:0.5px;">Gekozen doelen</label>
      <div id="${prefix}-gekozen" style="margin-top:8px;min-height:40px;"></div>
      <div id="${prefix}-geen-gekozen" style="font-size:9.5pt;color:var(--tekst-licht);padding:8px 0;">Nog geen doelen gekozen.</div>
    </div>
  `;
}

function bindDoelKeuzeEvents(prefix) {
  // Drag-and-drop voor volgorde komt via renderGekozenDoelen
  renderGekozenDoelen(prefix);
}

export function filterDoelen(prefix) {
  const zoek = document.getElementById(`${prefix}-zoek`)?.value.toLowerCase() || '';
  const filterRef = document.getElementById(`${prefix}-filter-ref`)?.value || '';
  const filterLp = document.getElementById(`${prefix}-filter-lp`)?.value || '';
  const typeFilter = prefix.startsWith('sc') ? 'succescriterium' : 'voorkennis';

  const gefilterd = (alleDoelen || []).filter(d => {
    if (d.type !== typeFilter) return false;
    if (zoek && !d.tekst.toLowerCase().includes(zoek)) return false;
    if (filterRef && !(d.referenties || []).includes(filterRef)) return false;
    if (filterLp && !(d.leerplandoel_codes || []).includes(filterLp)) return false;
    return true;
  });

  const lijst = document.getElementById(`${prefix}-lijst`);
  if (lijst) lijst.innerHTML = renderDoelLijst(prefix, gefilterd);
}

export function kiesDoel(prefix, id) {
  const doel = alleDoelen?.find(d => d.id === id);
  if (!doel) return;
  const lijst = prefix === 'vk' ? geselecteerdeVK
    : prefix === 'sc-leren' ? geselecteerdeSC.leren
    : geselecteerdeSC.eval;
  if (lijst.find(d => d.id === id)) return; // al gekozen
  lijst.push({ ...doel });
  renderGekozenDoelen(prefix);
}

export function verwijderGekozenDoel(prefix, id) {
  if (prefix === 'vk') {
    geselecteerdeVK = geselecteerdeVK.filter(d => d.id !== id);
  } else if (prefix === 'sc-leren') {
    geselecteerdeSC.leren = geselecteerdeSC.leren.filter(d => d.id !== id);
  } else {
    geselecteerdeSC.eval = geselecteerdeSC.eval.filter(d => d.id !== id);
  }
  renderGekozenDoelen(prefix);
}

function renderGekozenDoelen(prefix) {
  const lijst = prefix === 'vk' ? geselecteerdeVK
    : prefix === 'sc-leren' ? geselecteerdeSC.leren
    : geselecteerdeSC.eval;

  const container = document.getElementById(`${prefix}-gekozen`);
  const geen = document.getElementById(`${prefix}-geen-gekozen`);
  if (!container) return;

  if (!lijst.length) {
    container.innerHTML = '';
    if (geen) geen.style.display = 'block';
    return;
  }
  if (geen) geen.style.display = 'none';

  container.innerHTML = lijst.map((d, idx) => `
    <div class="geselecteerd-doel-item" draggable="true" data-id="${d.id}" data-prefix="${prefix}" data-idx="${idx}">
      <span style="cursor:grab;color:var(--tekst-licht);margin-right:6px;">⠿</span>
      <span style="flex:1;font-size:10.5pt;">${d.tekst}</span>
      <button class="verwijder-doel" onclick="window._verwijderGekozenDoel('${prefix}', '${d.id}')">✕</button>
    </div>
  `).join('');

  // Drag-and-drop
  container.querySelectorAll('.geselecteerd-doel-item').forEach(el => {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('drag-id', el.dataset.id); el.style.opacity = '0.5'; });
    el.addEventListener('dragend', e => { el.style.opacity = '1'; });
    el.addEventListener('dragover', e => { e.preventDefault(); el.style.background = 'var(--blauw-licht)'; });
    el.addEventListener('dragleave', () => { el.style.background = ''; });
    el.addEventListener('drop', e => {
      e.preventDefault(); el.style.background = '';
      const vanId = e.dataTransfer.getData('drag-id');
      if (vanId === el.dataset.id) return;
      const lijst2 = prefix === 'vk' ? geselecteerdeVK : prefix === 'sc-leren' ? geselecteerdeSC.leren : geselecteerdeSC.eval;
      const vanIdx = lijst2.findIndex(d => d.id === vanId);
      const naarIdx = lijst2.findIndex(d => d.id === el.dataset.id);
      const [item] = lijst2.splice(vanIdx, 1);
      lijst2.splice(naarIdx, 0, item);
      renderGekozenDoelen(prefix);
    });
  });
}

export function toggleNieuwDoelFormulier(prefix) {
  const formulier = document.getElementById(`${prefix}-nieuw-formulier`);
  if (formulier) formulier.style.display = formulier.style.display === 'none' ? 'block' : 'none';
}

export function toggleNieuwDoelScores(prefix) {
  const eval_ = document.getElementById(`${prefix}-nieuw-eval`)?.value;
  const blok = document.getElementById(`${prefix}-nieuw-scores-blok`);
  if (blok) blok.style.display = eval_ === 'ja' ? 'block' : 'none';
}

export async function slaaNieuwDoelOp(prefix, typeFilter) {
  const tekst = document.getElementById(`${prefix}-nieuw-tekst`)?.value.trim();
  if (!tekst) { alert('Vul de tekst in.'); return; }
  const lp = document.getElementById(`${prefix}-nieuw-lp`)?.value.trim();
  const ref = document.getElementById(`${prefix}-nieuw-ref`)?.value.trim();
  const evalueerbaar = document.getElementById(`${prefix}-nieuw-eval`)?.value || 'nee';
  const scores = document.getElementById(`${prefix}-nieuw-scores`)?.value.trim().replace(/###/g, '\n') || '';

  const data = {
    tekst, type: typeFilter,
    leerplandoel_codes: lp ? [lp] : [],
    referenties: ref ? [ref] : [],
    evalueerbaar, scores, notities: '',
    aangepastOp: new Date().toISOString(),
  };

  try {
    const nieuwId = crypto.randomUUID();
    const nieuw = { id: nieuwId, ...data };
    const bestaandeDoelen = alleDoelen || await haalCache('doelen', db);
    await setDoc(doc(db, 'doelen', 'wiskunde1a'), { items: [...bestaandeDoelen, nieuw] });
    if (alleDoelen) alleDoelen.push(nieuw);
    wisCache('doelen');

    // Koppel meteen
    const lijst = prefix === 'vk' ? geselecteerdeVK : prefix === 'sc-leren' ? geselecteerdeSC.leren : geselecteerdeSC.eval;
    lijst.push(nieuw);
    renderGekozenDoelen(prefix);

    // Reset formulier
    document.getElementById(`${prefix}-nieuw-tekst`).value = '';
    if (document.getElementById(`${prefix}-nieuw-lp`)) document.getElementById(`${prefix}-nieuw-lp`).value = '';
    if (document.getElementById(`${prefix}-nieuw-ref`)) document.getElementById(`${prefix}-nieuw-ref`).value = '';
    if (document.getElementById(`${prefix}-nieuw-eval`)) document.getElementById(`${prefix}-nieuw-eval`).value = 'nee';
    if (document.getElementById(`${prefix}-nieuw-scores`)) document.getElementById(`${prefix}-nieuw-scores`).value = '';
    if (document.getElementById(`${prefix}-nieuw-scores-blok`)) document.getElementById(`${prefix}-nieuw-scores-blok`).style.display = 'none';
    document.getElementById(`${prefix}-nieuw-formulier`).style.display = 'none';
  } catch (e) { toonMelding('taken', 'Fout bij opslaan doel: ' + e.message, 'fout'); console.error(e); }
}

// ===== STAP 4: INSTRUCTIE =====
let taakEditorInhoud = '';

async function initStap4() {
  // Check of templates gewijzigd zijn
  if (checkResetSignaal('templateDropdown')) wisCache('templates');
  const templates = await zorgTemplatesCache();
  const container = document.getElementById('stap4-template-lijst');
  if (container) {
    container.innerHTML = templates.map(t => `
      <div class="doel-keuze-item" data-id="${t.id}">
        <div class="doel-keuze-tekst">
          <strong>${t.naam}</strong>
          <div class="doel-keuze-meta">${t.type}${t.notities ? ' — ' + t.notities : ''}</div>
        </div>
        <button class="knop knop-primair knop-klein" style="flex-shrink:0;" onclick="window._kiesTemplate('${t.id}')">+</button>
      </div>
    `).join('') || '<div style="padding:10px;color:var(--tekst-licht);">Geen templates beschikbaar.</div>';
  }

  // Als er al templateData is, laad die in
  if (templateData) {
    document.getElementById('taak-instructies-inhoud').value = templateData.inhoud || '';
    updatePreviewTaak();
    renderTemplateParams(templateData.parameters || {}, templateData.paramVolgorde);
  }
}

export function kiesTemplate(id) {
  const templates = zorgTemplatesCache();
  templates.then(lijst => {
    const t = lijst.find(x => x.id === id);
    if (!t) return;
    // Bepaal paramVolgorde op basis van volgorde in inhoud
    const volgorde = [];
    const gezien = new Set();
    for (const m of (t.inhoud || '').matchAll(/\{(\w+)\}/g)) {
      if (!gezien.has(m[1])) { gezien.add(m[1]); volgorde.push(m[1]); }
    }
    templateData = { id: t.id, naam: t.naam, inhoud: t.inhoud, parameters: { ...t.parameters }, paramVolgorde: volgorde };
    document.getElementById('taak-instructies-inhoud').value = t.inhoud;
    updatePreviewTaak();
    renderTemplateParams(t.parameters || {}, volgorde);
    toonMelding('taken', `Template "${t.naam}" geladen.`, 'succes');
  });
}

// ===== HULPFUNCTIE: paramVolgorde uit tekst =====
function berekenParamVolgorde(tekst) {
  const gezien = new Set();
  const volgorde = [];
  for (const m of (tekst || '').matchAll(/\{(\w+)\}/g)) {
    if (!gezien.has(m[1])) { gezien.add(m[1]); volgorde.push(m[1]); }
  }
  return volgorde;
}

function renderTemplateParams(params, volgorde) {
  const container = document.getElementById('taak-template-params');
  const blok = document.getElementById('taak-template-params-blok');
  const sleutels = volgorde || Object.keys(params);
  if (!sleutels.length) { blok.style.display = 'none'; return; }
  blok.style.display = 'block';
  container.innerHTML = sleutels.map(naam => `
    <div class="param-rij">
      <div class="param-naam">{${naam}}</div>
      <input type="text" class="param-input taak-param" data-param="${naam}"
        value="${params[naam] || ''}" placeholder="Waarde voor ${naam}..."
        oninput="window._updatePreviewTaak()">
    </div>
  `).join('');
}

export function updatePreviewTaak() {
  const ta = document.getElementById('taak-instructies-inhoud');
  if (!ta) return;

  // Zorg dat templateData altijd bestaat
  if (!templateData) templateData = { id: null, naam: '', inhoud: '', parameters: {}, paramVolgorde: [] };
  templateData.inhoud = ta.value;
  // Herbereken volgorde als die ontbreekt
  if (!templateData.paramVolgorde?.length) templateData.paramVolgorde = berekenParamVolgorde(ta.value);

  // Parameters bijwerken
  document.querySelectorAll('.taak-param').forEach(inp => {
    templateData.parameters[inp.dataset.param] = inp.value;
  });

  // Preview: parameters invullen in tekst
  let tekst = ta.value;
  document.querySelectorAll('.taak-param').forEach(inp => {
    tekst = tekst.replace(new RegExp(`\\{${inp.dataset.param}\\}`, 'g'), inp.value || `{${inp.dataset.param}}`);
  });
  const preview = document.getElementById('taak-instructies-preview');
  if (preview) preview.innerHTML = parseMarkdown(tekst);

  // Hoogte sync
  ta.style.height = 'auto';
  const hoogte = Math.max(320, ta.scrollHeight);
  ta.style.height = hoogte + 'px';
  if (preview) preview.style.minHeight = hoogte + 'px';

  // Knoptekst aanpassen: alleen zichtbaar als er iets te bewaren valt als template
  const opslaanKnop = document.getElementById('instructie-opslaan-knop');
  if (opslaanKnop) {
    if (!ta.value.trim()) {
      opslaanKnop.style.display = 'none';
    } else if (templateData?.id) {
      // Bestaande template geladen: parameters worden automatisch meegestuurd, geen expliciete actie nodig
      opslaanKnop.style.display = 'none';
    } else {
      // Vrije tekst zonder template: toon knop om als template op te slaan
      opslaanKnop.textContent = '💾 Bewaren als herbruikbare template';
      opslaanKnop.style.display = 'inline-flex';
    }
  }
}

export function detecteerParametersTaak() {
  const inhoud = document.getElementById('taak-instructies-inhoud')?.value || '';
  // Volgorde van eerste voorkomen bewaren
  const gezien = new Set();
  const gevonden = [];
  for (const m of inhoud.matchAll(/\{(\w+)\}/g)) {
    if (!gezien.has(m[1])) { gezien.add(m[1]); gevonden.push(m[1]); }
  }
  const huidige = templateData?.parameters || {};
  // Sla op als geordende array + object
  const nieuw = {};
  gevonden.forEach(p => { nieuw[p] = huidige[p] || ''; });
  if (templateData) {
    templateData.parameters = nieuw;
    templateData.paramVolgorde = gevonden;
  }
  renderTemplateParams(nieuw, gevonden);
  updatePreviewTaak();
}

export async function slaInstructieOp() {
  const inhoud = document.getElementById('taak-instructies-inhoud')?.value.trim();
  if (!inhoud) { toonMelding('taken', 'Vul eerst instructies in.', 'fout'); return; }

  if (!templateData?.id) {
    // Nieuwe instructie → opslaan als template
    const naam = prompt('Geef een naam voor deze template (of annuleer om niet op te slaan als template):');
    if (naam) {
      const type = 'les'; // default
      const params = {};
      document.querySelectorAll('.taak-param').forEach(inp => { params[inp.dataset.param] = inp.value; });
      const data = { naam, type, inhoud, parameters: params, aangepastOp: new Date().toISOString() };
      const docRef = doc(collection(db, 'templates'));
      await setDoc(docRef, data);
      templateData = { id: docRef.id, naam, inhoud, parameters: params, paramVolgorde: berekenParamVolgorde(inhoud) };
      toonMelding('taken', `Template "${naam}" opgeslagen.`, 'succes');
    } else {
      // Niet als template opslaan: bewaar inline
      if (!templateData) templateData = { id: null, naam: '', parameters: {}, paramVolgorde: [] };
      templateData.id = null;
      templateData.inhoud = inhoud;
      templateData.paramVolgorde = berekenParamVolgorde(inhoud);
    }
  }
  updatePreviewTaak();
  toonMelding('taken', 'Instructie opgeslagen.', 'succes');
}

// ===== STAP 5: BRONNEN =====
async function initStap5() {
  await zorgBronnenCache();
  // Standaardbronnen detecteren op basis van referenties
  const refs = huidigeTaak.referenties || [];
  const hoofdstukken = await zorgHoofdstukkenCache();
  const stap5 = document.getElementById('stap5-standaard-bronnen');

  const hoofdstukNrs = [...new Set(refs.map(r => parseInt(r.split('.')[0])).filter(Boolean))];
  let standaardHtml = '';
  for (const nr of hoofdstukNrs) {
    const hst = hoofdstukken.find(h => h.nummer === nr);
    if (!hst) continue;
    const beschikbaar = [];
    if (hst.bronnen?.cursus) beschikbaar.push({ label: `Cursus H${nr}`, type: 'bestand', link: hst.bronnen.cursus, icoon: '📄' });
    if (hst.bronnen?.theorie) beschikbaar.push({ label: `Theorie H${nr}`, type: 'bestand', link: hst.bronnen.theorie, icoon: '📖' });
    if (hst.bronnen?.correctiesleutel) beschikbaar.push({ label: `Correctiesleutel H${nr}`, type: 'bestand', link: hst.bronnen.correctiesleutel, icoon: '✅' });
    if (!beschikbaar.length) continue;
    standaardHtml += `
      <div style="margin-bottom:12px;">
        <div style="font-weight:700;font-size:10.5pt;margin-bottom:6px;">Hoofdstuk ${nr}: ${hst.titel}</div>
        ${beschikbaar.map(b => `
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer;font-size:10.5pt;">
            <input type="checkbox" class="standaard-bron-check" data-label="${b.label}" data-type="${b.type}" data-link="${b.link}" data-icoon="${b.icoon}" checked>
            ${b.icoon} ${b.label}
          </label>
        `).join('')}
      </div>
    `;
  }

  if (stap5) stap5.innerHTML = standaardHtml || '<div style="color:var(--tekst-licht);font-size:9.5pt;">Geen standaardbronnen gevonden voor de gekozen referenties.</div>';

  // Overige bronnen lijst
  renderBronLijst();
  renderGekozenBronnen();
}

function renderBronLijst() {
  const zoek = document.getElementById('bron-zoek')?.value.toLowerCase() || '';
  const filterType = document.getElementById('bron-filter-type')?.value || '';
  let bronnen = (alleBronnen || []).filter(b => {
    if (zoek && !b.label.toLowerCase().includes(zoek)) return false;
    if (filterType && b.type !== filterType) return false;
    return true;
  });
  const container = document.getElementById('stap5-bron-lijst');
  if (!container) return;
  const typeIconen = { website: '🌐', video: '▶️', classroom: '🎓', bestand: '📄', andere: '📎' };
  container.innerHTML = bronnen.map(b => `
    <div class="doel-keuze-item">
      <div class="doel-keuze-tekst">
        ${typeIconen[b.type] || '📎'} <strong>${b.label}</strong>
        ${b.referentie ? `<div class="doel-keuze-meta">§${b.referentie}</div>` : ''}
      </div>
      <button class="knop knop-primair knop-klein" style="flex-shrink:0;" onclick="window._kiesBron('${b.id}')">+</button>
    </div>
  `).join('') || '<div style="padding:10px;color:var(--tekst-licht);">Geen bronnen gevonden.</div>';
}

export function kiesBron(id) {
  const bron = alleBronnen?.find(b => b.id === id);
  if (!bron || geselecteerdeBronnen.find(b => b.id === id)) return;
  geselecteerdeBronnen.push({ ...bron });
  renderGekozenBronnen();
}

export function verwijderGekozenBron(id) {
  geselecteerdeBronnen = geselecteerdeBronnen.filter(b => b.id !== id);
  renderGekozenBronnen();
}

function renderGekozenBronnen() {
  const container = document.getElementById('stap5-gekozen-bronnen');
  const geen = document.getElementById('stap5-geen-bronnen');
  if (!container) return;
  if (!geselecteerdeBronnen.length) {
    container.innerHTML = '';
    if (geen) geen.style.display = 'block';
    return;
  }
  if (geen) geen.style.display = 'none';
  const typeIconen = { website: '🌐', video: '▶️', classroom: '🎓', bestand: '📄', andere: '📎' };
  container.innerHTML = geselecteerdeBronnen.map(b => `
    <div class="geselecteerd-doel-item">
      <span style="flex:1;">${typeIconen[b.type] || '📎'} ${b.label}</span>
      <button class="verwijder-doel" onclick="window._verwijderGekozenBron('${b.id}')">✕</button>
    </div>
  `).join('');
}

export function filterBronnen() {
  renderBronLijst();
}

export function toggleNieuwBronFormulier() {
  const f = document.getElementById('stap5-nieuw-bron-formulier');
  if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

export async function slaaNieuwBronOp() {
  const label = document.getElementById('stap5-nieuw-bron-label')?.value.trim();
  if (!label) { toonMelding('taken', 'Vul een label in voor de nieuwe bron.', 'fout'); return; }
  const data = {
    label,
    type: document.getElementById('stap5-nieuw-bron-type')?.value || 'andere',
    link: document.getElementById('stap5-nieuw-bron-link')?.value.trim() || '',
    referentie: document.getElementById('stap5-nieuw-bron-ref')?.value.trim() || '',
    notities: '',
    aangepastOp: new Date().toISOString(),
  };
  try {
    const nieuwId = crypto.randomUUID();
    const nieuw = { id: nieuwId, ...data };
    const bestaandeBronnen = alleBronnen || await haalCache('bronnen', db);
    await setDoc(doc(db, 'bronnen', 'wiskunde1a'), { items: [...bestaandeBronnen, nieuw] });
    if (alleBronnen) alleBronnen.push(nieuw);
    wisCache('bronnen');
    geselecteerdeBronnen.push(nieuw);
    renderGekozenBronnen();
    renderBronLijst();
    // Reset formulier
    document.getElementById('stap5-nieuw-bron-label').value = '';
    document.getElementById('stap5-nieuw-bron-link').value = '';
    if (document.getElementById('stap5-nieuw-bron-ref')) document.getElementById('stap5-nieuw-bron-ref').value = '';
    document.getElementById('stap5-nieuw-bron-formulier').style.display = 'none';
    toonMelding('taken', `Bron "${label}" aangemaakt en toegevoegd.`, 'succes');
  } catch (e) {
    toonMelding('taken', 'Fout bij aanmaken bron: ' + e.message, 'fout');
    console.error(e);
  }
}

// ===== VOLTOOIEN & PREVIEW =====
export async function voltooiTaak() {
  if (!valideerStap(6)) return;
  // Verzamel stap 5 (bronnen) en 6 (indienen) met actuele DOM-staat
  verzamelStapData(5);
  verzamelStapData(6);

  // Preview tonen
  const previewEl = document.getElementById('taak-preview-inhoud');
  if (previewEl) previewEl.innerHTML = renderTaakPreview(huidigeTaak);
  document.getElementById('taak-stappen-wrapper').style.display = 'none';
  document.getElementById('taak-preview-wrapper').style.display = 'block';
}

export function bewerkPreview() {
  document.getElementById('taak-stappen-wrapper').style.display = 'block';
  document.getElementById('taak-preview-wrapper').style.display = 'none';
  toonStap(huidigStap);
}

export async function slaaTaakOp() {
  console.log('slaaTaakOp gestart', { huidigeTaak, isBewerkModus, bewerkId });

  const uid = auth.currentUser?.uid;
  if (!uid) {
    alert('Niet ingelogd. Meld opnieuw aan.');
    return;
  }

  const nu = new Date().toISOString();
  const isKopie = huidigeTaak.startKeuze === 'kopie';

  // Bewaar bronnenData die al correct is (van voltooiTaak of stap 5)
  const bewaardeBronnen = huidigeTaak.bronnenData ? [...huidigeTaak.bronnenData] : null;

  // Zorg dat alle stap-data verzameld is (ook als gebruiker niet alle stappen doorlopen heeft)
  [1,2,3,4,5,6].forEach(nr => {
    try { verzamelStapData(nr); } catch(e) { /* stap mogelijk niet geïnitialiseerd */ }
  });

  // Herstel bronnenData als die al correct was (checkboxes zijn weg in preview)
  if (bewaardeBronnen && bewaardeBronnen.length > 0) {
    huidigeTaak.bronnenData = bewaardeBronnen;
  }

  const data = {
    code: huidigeTaak.code || '',
    titel: huidigeTaak.titel || '',
    type: huidigeTaak.type || 'taak',
    tijd: huidigeTaak.tijd || '',
    tijdVerschilt: huidigeTaak.tijdVerschilt || false,
    tijdPerRoute: huidigeTaak.tijdPerRoute || {},
    vak: huidigeTaak.vak || 'Wiskunde',
    klas: huidigeTaak.klas || '',
    schooljaar: huidigeTaak.schooljaar || huidigSchooljaar(),
    lesweek: huidigeTaak.lesweek || null,
    omschrijving: huidigeTaak.omschrijving || '',
    tags: huidigeTaak.tags || [],
    routes: huidigeTaak.routes || [],
    referenties: huidigeTaak.referenties || [],
    volgtijdelijkheid: huidigeTaak.volgtijdelijkheid || '0.0',
    volgorde: huidigeTaak.volgorde || null,
    fases: huidigeTaak.fases || [],
    extraPapier: huidigeTaak.extraPapier || 'nee',
    status: huidigeTaak.status || 'concept',
    heeftVoorkennis: huidigeTaak.heeftVoorkennis || false,
    voorkennis: huidigeTaak.voorkennis || [],
    succescriteria: huidigeTaak.succescriteria || [],
    scLeren: huidigeTaak.scLeren || false,
    scEval: huidigeTaak.scEval || false,
    templateId: huidigeTaak.templateId || null,
    templateParams: huidigeTaak.templateParams || {},
    templateInhoud: huidigeTaak.templateInhoud || '',
    bronnen: (huidigeTaak.bronnenData || []).map(b =>
      b.standaard
        ? { id: b.id || '', label: b.label || '', type: b.type || 'andere', link: b.link || '', icoon: b.icoon || '', standaard: true }
        : { id: b.id || '' }
    ),
    indienwijze: huidigeTaak.indienwijze || {},
    leerkrachtId: uid,
    aangepastOp: nu,
  };

  console.log('Data om op te slaan:', data);

  // Valideer verplichte velden
  if (!data.code) { alert('Geen code gevonden. Ga terug naar stap 1.'); return; }

  try {
    if (isBewerkModus && bewerkId && !isKopie) {
      console.log('Updaten bestaande taak:', bewerkId);
      await setDoc(doc(db, 'taken', bewerkId), data);
    } else {
      console.log('Nieuwe taak aanmaken...');
      const docRef = doc(collection(db, 'taken'));
      await setDoc(docRef, data);
      console.log('Aangemaakt met ID:', docRef.id);

    }
    document.getElementById('taak-preview-wrapper').style.display = 'none';
    document.getElementById('taak-stappen-wrapper').style.display = 'block';
    document.getElementById('taak-formulier').style.display = 'none';
    resetTaakState();
    wisCache('taken');
    laadTaken();
    setTimeout(() => toonMelding('taken', `Taak "${data.code}" opgeslagen.`, 'succes'), 100);
  } catch (e) {
    console.error('Firestore fout bij opslaan taak:', e);
    alert('Fout bij opslaan:\n\nCode: ' + e.code + '\nBericht: ' + e.message);
  }
}

// ===== PREVIEW RENDERER =====
function renderTaakPreview(taak) {
  const typeIconen = { website: '🌐', video: '▶️', classroom: '🎓', bestand: '📄', andere: '📎', std: '📄' };
  const basisUrl = './pictures/';

  // Instructie renderen met parameters ingevuld — gebruik parseMarkdown voor identieke output
  let instructieHtml = '';
  if (taak.templateInhoud) {
    let tekst = taak.templateInhoud;
    const params = taak.templateParams || {};
    Object.entries(params).forEach(([k, v]) => {
      tekst = tekst.replace(new RegExp(`\\{${k}\\}`, 'g'), v || `{${k}}`);
    });
    instructieHtml = `
      <div class="sectie wit">
        <div class="sectie-icoon"><img src="${basisUrl}instructies.png" alt="Instructies"></div>
        <div class="sectie-inhoud">
          <div class="sectie-titel">Instructies</div>
          <div class="preview-instructie-wrapper">${parseMarkdown(tekst)}</div>
        </div>
      </div>`;
  }

  // Voorkennis
  let voorkennisHtml = '';
  if (taak.heeftVoorkennis && taak.voorkennisData?.length) {
    const items = taak.voorkennisData.map(d => `<li>${d.tekst}</li>`).join('');
    voorkennisHtml = `
      <div class="sectie wit">
        <div class="sectie-icoon"><img src="${basisUrl}voorkennis.png" alt="Voorkennis"></div>
        <div class="sectie-inhoud">
          <div class="sectie-titel">Welke voorkennis heb je nodig?</div>
          <ul class="doel-lijst">${items}</ul>
        </div>
      </div>`;
  }

  // Succescriteria
  let scHtml = '';
  const scData = taak.scData || {};
  const lerenItems = (scData.leren || []);
  const evalItems = (scData.eval || []);
  if (lerenItems.length || evalItems.length) {
    let scInhoud = '';
    if (lerenItems.length) {
      scInhoud += `<div class="sc-subtitel">Wat leer je met deze taak?</div><ul class="doel-lijst">`;
      scInhoud += lerenItems.map(d => {
        const codes = (d.leerplandoel_codes || []).join(', ');
        return `<li>${d.tekst}${codes ? ` <span class="leerplandoel">(${codes})</span>` : ''}</li>`;
      }).join('');
      scInhoud += '</ul>';
    }
    if (evalItems.length) {
      scInhoud += `<div class="sc-subtitel">Waarop word je geëvalueerd bij deze taak?</div><ul class="doel-lijst">`;
      scInhoud += evalItems.map(d => {
        const codes = (d.leerplandoel_codes || []).join(', ');
        let scoreHtml = '';
        if (d.scores) scoreHtml = `<div class="score-tekst">${d.scores.replace(/\n/g, '<br>')}</div>`;
        return `<li>${d.tekst}${codes ? ` <span class="leerplandoel">(${codes})</span>` : ''}${scoreHtml}</li>`;
      }).join('');
      scInhoud += '</ul>';
    }
    scHtml = `
      <div class="sectie grijs">
        <div class="sectie-icoon"><img src="${basisUrl}succescriteria.png" alt="Succescriteria"></div>
        <div class="sectie-inhoud">
          <div class="sectie-titel">Succescriteria</div>
          ${scInhoud}
        </div>
      </div>`;
  }

  // Bronnen
  let bronnenHtml = '';
  const allBronnen = taak.bronnenData || [];
  if (allBronnen.length) {
    const tegels = allBronnen.map(b => {
      const icoon = b.icoon || typeIconen[b.type] || '📎';
      const href = b.link ? `href="${b.link}" target="_blank"` : 'href="#"';
      return `<a ${href} class="bron-tegel"><span class="bron-icoon">${icoon}</span>${b.label}</a>`;
    }).join('');
    bronnenHtml = `
      <div class="sectie grijs">
        <div class="sectie-icoon"><img src="${basisUrl}bronnen.png" alt="Bronnen"></div>
        <div class="sectie-inhoud">
          <div class="sectie-titel">Te gebruiken bronnen</div>
          <div class="bron-tegels">${tegels}</div>
        </div>
      </div>`;
  }

  // Indienwijze
  let indienHtml = '';
  const ind = taak.indienwijze || {};
  const rijen = [];
  if (ind.map) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon">📁</div><div class="indienen-rij-tekst">Bewaar alles in je map.</div></div>`);
  if (ind.digitaal) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon"><img src="${basisUrl}digitaal.png" style="width:32px;height:32px;object-fit:contain;"></div><div class="indienen-rij-tekst">Indienen in Google Classroom.</div></div>`);
  if (ind.vakje) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon">📥</div><div class="indienen-rij-tekst">In het vakje van ${taak.vak || 'het vak'}.</div></div>`);
  if (ind.anders && ind.andersText) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon">📌</div><div class="indienen-rij-tekst">${ind.andersText}</div></div>`);
  if (rijen.length) {
    indienHtml = `
      <div class="sectie geel">
        <div class="sectie-icoon"><img src="${basisUrl}indienen.png" alt="Indienen"></div>
        <div class="sectie-inhoud">
          <div class="sectie-titel">Indienen</div>
          <div class="indienen-rijen">${rijen.join('')}</div>
        </div>
      </div>`;
  }

  const tijd = taak.tijd === 'rooster' ? 'rooster'
    : (taak.tijdVerschilt && taak.tijdPerRoute)
      ? Object.entries(taak.tijdPerRoute).map(([r, t]) => `${r}:${t}'`).join(' / ')
      : `${taak.tijd}'`;
  return `
    <div class="taak-blok">
      <div class="titelbalk">${taak.code}: ${taak.titel} (${tijd})</div>
      ${voorkennisHtml}${scHtml}${instructieHtml}${bronnenHtml}${indienHtml}
    </div>`;
}

function inlineOpmaken(t) {
  return t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\[kleur:(\w+|#[0-9a-fA-F]{3,6})\](.+?)\[\/kleur\]/g, (m, k, t) => `<span style="color:${k};">${t}</span>`)
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" style="color:var(--blauw);">$1</a>')
    .replace(/\+\+/g, '<br>');
}

// ===== TAKEN OVERZICHT LADEN =====
export async function verwijderTaak(id, code) {
  if (!confirm(`Ben je zeker dat je taak ${code} wil verwijderen?`)) return;
  try {
    const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    await deleteDoc(doc(db, 'taken', id));
    wisCache('taken');
    toonMelding('taken', `Taak ${code} verwijderd.`, 'succes');
    laadTaken();
  } catch (e) {
    console.error(e);
    alert('Fout bij verwijderen: ' + e.message);
  }
}

export async function laadTaken() {
  const lader = document.getElementById('taken-lader');
  const tabel = document.getElementById('taken-tabel');
  const leeg = document.getElementById('taken-leeg');
  if (!lader) return;

  lader.style.display = 'block';
  if (tabel) tabel.style.display = 'none';
  if (leeg) leeg.style.display = 'none';

  try {
    const takenLijst = await haalCache('taken', db);
    let taken = [...takenLijst];

    const filterSj = document.getElementById('filter-taak-schooljaar')?.value || '';
    const filterStatus = document.getElementById('filter-taak-status')?.value || '';

    // Week dropdown bijwerken op basis van geselecteerd schooljaar
    const weekSel = document.getElementById('filter-taak-week');
    if (weekSel) {
      const huidigWeek = weekSel.value;
      if (filterSj) {
        const weken = genereerSchoolweken(filterSj);
        weekSel.innerHTML = '<option value="">Alle weken</option>' +
          weken.map(w => `<option value="${w.nr}" ${w.nr == huidigWeek ? 'selected' : ''}>${w.label}</option>`).join('');
      } else {
        weekSel.innerHTML = '<option value="">Alle weken</option>';
      }
    }
    const filterWeek = weekSel?.value || '';

    if (filterSj) taken = taken.filter(t => t.schooljaar === filterSj);
    if (filterWeek) taken = taken.filter(t => t.lesweek == filterWeek);
    if (filterStatus) taken = taken.filter(t => t.status === filterStatus);

    taken.sort((a, b) => {
      if (a.lesweek !== b.lesweek) return (a.lesweek || 0) - (b.lesweek || 0);
      return (a.volgorde || 0) - (b.volgorde || 0);
    });

    lader.style.display = 'none';
    if (!taken.length) { if (leeg) leeg.style.display = 'block'; return; }

    const statusKleur = { concept: 'badge-verdieping', actief: 'badge-basis', archief: 'badge-bg' };
    const tbody = document.getElementById('taken-tbody');
    if (tbody) tbody.innerHTML = taken.map(t => `
      <tr>
        <td><strong>${t.code}</strong></td>
        <td>${t.titel}</td>
        <td>${t.klas || '—'}</td>
        <td style="font-size:9.5pt;">${t.lesweek ? 'Week ' + t.lesweek : '—'}</td>
        <td style="font-size:9.5pt;">${(t.routes || []).filter(r => r !== 'geen').join(', ') || (t.routes?.includes('geen') ? '—' : '—')}</td>
        <td><span class="badge ${statusKleur[t.status] || 'badge-bg'}">${t.status}</span></td>

        <td>
          <button class="knop knop-secundair knop-klein" onclick="window._bewerkTaak('${t.id}')">✏️</button>
          <button class="knop knop-secundair knop-klein" onclick="window._kopieerTaak('${t.id}')">📋</button>
          <button class="knop knop-gevaar knop-klein" onclick="window._verwijderTaak('${t.id}', '${t.code}')">🗑️</button>
        </td>
      </tr>
    `).join('');
    if (tabel) tabel.style.display = 'block';
  } catch (e) {
    toonMelding('taken', 'Fout bij laden: ' + e.message, 'fout');
    lader.style.display = 'none';
  }
}

// ===== NIEUW / BEWERKEN / KOPIE =====
export function nieuweTaak() {
  resetTaakState();
  taakRefTeller = 0;
  alleBestaandeTaken = [];
  document.getElementById('taak-stappen-wrapper').style.display = 'block';
  document.getElementById('taak-preview-wrapper').style.display = 'none';
  document.getElementById('taak-formulier').style.display = 'block';
  document.getElementById('taak-formulier').scrollIntoView({ behavior: 'smooth' });
  renderStap0();
  toonStap(0);
}

export async function bewerkTaak(id) {
  const snap = await getDoc(doc(db, 'taken', id));
  if (!snap.exists()) return;
  laadTaakInFormulier(id, snap.data(), false);
}

export async function kopieerTaak(id) {
  const snap = await getDoc(doc(db, 'taken', id));
  if (!snap.exists()) return;
  laadTaakInFormulier(null, snap.data(), true);
}

async function laadTaakInFormulier(id, data, isKopie) {
  resetTaakState();
  bewerkId = isKopie ? null : id;
  isBewerkModus = !isKopie;
  huidigeTaak = { ...data, startKeuze: isKopie ? 'kopie' : 'aanpassen' };

  // Doelen herladen
  await zorgDoelenCache();
  geselecteerdeVK = (data.voorkennis || []).map(vkId => alleDoelen?.find(d => d.id === vkId)).filter(Boolean);
  const scLijst = data.succescriteria || [];
  geselecteerdeSC.leren = scLijst.filter(s => s.scIndeling === 'leren').map(s => alleDoelen?.find(d => d.id === s.id)).filter(Boolean);
  geselecteerdeSC.eval = scLijst.filter(s => s.scIndeling === 'eval').map(s => alleDoelen?.find(d => d.id === s.id)).filter(Boolean);

  // Bronnen
  await zorgBronnenCache();
  geselecteerdeBronnen = (data.bronnen || []).filter(b => !b.standaard).map(b => alleBronnen?.find(x => x.id === b.id) || b).filter(Boolean);

  // Template
  if (data.templateId) {
    const templates = await zorgTemplatesCache();
    const t = templates.find(x => x.id === data.templateId);
    const tmplInhoud = data.templateInhoud || t?.inhoud || '';
    templateData = { id: data.templateId, naam: t?.naam || '', inhoud: tmplInhoud, parameters: data.templateParams || {}, paramVolgorde: berekenParamVolgorde(tmplInhoud) };
  }

  document.getElementById('taak-formulier').style.display = 'block';
  document.getElementById('taak-preview-wrapper').style.display = 'none';
  renderStap0();

  // Stel radio in
  setTimeout(() => {
    const radio = document.querySelector(`input[name="taak-start-keuze"][value="${isKopie ? 'kopie' : 'aanpassen'}"]`);
    if (radio) radio.checked = true;
  }, 50);

  toonStap(1);
  vulFormulierStap1(data, isKopie);
}

function vulFormulierStap1(data, isKopie) {
  setTimeout(() => {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('taak-code', isKopie ? '' : (data.code || ''));
    set('taak-titel', data.titel || '');
    set('taak-type', data.type || 'taak');
    // Routes en tijdkeuze vóór toggleTijdVeld zetten
    ['G','B','Z','geen'].forEach(r => { const el = document.getElementById('route-' + r); if (el) el.checked = (data.routes || []).includes(r); });
    const tijdRadio = document.querySelector(`input[name="tijd-keuze"][value="${data.tijdVerschilt ? 'verschilt' : 'zelfde'}"]`);
    if (tijdRadio) tijdRadio.checked = true;
    toggleTijdVeld();
    // Tijdwaarden invullen
    if (data.tijdVerschilt && data.tijdPerRoute) {
      Object.entries(data.tijdPerRoute).forEach(([route, waarde]) => {
        const el = document.querySelector(`.tijd-route-veld[data-route="${route}"]`);
        if (el) el.value = waarde;
      });
    } else {
      set('taak-tijd', data.tijd === 'rooster' ? '' : (data.tijd || ''));
    }
    set('taak-vak', data.vak || 'Wiskunde');
    set('taak-klas', data.klas || '1a');
    set('taak-schooljaar', data.schooljaar || huidigSchooljaar());
    set('taak-omschrijving', data.omschrijving || '');
    set('taak-tags', (data.tags || []).join(', '));
    set('taak-volgtijdelijkheid', data.volgtijdelijkheid || '0.0');
    set('taak-volgorde', data.volgorde || '');
    set('taak-status', isKopie ? 'concept' : (data.status || 'concept'));
    vulLesweekDropdown(data.schooljaar || huidigSchooljaar());
    setTimeout(() => set('taak-lesweek', isKopie ? '' : (data.lesweek || '')), 50);
    // Fases
    ['verkennen','verwerken','inprenten','evalueren','herhalen'].forEach(f => { const el = document.getElementById('fase-' + f); if (el) el.checked = (data.fases || []).includes(f); });
    // Extra papier
    const ep = document.getElementById('taak-extra-papier'); if (ep) ep.checked = data.extraPapier === 'ja';
    // Referenties
    (data.referenties || []).forEach(r => voegTaakRefToe(r));
  }, 100);
}

// ===== ANNULEER =====
export function annuleerTaak() {
  document.getElementById('taak-formulier').style.display = 'none';
  document.getElementById('taak-preview-wrapper').style.display = 'none';
  document.getElementById('taak-stappen-wrapper').style.display = 'block';
  resetTaakState();
}

// ===== RESET =====
function resetTaakState() {
  huidigeTaak = {};
  bewerkId = null;
  isBewerkModus = false;
  geselecteerdeVK = [];
  geselecteerdeSC = { leren: [], eval: [] };
  geselecteerdeBronnen = [];
  templateData = null;
  taakRefTeller = 0;
  // alleDoelen niet wissen — cache herbruiken voor performantie
}
