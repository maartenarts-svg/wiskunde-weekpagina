import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding, niveauBadge } from './ui.js';

// ===== STATE =====
let cache = null;
let bewerkId = null;
let subdoelTeller = 0;

// ===== CODE BEREKENING =====
export function berekeningCode() {
  const niveau = document.getElementById('lp-niveau').value;
  const nummer = document.getElementById('lp-nummer').value.trim();
  if (!nummer) { document.getElementById('lp-code').value = ''; return; }
  const prefix = niveau === 'basisgeletterdheid' ? 'BG' : niveau === 'verdieping' ? 'V' : '';
  document.getElementById('lp-code').value = prefix + nummer;
}

// ===== SUBDOELEN =====
export function voegSubdoelToe(data = {}) {
  const container = document.getElementById('subdoel-container');
  document.getElementById('geen-subdoelen').style.display = 'none';
  subdoelTeller++;
  const id = 'subdoel-' + subdoelTeller;
  const div = document.createElement('div');
  div.className = 'subdoel-item';
  div.id = id;
  div.innerHTML = `
    <div style="flex:0 0 100px;">
      <input type="text" placeholder="Nr. (6.3.1)" value="${data.nummer || ''}" style="width:100%;" class="subdoel-nummer">
    </div>
    <div style="flex:1;">
      <input type="text" placeholder="Omschrijving subdoel" value="${data.doel || ''}" style="width:100%;" class="subdoel-doel">
    </div>
    <div style="flex:0 0 130px;">
      <input type="text" placeholder="Beheersingsniveau" value="${data.beheersingsniveau || ''}" style="width:100%;" class="subdoel-beheersingsniveau">
    </div>
    <div style="flex:0 0 130px;">
      <input type="text" placeholder="Afbakening" value="${data.afbakening || ''}" style="width:100%;" class="subdoel-afbakening">
    </div>
    <button class="subdoel-verwijder" onclick="window._verwijderSubdoel('${id}')">✕</button>
  `;
  container.appendChild(div);
}

export function verwijderSubdoel(id) {
  document.getElementById(id)?.remove();
  if (!document.querySelectorAll('.subdoel-item').length) {
    document.getElementById('geen-subdoelen').style.display = 'block';
  }
}

function haalSubdoelen() {
  return Array.from(document.querySelectorAll('.subdoel-item')).map(item => ({
    nummer: item.querySelector('.subdoel-nummer').value.trim(),
    doel: item.querySelector('.subdoel-doel').value.trim(),
    beheersingsniveau: item.querySelector('.subdoel-beheersingsniveau').value.trim(),
    afbakening: item.querySelector('.subdoel-afbakening').value.trim(),
  })).filter(s => s.nummer && s.doel);
}

// ===== RESET FORMULIER =====
export function annuleerLeerplandoel() {
  document.getElementById('lp-niveau').value = 'basis';
  document.getElementById('lp-nummer').value = '';
  document.getElementById('lp-code').value = '';
  document.getElementById('lp-doel').value = '';
  document.getElementById('lp-beheersingsniveau').value = '';
  document.getElementById('lp-afbakening').value = '';
  document.getElementById('subdoel-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
  document.getElementById('geen-subdoelen').style.display = 'block';
  document.getElementById('formulier-lp-titel').textContent = 'Nieuw leerplandoel toevoegen';
  document.getElementById('annuleer-lp').style.display = 'none';
  bewerkId = null;
}

// ===== CSV IMPORT =====
export async function importeerCSV(event) {
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
        if (inAanhalingstekens && tekst[i+1] === '"') { huidigVeld += '"'; i += 2; }
        else { inAanhalingstekens = !inAanhalingstekens; i++; }
      } else if (teken === ',' && !inAanhalingstekens) {
        huidigRij.push(huidigVeld.trim()); huidigVeld = ''; i++;
      } else if ((teken === '\n' || (teken === '\r' && tekst[i+1] === '\n')) && !inAanhalingstekens) {
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

  function bepaalNiveau(code) {
    if (code.startsWith('BG')) return { niveau: 'basisgeletterdheid', cijferDeel: code.slice(2) };
    if (code.startsWith('V')) return { niveau: 'verdieping', cijferDeel: code.slice(1) };
    return { niveau: 'basis', cijferDeel: code };
  }

  const alleRijen = parseCSV(tekst);
  const dataRijen = alleRijen.slice(2).filter(r => r[0] && r[0].trim() && r[1] && r[1].trim());

  const doelen = [];
  let huidigHoofdDoel = null;

  for (const rij of dataRijen) {
    const code = rij[0].trim();
    const doel = rij[1].trim();
    const beheersingsniveau = (rij[2] || '').trim();
    const afbakening = (rij[3] || '').trim().replace(/###/g, '\n');
    const { niveau, cijferDeel } = bepaalNiveau(code);
    const isSubdoel = cijferDeel.split('.').length >= 3;

    if (isSubdoel) {
      if (huidigHoofdDoel) huidigHoofdDoel.subdoelen.push({ nummer: code, doel, beheersingsniveau, afbakening });
    } else {
      huidigHoofdDoel = { code, niveau, nummer: cijferDeel, doel, beheersingsniveau, afbakening, subdoelen: [], aangepastOp: new Date().toISOString() };
      doelen.push(huidigHoofdDoel);
    }
  }

  if (!doelen.length) { toonMelding('leerplandoelen', 'Geen geldige doelen gevonden.', 'fout'); return; }

  const voortgang = document.getElementById('import-voortgang');
  const balk = document.getElementById('import-balk');
  const importTekst = document.getElementById('import-tekst');
  voortgang.style.display = 'block';

  let opgeslagen = 0, fouten = 0;
  for (let i = 0; i < doelen.length; i++) {
    const d = doelen[i];
    importTekst.textContent = `Bezig... ${i + 1} van ${doelen.length} (${d.code})`;
    balk.style.width = ((i + 1) / doelen.length * 100) + '%';
    try {
      await setDoc(doc(db, 'leerplandoelen', d.code), d);
      opgeslagen++;
    } catch (e) { fouten++; }
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 200));
  }

  cache = null;
  voortgang.style.display = 'none';
  event.target.value = '';
  toonMelding('leerplandoelen',
    fouten === 0 ? `✓ ${opgeslagen} leerplandoelen geïmporteerd.` : `${opgeslagen} geïmporteerd, ${fouten} mislukt.`,
    fouten === 0 ? 'succes' : 'fout'
  );
  laadLeerplandoelen();
}

// ===== OPSLAAN =====
export async function slaLeerplandoelOp() {
  const code = document.getElementById('lp-code').value.trim();
  const doel = document.getElementById('lp-doel').value.trim();
  if (!code || !doel) { toonMelding('leerplandoelen', 'Vul minstens een nummer en een doel in.', 'fout'); return; }

  const data = {
    code,
    niveau: document.getElementById('lp-niveau').value,
    nummer: document.getElementById('lp-nummer').value.trim(),
    doel,
    beheersingsniveau: document.getElementById('lp-beheersingsniveau').value.trim(),
    afbakening: document.getElementById('lp-afbakening').value.trim(),
    subdoelen: haalSubdoelen(),
    aangepastOp: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'leerplandoelen', bewerkId || code), data);
    cache = null;
    toonMelding('leerplandoelen', `Leerplandoel ${code} opgeslagen.`, 'succes');
    annuleerLeerplandoel();
    laadLeerplandoelen();
  } catch (e) {
    toonMelding('leerplandoelen', 'Fout bij opslaan: ' + e.message, 'fout');
  }
}

// ===== LADEN =====
export async function laadLeerplandoelen() {
  const filterNiveau = document.getElementById('filter-lp-niveau')?.value || '';
  document.getElementById('lp-lader').style.display = 'block';
  document.getElementById('lp-tabel').style.display = 'none';
  document.getElementById('lp-leeg').style.display = 'none';

  try {
    if (!cache || filterNiveau) {
      const snap = await getDocs(collection(db, 'leerplandoelen'));
      let doelen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      doelen.sort((a, b) => {
        const volgorde = c => c.startsWith('BG') ? 2 : c.startsWith('V') ? 1 : 0;
        const vA = volgorde(a.code), vB = volgorde(b.code);
        if (vA !== vB) return vA - vB;
        return a.code.localeCompare(b.code, 'nl', { numeric: true });
      });
      if (!filterNiveau) cache = doelen;
      else {
        doelen = doelen.filter(d => d.niveau === filterNiveau);
        renderLeerplandoelen(doelen);
        return;
      }
    }
    renderLeerplandoelen(filterNiveau ? cache.filter(d => d.niveau === filterNiveau) : cache);
  } catch (e) {
    toonMelding('leerplandoelen', 'Fout bij laden: ' + e.message, 'fout');
    document.getElementById('lp-lader').style.display = 'none';
  }
}

function renderLeerplandoelen(doelen) {
  document.getElementById('lp-lader').style.display = 'none';
  if (!doelen.length) { document.getElementById('lp-leeg').style.display = 'block'; return; }
  const tbody = document.getElementById('lp-tbody');
  tbody.innerHTML = doelen.map(d => `
    <tr>
      <td><strong>${d.code}</strong></td>
      <td>${niveauBadge(d.niveau)}</td>
      <td style="max-width:320px;">${d.doel}</td>
      <td>${d.subdoelen?.length || 0}</td>
      <td>
        <button class="knop knop-secundair knop-klein" onclick="window._bewerkLeerplandoel('${d.id}')">✏️ Bewerken</button>
        <button class="knop knop-gevaar knop-klein" onclick="window._verwijderLeerplandoel('${d.id}', '${d.code}')">🗑️</button>
      </td>
    </tr>
  `).join('');
  document.getElementById('lp-tabel').style.display = 'block';
}

// ===== BEWERKEN =====
export async function bewerkLeerplandoel(id) {
  try {
    const snap = await getDoc(doc(db, 'leerplandoelen', id));
    if (!snap.exists()) return;
    const d = snap.data();
    document.getElementById('lp-niveau').value = d.niveau;
    document.getElementById('lp-nummer').value = d.nummer;
    document.getElementById('lp-code').value = d.code;
    document.getElementById('lp-doel').value = d.doel;
    document.getElementById('lp-beheersingsniveau').value = d.beheersingsniveau || '';
    document.getElementById('lp-afbakening').value = d.afbakening || '';
    document.getElementById('subdoel-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
    document.getElementById('geen-subdoelen').style.display = d.subdoelen?.length ? 'none' : 'block';
    (d.subdoelen || []).forEach(s => voegSubdoelToe(s));
    document.getElementById('formulier-lp-titel').textContent = `Leerplandoel ${d.code} bewerken`;
    document.getElementById('annuleer-lp').style.display = 'inline-flex';
    bewerkId = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toonMelding('leerplandoelen', 'Fout bij laden: ' + e.message, 'fout');
  }
}

// ===== VERWIJDEREN =====
export async function verwijderLeerplandoel(id, code) {
  if (!confirm(`Ben je zeker dat je leerplandoel ${code} wil verwijderen?`)) return;
  try {
    await deleteDoc(doc(db, 'leerplandoelen', id));
    cache = null;
    toonMelding('leerplandoelen', `Leerplandoel ${code} verwijderd.`, 'succes');
    laadLeerplandoelen();
  } catch (e) {
    toonMelding('leerplandoelen', 'Fout bij verwijderen: ' + e.message, 'fout');
  }
}
