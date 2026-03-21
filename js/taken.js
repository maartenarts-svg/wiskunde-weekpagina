import { db } from './firebase-config.js';
import { auth } from './firebase-config.js';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding, toonSectie } from './ui.js';
import { parseMarkdown, cacheTemplates, actievEditor, toggleSyntax } from './templates.js';
import { vulDatalijsten, cacheDoelen } from './doelen.js';
import { cacheBronnen } from './bronnen.js';
import { cache as cacheHoofdstukken } from './leerplandoelen.js';

  // ===== TAKEN =====

  let bewerkTaakId = null;
  let taakRefTeller = 0;
  let geselecteerdeVK = {}; // id -> data
  let geselecteerdeSC = {}; // id -> data
  let geselecteerdeBronnen = {}; // id -> data
  let extraEvalForms = [];
  let cacheTaken = { alle: null };
  let alleDoelen = null;
  let alleBronnenCache = null;
  let alleTemplatesCache = null;

  // Huidig schooljaar berekenen
export function huidigSchooljaar() {
    const nu = new Date();
    const jaar = nu.getFullYear();
    const maand = nu.getMonth() + 1;
    return maand >= 9 ? `${jaar}-${jaar+1}` : `${jaar-1}-${jaar}`;
  }

  // Weekfilter vullen
export function vulWeekDropdowns() {
    const opties = Array.from({length: 38}, (_, i) => `<option value="${i+1}">Week ${i+1}</option>`).join('');
    ['filter-taak-week', 'week-nr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = (id === 'filter-taak-week' ? '<option value="">Alle weken</option>' : '<option value="">Kies week...</option>') + opties;
    });
  }

  // Tabbladen
  window.toonTabblad = (id, knop) => {
    document.querySelectorAll('.tabblad-inhoud').forEach(t => t.classList.remove('actief'));
    document.querySelectorAll('.tabblad-knop').forEach(k => k.classList.remove('actief'));
    document.getElementById(id).classList.add('actief');
    knop.classList.add('actief');
    if (id === 'tb-inhoud') {
      laadDoelKeuzes();
      laadBronKeuzes();
      laadTemplateDropdown();
    }
  };

  // Taak referenties
  window.voegTaakRefToe = (waarde = '') => {
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
          oninput="cdFilter(this)" onfocus="cdFilter(this)" onblur="cdVerberg(this)">
        <div class="cd-lijst" id="cd-lijst-taakref-${id}"></div>
        <div class="cd-waarschuwing">⚠ Onbekende referentie.</div>
      </div>
      <button class="subdoel-verwijder" onclick="verwijderTaakRef('${id}')">✕</button>
    `;
    container.appendChild(div);
  };

  window.verwijderTaakRef = (id) => {
    document.getElementById(id).remove();
    if (!document.querySelectorAll('.taak-ref-waarde').length)
      document.getElementById('geen-taak-refs').style.display = 'block';
  };

  function haalTaakRefs() {
    return Array.from(document.querySelectorAll('.taak-ref-waarde')).map(i => i.value.trim()).filter(v => v);
  }

  // Indienen toggle
  window.toggleIndienenExtra = (id) => {
    const el = document.getElementById(id);
    const checkbox = document.getElementById(id.replace('-extra', ''));
    el.classList.toggle('zichtbaar', checkbox.checked);
  };

  // Evaluatievorm extra
  window.voegEvalToe = () => {
    const input = document.getElementById('eval-extra');
    const waarde = input.value.trim();
    if (!waarde) return;
    extraEvalForms.push(waarde);
    input.value = '';
    renderEvalExtra();
  };

  function renderEvalExtra() {
    document.getElementById('eval-extra-lijst').innerHTML = extraEvalForms.map((e, i) =>
      `<span class="badge badge-basis" style="margin-right:6px;cursor:pointer;" onclick="verwijderEval(${i})">${e} ✕</span>`
    ).join('');
  }

  window.verwijderEval = (i) => {
    extraEvalForms.splice(i, 1);
    renderEvalExtra();
  };

  // Instructie type toggle
  window.toggleInstructieType = () => {
    const isTemplate = document.getElementById('instr-template').checked;
    document.getElementById('instr-template-blok').style.display = isTemplate ? 'block' : 'none';
    document.getElementById('instr-vrij-blok').style.display = isTemplate ? 'none' : 'block';
  };

  window.updatePreviewTaak = () => {
    const ta = document.getElementById('taak-instructies-vrij');
    document.getElementById('taak-instructies-preview').innerHTML = parseMarkdown(ta.value);
    ta.style.height = 'auto';
    ta.style.height = Math.max(320, ta.scrollHeight) + 'px';
  };

  window.detecteerParametersTaak = () => {
    const inhoud = document.getElementById('taak-instructies-vrij').value;
    const gevonden = [...new Set([...inhoud.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
    const container = document.getElementById('param-container-taak');
    const lijst = document.getElementById('param-lijst-taak');
    if (!gevonden.length) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const bestaande = {};
    lijst.querySelectorAll('.param-input').forEach(inp => { bestaande[inp.dataset.param] = inp.value; });
    lijst.innerHTML = gevonden.map(p => `
      <div class="param-rij">
        <div class="param-naam">{${p}}</div>
        <input type="text" class="param-input" data-param="${p}" placeholder="Standaardwaarde..." value="${bestaande[p] || ''}">
      </div>
    `).join('');
  };

  window.toggleSyntaxTaak = () => {
    actievEditor = document.getElementById('taak-instructies-vrij');
    toggleSyntax();
  };

  window.slaInstructiesAlsTemplateOp = async () => {
    const inhoud = document.getElementById('taak-instructies-vrij').value.trim();
    if (!inhoud) { alert('Geen instructies om op te slaan.'); return; }
    const naam = prompt('Naam voor de template:');
    if (!naam) return;
    const type = prompt('Type (les/taak/rekenvaardigheden/andere):', 'les');
    const parameters = {};
    document.querySelectorAll('#param-lijst-taak .param-input').forEach(inp => {
      parameters[inp.dataset.param] = inp.value.trim();
    });
    try {
      await setDoc(doc(collection(db, 'templates')), { naam, type: type || 'les', inhoud, parameters, aangepastOp: new Date().toISOString() });
      cacheTemplates.alle = null;
      alert(`Template "${naam}" opgeslagen!`);
    } catch(e) { alert('Fout: ' + e.message); }
  };

  // Template dropdown laden
  async function laadTemplateDropdown() {
    if (!alleTemplatesCache) {
      const snap = await getDocs(collection(db, 'templates'));
      alleTemplatesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      alleTemplatesCache.sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));
    }
    const sel = document.getElementById('taak-template-id');
    const huidig = sel.value;
    sel.innerHTML = '<option value="">Kies template...</option>' +
      alleTemplatesCache.map(t => `<option value="${t.id}" ${t.id === huidig ? 'selected' : ''}>${t.naam}</option>`).join('');
  }

  window.laadTemplateParams = () => {
    const id = document.getElementById('taak-template-id').value;
    const blok = document.getElementById('template-params-blok');
    const lijst = document.getElementById('template-params-lijst');
    if (!id || !alleTemplatesCache) { blok.style.display = 'none'; return; }
    const tmpl = alleTemplatesCache.find(t => t.id === id);
    if (!tmpl) { blok.style.display = 'none'; return; }
    const params = tmpl.parameters || {};
    if (!Object.keys(params).length) { blok.style.display = 'none'; return; }
    blok.style.display = 'block';
    lijst.innerHTML = Object.entries(params).map(([naam, std]) => `
      <div class="param-rij">
        <div class="param-naam">{${naam}}</div>
        <input type="text" class="param-input" data-param="${naam}" placeholder="Standaardwaarde..." value="${std}">
      </div>
    `).join('');
  };

  // Doelen laden voor keuze
  async function laadDoelKeuzes() {
    if (!alleDoelen) {
      const snap = await getDocs(collection(db, 'doelen'));
      alleDoelen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    // Vul filteropties
    const leerplanSet = [...new Set(alleDoelen.flatMap(d => d.leerplandoel_codes || [d.leerplandoel_code].filter(Boolean)))].sort((a,b) => a.localeCompare(b,'nl',{numeric:true}));
    const refSet = [...new Set(alleDoelen.flatMap(d => d.referenties || []))].sort((a,b) => a.localeCompare(b,'nl',{numeric:true}));
    ['vk','sc'].forEach(type => {
      const lp = document.getElementById(`filter-${type}-leerplan`);
      const rf = document.getElementById(`filter-${type}-ref`);
      if (lp) lp.innerHTML = '<option value="">Alle leerplandoelen</option>' + leerplanSet.map(c => `<option value="${c}">${c}</option>`).join('');
      if (rf) rf.innerHTML = '<option value="">Alle referenties</option>' + refSet.map(r => `<option value="${r}">${r}</option>`).join('');
    });
    filterDoelKeuzes('vk');
    filterDoelKeuzes('sc');
  }

  window.filterDoelKeuzes = (soort) => {
    if (!alleDoelen) return;
    const zoek = document.getElementById(`zoek-${soort}`)?.value.toLowerCase() || '';
    const lp = document.getElementById(`filter-${soort}-leerplan`)?.value || '';
    const ref = document.getElementById(`filter-${soort}-ref`)?.value || '';
    const typeFilter = soort === 'vk' ? 'voorkennis' : 'succescriterium';

    let gefilterd = alleDoelen.filter(d => d.type === typeFilter);
    if (zoek) gefilterd = gefilterd.filter(d => d.tekst.toLowerCase().includes(zoek));
    if (lp) gefilterd = gefilterd.filter(d => (d.leerplandoel_codes || [d.leerplandoel_code].filter(Boolean)).includes(lp));
    if (ref) gefilterd = gefilterd.filter(d => (d.referenties || []).includes(ref));

    const geselecteerd = soort === 'vk' ? geselecteerdeVK : geselecteerdeSC;
    const container = document.getElementById(`doel-lijst-${soort}`);
    if (!gefilterd.length) {
      container.innerHTML = '<div style="padding:12px;font-size:9.5pt;color:var(--tekst-licht);">Geen doelen gevonden.</div>';
      return;
    }
    container.innerHTML = gefilterd.map(d => `
      <div class="doel-keuze-item ${geselecteerd[d.id] ? 'geselecteerd' : ''}" onclick="toggleDoel('${soort}', '${d.id}')">
        <div style="font-size:16px;">${geselecteerd[d.id] ? '✓' : '○'}</div>
        <div>
          <div class="doel-keuze-tekst">${d.tekst}</div>
          <div class="doel-keuze-meta">${(d.leerplandoel_codes || [d.leerplandoel_code].filter(Boolean)).join(', ')} · ${(d.referenties || []).join(', ')}</div>
        </div>
      </div>
    `).join('');
  };

  window.toggleDoel = (soort, id) => {
    const geselecteerd = soort === 'vk' ? geselecteerdeVK : geselecteerdeSC;
    const doel = alleDoelen.find(d => d.id === id);
    if (!doel) return;
    if (geselecteerd[id]) delete geselecteerd[id];
    else geselecteerd[id] = doel;
    filterDoelKeuzes(soort);
    renderGeselecteerdeDoelen(soort);
  };


  // Bronnen laden
  async function laadBronKeuzes() {
    if (!alleBronnenCache) {
      const snap = await getDocs(collection(db, 'bronnen'));
      alleBronnenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    filterBronKeuzes();
  }

  window.filterBronKeuzes = () => {
    if (!alleBronnenCache) return;
    const zoek = document.getElementById('zoek-bron')?.value.toLowerCase() || '';
    const type = document.getElementById('filter-bron-keuze-type')?.value || '';
    let gefilterd = alleBronnenCache;
    if (zoek) gefilterd = gefilterd.filter(b => b.label.toLowerCase().includes(zoek));
    if (type) gefilterd = gefilterd.filter(b => b.type === type);
    const container = document.getElementById('bron-keuze-lijst');
    if (!gefilterd.length) {
      container.innerHTML = '<div style="padding:12px;font-size:9.5pt;color:var(--tekst-licht);">Geen bronnen gevonden.</div>';
      return;
    }
    const iconen = { website:'🌐', video:'▶️', classroom:'🎓', bestand:'📄', andere:'📎' };
    container.innerHTML = gefilterd.map(b => `
      <div class="doel-keuze-item ${geselecteerdeBronnen[b.id] ? 'geselecteerd' : ''}" onclick="toggleBron('${b.id}')">
        <div style="font-size:16px;">${geselecteerdeBronnen[b.id] ? '✓' : '○'}</div>
        <div>
          <div class="doel-keuze-tekst">${iconen[b.type] || '📎'} ${b.label}</div>
          <div class="doel-keuze-meta">${b.type} ${b.referentie ? '· ' + b.referentie : ''}</div>
        </div>
      </div>
    `).join('');
  };

  window.toggleBron = (id) => {
    const bron = alleBronnenCache.find(b => b.id === id);
    if (!bron) return;
    if (geselecteerdeBronnen[id]) delete geselecteerdeBronnen[id];
    else geselecteerdeBronnen[id] = bron;
    filterBronKeuzes();
    renderGeselecteerdeBronnen();
  };

  function renderGeselecteerdeBronnen() {
    const container = document.getElementById('geselecteerde-bronnen');
    const geenEl = document.getElementById('geen-bronnen-sel');
    const items = Object.values(geselecteerdeBronnen);
    if (!items.length) {
      geenEl.style.display = 'block';
      container.querySelectorAll('.geselecteerd-doel-item').forEach(e => e.remove());
      return;
    }
    geenEl.style.display = 'none';
    container.querySelectorAll('.geselecteerd-doel-item').forEach(e => e.remove());
    items.forEach(b => {
      const div = document.createElement('div');
      div.className = 'geselecteerd-doel-item';
      div.innerHTML = `<span style="flex:1;">${b.label}</span><button class="verwijder-doel" onclick="toggleBron('${b.id}')">✕</button>`;
      container.appendChild(div);
    });
  }

  // ===== NIEUWE TAAK / BEWERKEN =====

  window.nieuweTaak = () => {
    bewerkTaakId = null;
    resetTaakFormulier();
    document.getElementById('taak-formulier').style.display = 'block';
    document.getElementById('formulier-taak-titel').textContent = 'Nieuwe taak';
    updateVersieKnop();
    document.getElementById('taak-schooljaar').value = huidigSchooljaar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function resetTaakFormulier() {
    ['taak-code','taak-titel','taak-omschrijving','taak-volgtijdelijkheid','taak-tags','taak-notities','ind-map-info','ind-digitaal-link','ind-digitaal-deadline','ind-vakje-deadline','ind-uitzondering-info','eval-extra'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('taak-tijd').value = '';
    if (document.getElementById('taak-type')) { document.getElementById('taak-type').value = 'taak'; toggleTaakType(); }
    document.getElementById('taak-vak').value = 'Wiskunde';
    document.getElementById('taak-klas').value = '';
    document.getElementById('taak-schooljaar').value = huidigSchooljaar();
    document.getElementById('taak-lesweek').value = '';
    document.getElementById('taak-status').value = 'concept';
    document.getElementById('taak-papier').value = 'nee';
    ['route-G','route-B','route-Z'].forEach(id => document.getElementById(id).checked = false);
    document.querySelectorAll('#tb-algemeen input[type="checkbox"][value]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#tb-indienen input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      const extra = document.getElementById(cb.id + '-extra');
      if (extra) extra.classList.remove('zichtbaar');
    });
    document.querySelectorAll('#tb-indienen input[type="checkbox"][value]').forEach(cb => cb.checked = false);
    document.getElementById('taak-ref-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
    document.getElementById('geen-taak-refs').style.display = 'block';
    document.getElementById('sc-titel-leren').checked = true;
    document.getElementById('sc-titel-eval').checked = false;
    document.getElementById('instr-template').checked = true;
    toggleInstructieType();
    document.getElementById('taak-template-id').value = '';
    document.getElementById('template-params-blok').style.display = 'none';
    document.getElementById('taak-instructies-vrij').value = '';
    document.getElementById('taak-instructies-preview').innerHTML = '';
    geselecteerdeVK = {};
    geselecteerdeSC = {};
    geselecteerdeBronnen = {};
    extraEvalForms = [];
    renderEvalExtra();
    document.getElementById('geen-vk').style.display = 'block';
    document.getElementById('geen-sc').style.display = 'block';
    document.getElementById('geen-bronnen-sel').style.display = 'block';
    document.querySelectorAll('#geselecteerde-vk .geselecteerd-doel-item, #geselecteerde-sc .geselecteerd-doel-item, #geselecteerde-bronnen .geselecteerd-doel-item').forEach(e => e.remove());
    toonTabblad('tb-algemeen', document.querySelector('.tabblad-knop'));
    bewerkTaakId = null;
  }

  window.annuleerTaak = () => {
    document.getElementById('taak-formulier').style.display = 'none';
    resetTaakFormulier();
  };

  // ===== OPSLAAN =====

  window.slaaTaakOp = async (nieuweVersie = false) => {
    const verplicht = { 'taak-code': 'Code', 'taak-titel': 'Titel', 'taak-tijd': 'Tijd', 'taak-klas': 'Klas', 'taak-lesweek': 'Lesweek' };
    for (const [id, naam] of Object.entries(verplicht)) {
      if (!document.getElementById(id).value.trim()) {
        toonMelding('taken', `${naam} is verplicht.`, 'fout');
        return;
      }
    }

    const routes = ['G','B','Z'].filter(r => document.getElementById('route-' + r).checked);
    const fases = [...document.querySelectorAll('#tb-algemeen input[type="checkbox"][value]:checked')].map(cb => cb.value);
    const evalVormen = [...document.querySelectorAll('#tb-indienen input[type="checkbox"][value]:checked')].map(cb => cb.value).concat(extraEvalForms);

    const indienwijze = {
      map: document.getElementById('ind-map').checked ? { actief: true, info: document.getElementById('ind-map-info').value.trim() } : null,
      digitaal: document.getElementById('ind-digitaal').checked ? { actief: true, link: document.getElementById('ind-digitaal-link').value.trim(), deadline: document.getElementById('ind-digitaal-deadline').value.trim() } : null,
      vakje: document.getElementById('ind-vakje').checked ? { actief: true, deadline: document.getElementById('ind-vakje-deadline').value.trim() } : null,
      uitzondering: document.getElementById('ind-uitzondering').checked ? { actief: true, info: document.getElementById('ind-uitzondering-info').value.trim() } : null,
    };

    const isTemplate = document.getElementById('instr-template').checked;
    const templateId = isTemplate ? document.getElementById('taak-template-id').value : null;
    const templateParams = {};
    if (isTemplate) {
      document.querySelectorAll('#template-params-lijst .param-input').forEach(inp => { templateParams[inp.dataset.param] = inp.value.trim(); });
    }
    const vrijevInstructies = isTemplate ? null : document.getElementById('taak-instructies-vrij').value;

    const data = {
      type: document.getElementById('taak-type')?.value || 'taak',
      code: document.getElementById('taak-code').value.trim(),
      titel: document.getElementById('taak-titel').value.trim(),
      tijd: parseInt(document.getElementById('taak-tijd').value),
      vak: 'Wiskunde',
      klas: document.getElementById('taak-klas').value,
      schooljaar: document.getElementById('taak-schooljaar').value,
      lesweek: parseInt(document.getElementById('taak-lesweek').value),
      omschrijving: document.getElementById('taak-omschrijving').value.trim(),
      routes,
      referenties: haalTaakRefs(),
      volgtijdelijkheid: document.getElementById('taak-volgtijdelijkheid').value.trim() || '0.0',
      volgorde: 0,
      fases,
      extraPapier: document.getElementById('taak-papier').value,
      voorkennis: Object.keys(geselecteerdeVK),
      succescriteria: Object.values(geselecteerdeSC).map(d => ({ id: d.id, scIndeling: d.scIndeling || 'leren' })),
      scTitelLeren: document.getElementById('sc-titel-leren').checked,
      scTitelEval: document.getElementById('sc-titel-eval').checked,
      bronnen: Object.keys(geselecteerdeBronnen),
      instructieType: isTemplate ? 'template' : 'vrij',
      templateId,
      templateParams,
      vrijevInstructies,
      indienwijze,
      evaluatievorm: evalVormen,
      status: document.getElementById('taak-status').value,
      versienummer: nieuweVersie ? ((cacheTaken.alle?.find(t => t.id === bewerkTaakId)?.versienummer || 0) + 1) : (cacheTaken.alle?.find(t => t.id === bewerkTaakId)?.versienummer || 1),
      tags: document.getElementById('taak-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      notities: document.getElementById('taak-notities').value.trim(),
      aangepastOp: new Date().toISOString(),
    };

    try {
      const docRef = bewerkTaakId ? doc(db, 'taken', bewerkTaakId) : doc(collection(db, 'taken'));
      await setDoc(docRef, data);
      cacheTaken.alle = null;
      toonMelding('taken', `Taak "${data.titel}" opgeslagen.`, 'succes');
      document.getElementById('taak-formulier').style.display = 'none';
      resetTaakFormulier();
      laadTaken();
    } catch(e) {
      toonMelding('taken', 'Fout bij opslaan: ' + e.message, 'fout');
    }
  };

  // ===== LADEN =====

export async function laadTaken = async () => {
    document.getElementById('taken-lader').style.display = 'block';
    document.getElementById('taken-tabel').style.display = 'none';
    document.getElementById('taken-leeg').style.display = 'none';
    try {
      if (!cacheTaken.alle) {
        const snap = await getDocs(collection(db, 'taken'));
        cacheTaken.alle = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      let taken = cacheTaken.alle;
      const sj = document.getElementById('filter-taak-schooljaar').value;
      const week = document.getElementById('filter-taak-week').value;
      const status = document.getElementById('filter-taak-status').value;
      if (sj) taken = taken.filter(t => t.schooljaar === sj);
      if (week) taken = taken.filter(t => t.lesweek === parseInt(week));
      if (status) taken = taken.filter(t => t.status === status);
      taken.sort((a,b) => (a.lesweek - b.lesweek) || a.code.localeCompare(b.code));

      document.getElementById('taken-lader').style.display = 'none';
      if (!taken.length) { document.getElementById('taken-leeg').style.display = 'block'; return; }

      const statusKleur = { concept: 'badge-bg', actief: 'badge-basis', archief: '' };
      const tbody = document.getElementById('taken-tbody');
      tbody.innerHTML = taken.map(t => `
        <tr>
          <td><strong>${t.code}</strong></td>
          <td>${t.titel}</td>
          <td>W${t.lesweek}</td>
          <td>${(t.routes || []).map(r => `<span class="badge route-${r}">${r}</span>`).join(' ')}</td>
          <td><span class="badge ${statusKleur[t.status] || ''}">${t.status}</span></td>
          <td style="white-space:nowrap;">
            <button class="knop knop-secundair knop-klein" onclick="bewerkTaak('${t.id}')">✏️</button>
            <button class="knop knop-secundair knop-klein" onclick="kopieerTaak('${t.id}')">📋</button>
            <button class="knop knop-gevaar knop-klein" onclick="verwijderTaak('${t.id}')">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.getElementById('taken-tabel').style.display = 'block';
    } catch(e) {
      toonMelding('taken', 'Fout bij laden: ' + e.message, 'fout');
      document.getElementById('taken-lader').style.display = 'none';
    }
  };

  // ===== BEWERKEN =====

  window.bewerkTaak = async (id) => {
    try {
      const snap = await getDoc(doc(db, 'taken', id));
      if (!snap.exists()) return;
      const t = snap.data();
      bewerkTaakId = id;
      resetTaakFormulier();
      document.getElementById('formulier-taak-titel').textContent = `Taak "${t.titel}" bewerken`;

      if (document.getElementById('taak-type')) { document.getElementById('taak-type').value = t.type || 'taak'; toggleTaakType(); }
      document.getElementById('taak-code').value = t.code || '';
      document.getElementById('taak-titel').value = t.titel || '';
      document.getElementById('taak-tijd').value = t.tijd || '';
      document.getElementById('taak-klas').value = t.klas || '';
      document.getElementById('taak-schooljaar').value = t.schooljaar || huidigSchooljaar();
      document.getElementById('taak-lesweek').value = t.lesweek || '';
      document.getElementById('taak-omschrijving').value = t.omschrijving || '';
      document.getElementById('taak-volgtijdelijkheid').value = t.volgtijdelijkheid || '';
      document.getElementById('taak-tags').value = (t.tags || []).join(', ');
      document.getElementById('taak-notities').value = t.notities || '';
      document.getElementById('taak-status').value = t.status || 'concept';
      document.getElementById('taak-papier').value = t.extraPapier || 'nee';
      document.getElementById('sc-titel-leren').checked = t.scTitelLeren !== false;
      document.getElementById('sc-titel-eval').checked = t.scTitelEval || false;

      (t.routes || []).forEach(r => { const el = document.getElementById('route-' + r); if (el) el.checked = true; });
      (t.fases || []).forEach(f => {
        const cb = document.querySelector(`#tb-algemeen input[value="${f}"]`);
        if (cb) cb.checked = true;
      });
      (t.referenties || []).forEach(r => voegTaakRefToe(r));

      if (t.instructieType === 'vrij') {
        document.getElementById('instr-vrij').checked = true;
        toggleInstructieType();
        document.getElementById('taak-instructies-vrij').value = t.vrijevInstructies || '';
        updatePreviewTaak();
      } else {
        document.getElementById('instr-template').checked = true;
        toggleInstructieType();
        await laadTemplateDropdown();
        document.getElementById('taak-template-id').value = t.templateId || '';
        laadTemplateParams();
        if (t.templateParams) {
          setTimeout(() => {
            document.querySelectorAll('#template-params-lijst .param-input').forEach(inp => {
              if (t.templateParams[inp.dataset.param] !== undefined) inp.value = t.templateParams[inp.dataset.param];
            });
          }, 100);
        }
      }

      // Indienwijze
      if (t.indienwijze?.map?.actief) { document.getElementById('ind-map').checked = true; toggleIndienenExtra('ind-map-extra'); document.getElementById('ind-map-info').value = t.indienwijze.map.info || ''; }
      if (t.indienwijze?.digitaal?.actief) { document.getElementById('ind-digitaal').checked = true; toggleIndienenExtra('ind-digitaal-extra'); document.getElementById('ind-digitaal-link').value = t.indienwijze.digitaal.link || ''; document.getElementById('ind-digitaal-deadline').value = t.indienwijze.digitaal.deadline || ''; }
      if (t.indienwijze?.vakje?.actief) { document.getElementById('ind-vakje').checked = true; toggleIndienenExtra('ind-vakje-extra'); document.getElementById('ind-vakje-deadline').value = t.indienwijze.vakje.deadline || ''; }
      if (t.indienwijze?.uitzondering?.actief) { document.getElementById('ind-uitzondering').checked = true; toggleIndienenExtra('ind-uitzondering-extra'); document.getElementById('ind-uitzondering-info').value = t.indienwijze.uitzondering.info || ''; }

      // Evaluatievorm
      (t.evaluatievorm || []).forEach(ev => {
        const cb = document.querySelector(`#tb-indienen input[value="${ev}"]`);
        if (cb) cb.checked = true;
        else if (!['formatief','summatief','zelfbeoordeling'].includes(ev)) { extraEvalForms.push(ev); }
      });
      renderEvalExtra();

      // Doelen laden en selecteren
      await laadDoelKeuzes();
      (t.voorkennis || []).forEach(id => {
        const d = alleDoelen?.find(d => d.id === id);
        if (d) { geselecteerdeVK[id] = d; }
      });
      (t.succescriteria || []).forEach(id => {
        const d = alleDoelen?.find(d => d.id === id);
        if (d) { geselecteerdeSC[id] = d; }
      });
      filterDoelKeuzes('vk'); renderGeselecteerdeDoelen('vk');
      filterDoelKeuzes('sc'); renderGeselecteerdeDoelen('sc');

      // Bronnen laden en selecteren
      await laadBronKeuzes();
      (t.bronnen || []).forEach(id => {
        const b = alleBronnenCache?.find(b => b.id === id);
        if (b) geselecteerdeBronnen[id] = b;
      });
      filterBronKeuzes(); renderGeselecteerdeBronnen();

      document.getElementById('taak-formulier').style.display = 'block';
      updateVersieKnop();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch(e) {
      toonMelding('taken', 'Fout bij laden: ' + e.message, 'fout');
    }
  };

  // ===== KOPIËREN =====

  window.kopieerTaak = async (id) => {
    await bewerkTaak(id);
    bewerkTaakId = null;
    document.getElementById('taak-code').value = '';
    document.getElementById('formulier-taak-titel').textContent = 'Nieuwe taak (kopie)';
    toonMelding('taken', 'Formulier ingevuld op basis van bestaande taak. Pas de code aan en sla op.', 'succes');
  };

  // ===== VERWIJDEREN =====

  window.verwijderTaak = async (id) => {
    const taak = cacheTaken.alle?.find(t => t.id === id);
    if (!confirm(`Ben je zeker dat je taak "${taak?.titel || id}" wil verwijderen?`)) return;
    try {
      await deleteDoc(doc(db, 'taken', id));
      cacheTaken.alle = null;
      toonMelding('taken', 'Taak verwijderd.', 'succes');
      laadTaken();
    } catch(e) {
      toonMelding('taken', 'Fout: ' + e.message, 'fout');
    }
  };

  // ===== PREVIEW TAAK =====

  window.previewTaak = async () => {
    toonMelding('taken', 'Preview komt binnenkort beschikbaar bij de weekpagina export.', 'succes');
  };

  // ===== WEEKOVERZICHT =====

export async function laadWeekOverzicht = async () => {
    const sj = document.getElementById('week-schooljaar').value;
    const week = document.getElementById('week-nr').value;
    if (!week) { document.getElementById('week-kaarten-blok').style.display = 'none'; return; }

    try {
      if (!cacheTaken.alle) {
        const snap = await getDocs(collection(db, 'taken'));
        cacheTaken.alle = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      let taken = cacheTaken.alle.filter(t => t.schooljaar === sj && t.lesweek === parseInt(week));
      const klas = document.getElementById('week-klas').value;
      if (klas) taken = taken.filter(t => t.klas === klas);
      taken.sort((a,b) => (a.volgorde || 0) - (b.volgorde || 0) || a.code.localeCompare(b.code));

      document.getElementById('week-kaarten-titel').textContent = `Week ${week} — ${taken.length} taken`;
      document.getElementById('week-kaarten-blok').style.display = 'block';

      const container = document.getElementById('week-kaarten-container');
      container.innerHTML = taken.map((t, i) => `
        <div class="taak-kaart" draggable="true" data-id="${t.id}"
          ondragstart="sleepStart(event)" ondragover="sleepOver(event)"
          ondrop="sleepDrop(event)" ondragleave="sleepLeave(event)">
          <div class="taak-kaart-nr">${i+1}</div>
          <div class="taak-kaart-titel">${t.code}: ${t.titel}</div>
          <div class="taak-kaart-meta">${t.tijd}' · ${t.fases?.join(', ') || ''}</div>
          <div class="taak-kaart-routes">
            ${(t.routes || []).map(r => `<span class="badge route-${r}">${r}</span>`).join('')}
          </div>
          ${t.volgtijdelijkheid && t.volgtijdelijkheid !== '0.0' ? `<div class="volgtijdelijk-badge">⚠ ${t.volgtijdelijkheid}</div>` : ''}
          <div style="margin-top:8px;display:flex;gap:6px;">
            <input type="number" value="${t.volgorde || i+1}" min="1"
              style="width:50px;padding:4px;font-size:9.5pt;"
              onchange="updateVolgorde('${t.id}', this.value)"
              title="Volgorde handmatig aanpassen">
          </div>
        </div>
      `).join('');
    } catch(e) {
      toonMelding('weekoverzicht', 'Fout: ' + e.message, 'fout');
    }
  };

  // Slepen
  let sleepElement = null;
  window.sleepStart = (e) => { sleepElement = e.currentTarget; e.currentTarget.classList.add('sleep'); };
  window.sleepOver = (e) => { e.preventDefault(); e.currentTarget.classList.add('sleep-over'); };
  window.sleepLeave = (e) => { e.currentTarget.classList.remove('sleep-over'); };
  window.sleepDrop = (e) => {
    e.preventDefault();
    const doel = e.currentTarget;
    doel.classList.remove('sleep-over');
    if (!sleepElement || sleepElement === doel) return;
    const container = document.getElementById('week-kaarten-container');
    const kaarten = [...container.querySelectorAll('.taak-kaart')];
    const vanIdx = kaarten.indexOf(sleepElement);
    const naarIdx = kaarten.indexOf(doel);
    if (vanIdx < naarIdx) container.insertBefore(sleepElement, doel.nextSibling);
    else container.insertBefore(sleepElement, doel);
    sleepElement.classList.remove('sleep');
    // Update nummers
    container.querySelectorAll('.taak-kaart').forEach((k, i) => {
      k.querySelector('.taak-kaart-nr').textContent = i+1;
      const inp = k.querySelector('input[type="number"]');
      if (inp) inp.value = i+1;
    });
  };

  window.updateVolgorde = (id, waarde) => {
    // Herorden kaarten op basis van ingevoerd getal
    const container = document.getElementById('week-kaarten-container');
    const kaarten = [...container.querySelectorAll('.taak-kaart')];
    const kaart = kaarten.find(k => k.dataset.id === id);
    if (kaart) {
      const nr = parseInt(waarde) - 1;
      const ref = kaarten[nr];
      if (ref && ref !== kaart) container.insertBefore(kaart, ref);
      kaarten.forEach((k, i) => { k.querySelector('.taak-kaart-nr').textContent = i+1; });
    }
  };

  window.slaVolgordeOp = async () => {
    const kaarten = [...document.getElementById('week-kaarten-container').querySelectorAll('.taak-kaart')];
    try {
      for (let i = 0; i < kaarten.length; i++) {
        const id = kaarten[i].dataset.id;
        await setDoc(doc(db, 'taken', id), { volgorde: i+1 }, { merge: true });
      }
      cacheTaken.alle = null;
      toonMelding('weekoverzicht', 'Volgorde opgeslagen!', 'succes');
    } catch(e) {
      toonMelding('weekoverzicht', 'Fout: ' + e.message, 'fout');
    }
  };

  window.exporteerWeekpagina = () => {
    toonMelding('weekoverzicht', 'Export komt binnenkort beschikbaar.', 'succes');
  };

  window.previewWeekpagina = () => {
    toonMelding('weekoverzicht', 'Preview komt binnenkort beschikbaar.', 'succes');
  };



  // ===== TAAK TYPE (les/taak) =====
  window.toggleTaakType = () => {
    const type = document.getElementById('taak-type').value;
    const tijdVeld = document.getElementById('taak-tijd');
    if (type === 'les') {
      tijdVeld.value = 'rooster';
      tijdVeld.readOnly = true;
      tijdVeld.style.background = '#f4f5f7';
    } else {
      if (tijdVeld.value === 'rooster') tijdVeld.value = '';
      tijdVeld.readOnly = false;
      tijdVeld.style.background = '';
    }
  };

  // ===== VERSIE KNOP =====
  // Toon "Opslaan als nieuwe versie" knop als we een bestaande taak bewerken
  function updateVersieKnop() {
    const knop = document.getElementById('opslaan-nieuw-versie');
    if (knop) knop.style.display = bewerkTaakId ? 'inline-flex' : 'none';
  }

  // ===== INLINE NIEUW DOEL FORMULIER =====
  window.toggleNieuwDoelFormulier = (soort) => {
    const formulier = document.getElementById(`nieuw-doel-formulier-${soort}`);
    formulier.style.display = formulier.style.display === 'none' ? 'block' : 'none';
    if (formulier.style.display === 'block') vulDatalijsten();
  };

  window.toggleNieuwScScores = () => {
    const eval_ = document.getElementById('nieuw-sc-eval').value;
    document.getElementById('nieuw-sc-scores-blok').style.display = eval_ === 'ja' ? 'block' : 'none';
  };

  window.slaaNieuwDoelOp = async (soort) => {
    const tekst = document.getElementById(`nieuw-${soort}-tekst`).value.trim();
    if (!tekst) { alert('Vul de tekst in.'); return; }
    const leerplan = document.getElementById(`nieuw-${soort}-leerplan`).value.trim();
    const ref = document.getElementById(`nieuw-${soort}-ref`).value.trim();
    const type = soort === 'vk' ? 'voorkennis' : 'succescriterium';
    const evalueerbaar = soort === 'sc' ? document.getElementById('nieuw-sc-eval').value : 'nee';
    const scores = soort === 'sc' && evalueerbaar === 'ja' ? document.getElementById('nieuw-sc-scores').value.trim() : '';

    const data = {
      tekst, type,
      leerplandoel_codes: leerplan ? [leerplan] : [],
      referenties: ref ? [ref] : [],
      evalueerbaar, scores,
      notities: '', aangepastOp: new Date().toISOString()
    };
    try {
      const docRef = doc(collection(db, 'doelen'));
      await setDoc(docRef, data);
      alleDoelen = null;
      cacheDoelen.alle = null;
      const nieuw = { id: docRef.id, ...data };
      const geselecteerd = soort === 'vk' ? geselecteerdeVK : geselecteerdeSC;
      geselecteerd[docRef.id] = { ...nieuw, scIndeling: 'leren' };
      await laadDoelKeuzes();
      filterDoelKeuzes(soort);
      renderGeselecteerdeDoelen(soort);
      // Reset formulier
      document.getElementById(`nieuw-${soort}-tekst`).value = '';
      document.getElementById(`nieuw-${soort}-leerplan`).value = '';
      document.getElementById(`nieuw-${soort}-ref`).value = '';
      if (soort === 'sc') { document.getElementById('nieuw-sc-eval').value = 'nee'; document.getElementById('nieuw-sc-scores').value = ''; document.getElementById('nieuw-sc-scores-blok').style.display = 'none'; }
      document.getElementById(`nieuw-doel-formulier-${soort}`).style.display = 'none';
    } catch(e) { alert('Fout: ' + e.message); }
  };

  // ===== SC INDELING (Wat leer je / Waarop geëvalueerd) =====
  // Overschrijf renderGeselecteerdeDoelen voor sc met extra keuzeschakelaar


  function renderGeselecteerdeDoelen(soort) {
    const geselecteerd = soort === 'vk' ? geselecteerdeVK : geselecteerdeSC;
    const container = document.getElementById(`geselecteerde-${soort}`);
    const geenEl = document.getElementById(`geen-${soort}`);
    const items = Object.values(geselecteerd);

    container.querySelectorAll('.geselecteerd-doel-item').forEach(e => e.remove());
    if (!items.length) { geenEl.style.display = 'block'; return; }
    geenEl.style.display = 'none';

    items.forEach((d, idx) => {
      const div = document.createElement('div');
      div.className = 'geselecteerd-doel-item';
      div.dataset.id = d.id;
      div.draggable = true;

      let scKeuze = '';
      if (soort === 'sc') {
        const indeling = d.scIndeling || 'leren';
        scKeuze = `
          <select class="sc-indeling-sel" data-id="${d.id}" onchange="updateScIndeling('${d.id}', this.value)"
            style="font-size:9pt;padding:3px 6px;border:1px solid var(--grijs-rand);border-radius:4px;margin-right:6px;">
            <option value="leren" ${indeling==='leren'?'selected':''}>📖 Wat leer je</option>
            <option value="eval" ${indeling==='eval'?'selected':''}>📊 Waarop geëvalueerd</option>
            <option value="beide" ${indeling==='beide'?'selected':''}>📖📊 Beide</option>
          </select>`;
      }

      div.innerHTML = `
        <span style="cursor:grab;color:var(--tekst-licht);margin-right:6px;" title="Slepen om te herordenen">⠿</span>
        <span style="flex:1;font-size:10.5pt;">${d.tekst}</span>
        ${scKeuze}
        <button class="verwijder-doel" onclick="toggleDoel('${soort}', '${d.id}')">✕</button>
      `;

      // Sleep events
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('doel-id', d.id);
        e.dataTransfer.setData('doel-soort', soort);
        div.style.opacity = '0.5';
      });
      div.addEventListener('dragend', () => div.style.opacity = '1');
      div.addEventListener('dragover', (e) => { e.preventDefault(); div.style.background = 'var(--blauw-licht)'; });
      div.addEventListener('dragleave', () => div.style.background = '');
      div.addEventListener('drop', (e) => {
        e.preventDefault();
        div.style.background = '';
        const vanId = e.dataTransfer.getData('doel-id');
        const vanSoort = e.dataTransfer.getData('doel-soort');
        if (vanSoort !== soort || vanId === d.id) return;
        const geselecteerd = soort === 'vk' ? geselecteerdeVK : geselecteerdeSC;
        const sleutels = Object.keys(geselecteerd);
        const vanIdx = sleutels.indexOf(vanId);
        const naarIdx = sleutels.indexOf(d.id);
        sleutels.splice(vanIdx, 1);
        sleutels.splice(naarIdx, 0, vanId);
        const nieuw = {};
        sleutels.forEach(k => nieuw[k] = geselecteerd[k]);
        if (soort === 'vk') Object.assign(geselecteerdeVK, nieuw);
        else Object.assign(geselecteerdeSC, nieuw);
        renderGeselecteerdeDoelen(soort);
      });

      container.appendChild(div);
    });
  }

  window.updateScIndeling = (id, waarde) => {
    if (geselecteerdeSC[id]) geselecteerdeSC[id].scIndeling = waarde;
  };

  // ===== AUTOMATISCHE BRONNEN BIJ REFERENTIE =====
  async function checkAutoBronnenBijReferentie(refCode) {
    if (!refCode) return;
    // Bepaal hoofdstuknummer
    const delen = refCode.split('.');
    if (!delen.length) return;
    const hstNr = parseInt(delen[0]);
    if (!hstNr) return;

    // Zoek hoofdstuk
    if (!cache.hoofdstukken) {
      const snap = await getDocs(collection(db, 'hoofdstukken'));
      cache.hoofdstukken = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    const hst = cache.hoofdstukken.find(h => h.nummer === hstNr);
    if (!hst || !hst.bronnen) return;

    const beschikbaar = [];
    if (hst.bronnen.cursus) beschikbaar.push({ label: `Cursus H${hstNr}`, type: 'bestand', link: hst.bronnen.cursus, auto: true });
    if (hst.bronnen.theorie) beschikbaar.push({ label: `Theorie H${hstNr}`, type: 'bestand', link: hst.bronnen.theorie, auto: true });
    if (hst.bronnen.correctiesleutel) beschikbaar.push({ label: `Correctiesleutel H${hstNr}`, type: 'bestand', link: hst.bronnen.correctiesleutel, auto: true });

    if (!beschikbaar.length) return;

    const namen = beschikbaar.map(b => `• ${b.label}`).join('\n');
    if (confirm(`Wil je de volgende bronnen van Hoofdstuk ${hstNr} toevoegen?\n\n${namen}`)) {
      beschikbaar.forEach(b => {
        // Zoek of de bron al bestaat in de database
        const bestaand = alleBronnenCache?.find(db => db.link === b.link);
        if (bestaand) {
          geselecteerdeBronnen[bestaand.id] = bestaand;
        } else {
          // Tijdelijke ID voor nog niet opgeslagen bronnen
          const tempId = 'auto-' + b.label.replace(/\s/g, '-');
          geselecteerdeBronnen[tempId] = { id: tempId, ...b };
        }
      });
      renderGeselecteerdeBronnen();
      filterBronKeuzes();
    }
  }

  // Overschrijf voegTaakRefToe om automatische bronnen te triggeren
  const origVoegTaakRefToe = window.voegTaakRefToe;
  window.voegTaakRefToe = (waarde = '') => {
    origVoegTaakRefToe(waarde);
    if (waarde) {
      // Kleine vertraging zodat het formulier geladen is
      setTimeout(() => checkAutoBronnenBijReferentie(waarde), 300);
    }
  };

  // Check bij blur van referentieveld
  document.addEventListener('blur', (e) => {
    if (e.target.classList.contains('taak-ref-waarde') && e.target.value) {
      checkAutoBronnenBijReferentie(e.target.value);
    }
  }, true);

  // ===== TAAK OPSLAAN MET VERSIE =====
  // Overschrijf slaaTaakOp om versie te ondersteunen


