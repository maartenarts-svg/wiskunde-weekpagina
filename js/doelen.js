import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';

// ===== STATE =====
let cache = null;
let bewerkId = null;
let leerplanTeller = 0;
let referentieTeller = 0;

// ===== CUSTOM DROPDOWN DATA =====
let alleLeerplancodes = [];
let alleReferentieCodes = [];

export async function laadDropdownData() {
  try {
    if (!alleLeerplancodes.length) {
      const snap = await getDocs(collection(db, 'leerplandoelen'));
      alleLeerplancodes = snap.docs
        .map(d => ({ code: d.data().code, omschrijving: d.data().doel || '' }))
        .filter(d => d.code)
        .sort((a, b) => {
          const v = c => c.startsWith('BG') ? 2 : c.startsWith('V') ? 1 : 0;
          if (v(a.code) !== v(b.code)) return v(a.code) - v(b.code);
          return a.code.localeCompare(b.code, 'nl', { numeric: true });
        });
    }
    if (!alleReferentieCodes.length) {
      const snap = await getDocs(collection(db, 'hoofdstukken'));
      const refs = [];
      snap.docs.forEach(d => {
        const h = d.data();
        refs.push({ code: h.nummer + '.0', omschrijving: 'Hoofdstuk ' + h.nummer + ': ' + h.titel });
        (h.paragrafen || []).forEach(p => refs.push({ code: p.nummer, omschrijving: '§' + p.nummer + ' ' + p.titel }));
      });
      alleReferentieCodes = refs.sort((a, b) => a.code.localeCompare(b.code, 'nl', { numeric: true }));
    }
  } catch (e) {
    console.error('Fout bij laden dropdown data:', e);
  }
}

// ===== CUSTOM DROPDOWN FUNCTIES =====
export function cdFilter(input) {
  const wrapper = input.closest('.cd-wrapper');
  const lijst = wrapper.querySelector('.cd-lijst');
  const type = input.dataset.type;
  const zoek = input.value.trim().toLowerCase();
  const data = type === 'leerplan' ? alleLeerplancodes : alleReferentieCodes;
  const gefilterd = zoek
    ? data.filter(d => d.code.toLowerCase().includes(zoek) || d.omschrijving.toLowerCase().includes(zoek))
    : data;

  if (!gefilterd.length) {
    lijst.innerHTML = '<div class="cd-geen">Geen resultaten — eigen invoer wordt bewaard.</div>';
  } else {
    lijst.innerHTML = gefilterd.slice(0, 50).map(d => `
      <div class="cd-item" onmousedown="window._cdKies(event, this, '${d.code.replace(/'/g, "\\'")}')">
        <span class="cd-code">${d.code}</span>
        <span class="cd-omschrijving">${d.omschrijving.length > 60 ? d.omschrijving.slice(0, 60) + '…' : d.omschrijving}</span>
      </div>
    `).join('');
  }
  lijst.classList.add('zichtbaar');

  const waarschuwing = wrapper.querySelector('.cd-waarschuwing');
  waarschuwing.style.display = (input.value.trim() && !data.find(d => d.code === input.value.trim())) ? 'block' : 'none';
}

export function cdKies(event, itemEl, code) {
  event.preventDefault();
  const wrapper = itemEl.closest('.cd-wrapper');
  wrapper.querySelector('.cd-input').value = code;
  wrapper.querySelector('.cd-lijst').classList.remove('zichtbaar');
  wrapper.querySelector('.cd-waarschuwing').style.display = 'none';
}

export function cdVerberg(input) {
  setTimeout(() => {
    input.closest('.cd-wrapper')?.querySelector('.cd-lijst')?.classList.remove('zichtbaar');
  }, 200);
}

// ===== LEERPLANDOEL-CODES =====
export function voegLeerplancodeToe(waarde = '') {
  const container = document.getElementById('leerplan-container');
  document.getElementById('geen-leerplancodes').style.display = 'none';
  leerplanTeller++;
  const id = 'lp-code-' + leerplanTeller;
  const div = document.createElement('div');
  div.className = 'subdoel-item';
  div.id = id;
  div.innerHTML = `
    <div class="cd-wrapper" style="flex:1;">
      <input type="text" class="cd-input leerplancode-waarde" placeholder="bv. 6.1" value="${waarde}"
        autocomplete="off" data-type="leerplan"
        oninput="window._cdFilter(this)" onfocus="window._cdFilter(this)" onblur="window._cdVerberg(this)">
      <div class="cd-lijst"></div>
      <div class="cd-waarschuwing">⚠ Deze code bestaat nog niet in de databank.</div>
    </div>
    <button class="subdoel-verwijder" onclick="window._verwijderLeerplancode('${id}')">✕</button>
  `;
  container.appendChild(div);
}

export function verwijderLeerplancode(id) {
  document.getElementById(id)?.remove();
  if (!document.querySelectorAll('.leerplancode-waarde').length) {
    document.getElementById('geen-leerplancodes').style.display = 'block';
  }
}

function haalLeerplancodes() {
  return Array.from(document.querySelectorAll('.leerplancode-waarde'))
    .map(i => i.value.trim()).filter(v => v);
}

// ===== REFERENTIES =====
export function voegReferentieToe(waarde = '') {
  const container = document.getElementById('referentie-container');
  document.getElementById('geen-referenties').style.display = 'none';
  referentieTeller++;
  const id = 'ref-' + referentieTeller;
  const div = document.createElement('div');
  div.className = 'subdoel-item';
  div.id = id;
  div.innerHTML = `
    <div class="cd-wrapper" style="flex:1;">
      <input type="text" class="cd-input referentie-waarde" placeholder="bv. 7.1" value="${waarde}"
        autocomplete="off" data-type="referentie"
        oninput="window._cdFilter(this)" onfocus="window._cdFilter(this)" onblur="window._cdVerberg(this)">
      <div class="cd-lijst"></div>
      <div class="cd-waarschuwing">⚠ Deze referentie bestaat nog niet in de databank.</div>
    </div>
    <button class="subdoel-verwijder" onclick="window._verwijderReferentie('${id}')">✕</button>
  `;
  container.appendChild(div);
}

export function verwijderReferentie(id) {
  document.getElementById(id)?.remove();
  if (!document.querySelectorAll('.referentie-waarde').length) {
    document.getElementById('geen-referenties').style.display = 'block';
  }
}

function haalReferenties() {
  return Array.from(document.querySelectorAll('.referentie-waarde'))
    .map(i => i.value.trim()).filter(v => v);
}

// ===== SCORES TONEN/VERBERGEN =====
export function toggleScores() {
  const evalueerbaar = document.getElementById('doel-evalueerbaar').value;
  document.getElementById('scores-blok').style.display = evalueerbaar === 'ja' ? 'block' : 'none';
}

// ===== RESET FORMULIER =====
export function annuleerDoel() {
  document.getElementById('doel-tekst').value = '';
  document.getElementById('doel-type').value = 'succescriterium';
  document.getElementById('leerplan-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
  document.getElementById('geen-leerplancodes').style.display = 'block';
  document.getElementById('doel-evalueerbaar').value = 'nee';
  document.getElementById('doel-scores').value = '';
  document.getElementById('doel-notities').value = '';
  document.getElementById('scores-blok').style.display = 'none';
  document.getElementById('referentie-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
  document.getElementById('geen-referenties').style.display = 'block';
  document.getElementById('formulier-doel-titel').textContent = 'Nieuw doel toevoegen';
  document.getElementById('annuleer-doel').style.display = 'none';
  bewerkId = null;
}

// ===== CSV IMPORT =====
export async function importeerDoelenCSV(event) {
  const bestand = event.target.files[0];
  if (!bestand) return;
  const tekst = await bestand.text();

  function parseCSV(tekst) {
    const rijen = [];
    let huidigRij = [], huidigVeld = '', inAanhalingstekens = false;
    let i = 0;
    while (i < tekst.length) {
      const teken = tekst[i];
      if (teken === '"') {
        if (inAanhalingstekens && tekst[i + 1] === '"') { huidigVeld += '"'; i += 2; }
        else { inAanhalingstekens = !inAanhalingstekens; i++; }
      } else if (teken === ',' && !inAanhalingstekens) {
        huidigRij.push(huidigVeld.trim()); huidigVeld = ''; i++;
      } else if ((teken === '\n' || (teken === '\r' && tekst[i + 1] === '\n')) && !inAanhalingstekens) {
        huidigRij.push(huidigVeld.trim()); huidigVeld = '';
        if (huidigRij.some(v => v)) rijen.push(huidigRij);
        huidigRij = []; i += (teken === '\r') ? 2 : 1;
      } else if (teken === '\r' && !inAanhalingstekens) { i++; }
      else { huidigVeld += teken; i++; }
    }
    if (huidigVeld || huidigRij.length) {
      huidigRij.push(huidigVeld.trim());
      if (huidigRij.some(v => v)) rijen.push(huidigRij);
    }
    return rijen;
  }

  const alleRijen = parseCSV(tekst);
  const dataRijen = alleRijen.slice(1).filter(r => r[0] && r[0].trim());

  // Samenvoegen: doelen met zelfde tekst+type+leerplan krijgen gecombineerde referenties
  const doelMap = new Map();
  for (const rij of dataRijen) {
    const doelTekst = (rij[0] || '').trim();
    const type = (rij[1] || 'succescriterium').trim();
    const leerplan = (rij[2] || '').trim();
    const referentie = (rij[3] || '').trim();
    const evalueerbaar = (rij[4] || 'nee').trim() || 'nee';
    const scores = (rij[5] || '').trim().replace(/###/g, '\n');
    if (!doelTekst) continue;
    const sleutel = doelTekst + '|' + type + '|' + leerplan;
    if (doelMap.has(sleutel)) {
      const bestaand = doelMap.get(sleutel);
      if (referentie && !bestaand.referenties.includes(referentie)) bestaand.referenties.push(referentie);
    } else {
      doelMap.set(sleutel, {
        tekst: doelTekst, type,
        leerplandoel_codes: leerplan ? [leerplan] : [],
        referenties: referentie ? [referentie] : [],
        evalueerbaar, scores, notities: '',
        aangepastOp: new Date().toISOString(),
      });
    }
  }

  const doelen = Array.from(doelMap.values());
  if (!doelen.length) { toonMelding('doelen', 'Geen geldige doelen gevonden.', 'fout'); return; }

  const voortgang = document.getElementById('doelen-import-voortgang');
  const balk = document.getElementById('doelen-import-balk');
  const importTekst = document.getElementById('doelen-import-tekst');
  voortgang.style.display = 'block';

  let opgeslagen = 0, fouten = 0;
  for (let i = 0; i < doelen.length; i++) {
    importTekst.textContent = `Bezig... ${i + 1} van ${doelen.length}`;
    balk.style.width = ((i + 1) / doelen.length * 100) + '%';
    try {
      await setDoc(doc(collection(db, 'doelen')), doelen[i]);
      opgeslagen++;
    } catch (e) { fouten++; }
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 200));
  }

  cache = null;
  voortgang.style.display = 'none';
  event.target.value = '';
  toonMelding('doelen',
    fouten === 0 ? `✓ ${opgeslagen} doelen geïmporteerd.` : `${opgeslagen} geïmporteerd, ${fouten} mislukt.`,
    fouten === 0 ? 'succes' : 'fout'
  );
  laadDoelen();
}

// ===== OPSLAAN =====
export async function slaDoelOp() {
  const tekst = document.getElementById('doel-tekst').value.trim();
  const evalueerbaar = document.getElementById('doel-evalueerbaar').value;
  const scores = document.getElementById('doel-scores').value.trim();
  if (!tekst) { toonMelding('doelen', 'Vul minstens de tekst in.', 'fout'); return; }
  if (evalueerbaar === 'ja' && !scores) {
    toonMelding('doelen', 'Voeg scores toe als het doel evalueerbaar is.', 'fout'); return;
  }

  const data = {
    tekst,
    type: document.getElementById('doel-type').value,
    leerplandoel_codes: haalLeerplancodes(),
    referenties: haalReferenties(),
    evalueerbaar,
    scores: scores || '',
    notities: document.getElementById('doel-notities').value.trim(),
    aangepastOp: new Date().toISOString(),
  };

  try {
    const docRef = bewerkId ? doc(db, 'doelen', bewerkId) : doc(collection(db, 'doelen'));
    await setDoc(docRef, data);
    cache = null;
    toonMelding('doelen', 'Doel opgeslagen.', 'succes');
    annuleerDoel();
    laadDoelen();
  } catch (e) {
    toonMelding('doelen', 'Fout bij opslaan: ' + e.message, 'fout');
  }
}

// ===== LADEN =====
export async function laadDoelen() {
  document.getElementById('doelen-lader').style.display = 'block';
  document.getElementById('doelen-tabel').style.display = 'none';
  document.getElementById('doelen-leeg').style.display = 'none';

  try {
    if (!cache) {
      const snap = await getDocs(collection(db, 'doelen'));
      cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    let doelen = cache;

    // Filteropties bijwerken
    const leerplanSet = [...new Set(doelen.flatMap(d =>
      d.leerplandoel_codes || (d.leerplandoel_code ? [d.leerplandoel_code] : [])
    ).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));

    const refSet = [...new Set(doelen.flatMap(d => d.referenties || []))]
      .sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));

    const leerplanFilter = document.getElementById('filter-doel-leerplan');
    const huidigLeerplan = leerplanFilter.value;
    leerplanFilter.innerHTML = '<option value="">Alle leerplandoelen</option>' +
      leerplanSet.map(c => `<option value="${c}" ${c === huidigLeerplan ? 'selected' : ''}>${c}</option>`).join('');

    const refFilter = document.getElementById('filter-doel-referentie');
    const huidigRef = refFilter.value;
    refFilter.innerHTML = '<option value="">Alle referenties</option>' +
      refSet.map(r => `<option value="${r}" ${r === huidigRef ? 'selected' : ''}>${r}</option>`).join('');

    // Filteren
    const filterType = document.getElementById('filter-doel-type').value;
    const filterLeerplan = leerplanFilter.value;
    const filterRef = refFilter.value;
    if (filterType) doelen = doelen.filter(d => d.type === filterType);
    if (filterLeerplan) doelen = doelen.filter(d =>
      (d.leerplandoel_codes || (d.leerplandoel_code ? [d.leerplandoel_code] : [])).includes(filterLeerplan)
    );
    if (filterRef) doelen = doelen.filter(d => (d.referenties || []).includes(filterRef));

    doelen.sort((a, b) => a.tekst.localeCompare(b.tekst, 'nl'));

    document.getElementById('doelen-lader').style.display = 'none';
    if (!doelen.length) { document.getElementById('doelen-leeg').style.display = 'block'; return; }

    const tbody = document.getElementById('doelen-tbody');
    tbody.innerHTML = doelen.map(d => `
      <tr>
        <td style="max-width:300px;">${d.tekst}</td>
        <td><span class="badge ${d.type === 'succescriterium' ? 'badge-basis' : 'badge-bg'}">${d.type === 'succescriterium' ? 'SC' : 'VK'}</span></td>
        <td style="font-size:9.5pt;">${(d.leerplandoel_codes || (d.leerplandoel_code ? [d.leerplandoel_code] : [])).join(', ') || '—'}</td>
        <td style="font-size:9.5pt;">${(d.referenties || []).join(', ') || '—'}</td>
        <td>${d.evalueerbaar === 'ja' ? '✓' : '—'}</td>
        <td>
          <button class="knop knop-secundair knop-klein" onclick="window._bewerkDoel('${d.id}')">✏️</button>
          <button class="knop knop-gevaar knop-klein" onclick="window._verwijderDoel('${d.id}')">🗑️</button>
        </td>
      </tr>
    `).join('');
    document.getElementById('doelen-tabel').style.display = 'block';
  } catch (e) {
    toonMelding('doelen', 'Fout bij laden: ' + e.message, 'fout');
    document.getElementById('doelen-lader').style.display = 'none';
  }
}

// ===== BEWERKEN =====
export async function bewerkDoel(id) {
  try {
    const snap = await getDoc(doc(db, 'doelen', id));
    if (!snap.exists()) return;
    const d = snap.data();
    document.getElementById('doel-tekst').value = d.tekst || '';
    document.getElementById('doel-type').value = d.type || 'succescriterium';
    document.getElementById('leerplan-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
    const codes = d.leerplandoel_codes || (d.leerplandoel_code ? [d.leerplandoel_code] : []);
    document.getElementById('geen-leerplancodes').style.display = codes.length ? 'none' : 'block';
    codes.forEach(c => voegLeerplancodeToe(c));
    document.getElementById('doel-evalueerbaar').value = d.evalueerbaar || 'nee';
    document.getElementById('doel-scores').value = d.scores || '';
    document.getElementById('doel-notities').value = d.notities || '';
    document.getElementById('scores-blok').style.display = d.evalueerbaar === 'ja' ? 'block' : 'none';
    document.getElementById('referentie-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
    document.getElementById('geen-referenties').style.display = (d.referenties?.length) ? 'none' : 'block';
    (d.referenties || []).forEach(r => voegReferentieToe(r));
    document.getElementById('formulier-doel-titel').textContent = 'Doel bewerken';
    document.getElementById('annuleer-doel').style.display = 'inline-flex';
    bewerkId = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toonMelding('doelen', 'Fout bij laden: ' + e.message, 'fout');
  }
}

// ===== VERWIJDEREN =====
export async function verwijderDoel(id) {
  if (!confirm('Ben je zeker dat je dit doel wil verwijderen?')) return;
  try {
    await deleteDoc(doc(db, 'doelen', id));
    cache = null;
    toonMelding('doelen', 'Doel verwijderd.', 'succes');
    laadDoelen();
  } catch (e) {
    toonMelding('doelen', 'Fout bij verwijderen: ' + e.message, 'fout');
  }
}

// ===== CACHE EXPORT =====
export function getCache() { return cache; }
