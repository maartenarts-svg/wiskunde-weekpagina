import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';
import { haalCache, wisCache, zetResetSignaal } from './appCache.js';

// ===== STATE =====
let cache = null;
let bewerkId = null;
let paragraafTeller = 0;

// ===== PARAGRAFEN =====
export function voegParagraafToe(data = {}) {
  const container = document.getElementById('paragraaf-container');
  document.getElementById('geen-paragrafen').style.display = 'none';
  paragraafTeller++;
  const id = 'paragraaf-' + paragraafTeller;
  const div = document.createElement('div');
  div.className = 'paragraaf-item';
  div.id = id;
  div.innerHTML = `
    <div style="flex:0 0 80px;">
      <input type="text" placeholder="Nr. (6.1)" value="${data.nummer || ''}" style="width:100%;" class="paragraaf-nummer">
    </div>
    <div style="flex:1;">
      <input type="text" placeholder="Titel paragraaf" value="${data.titel || ''}" style="width:100%;" class="paragraaf-titel">
    </div>
    <button class="subdoel-verwijder" onclick="window._verwijderParagraaf('${id}')">✕</button>
  `;
  container.appendChild(div);
}

export function verwijderParagraaf(id) {
  document.getElementById(id)?.remove();
  if (!document.querySelectorAll('.paragraaf-item').length) {
    document.getElementById('geen-paragrafen').style.display = 'block';
  }
}

function haalParagrafen() {
  return Array.from(document.querySelectorAll('.paragraaf-item')).map(item => ({
    nummer: item.querySelector('.paragraaf-nummer').value.trim(),
    titel: item.querySelector('.paragraaf-titel').value.trim(),
  })).filter(p => p.nummer && p.titel);
}

// ===== RESET FORMULIER =====
export function annuleerHoofdstuk() {
  document.getElementById('hst-nummer').value = '';
  document.getElementById('hst-titel').value = '';
  document.getElementById('hst-cursus').value = '';
  document.getElementById('hst-theorie').value = '';
  document.getElementById('hst-correctiesleutel').value = '';
  document.getElementById('paragraaf-container').querySelectorAll('.paragraaf-item').forEach(e => e.remove());
  document.getElementById('geen-paragrafen').style.display = 'block';
  document.getElementById('formulier-hoofdstuk-titel').textContent = 'Nieuw hoofdstuk toevoegen';
  document.getElementById('annuleer-hoofdstuk').style.display = 'none';
  bewerkId = null;
}

// ===== OPSLAAN =====
export async function slaHoofdstukOp() {
  const nummer = parseInt(document.getElementById('hst-nummer').value);
  const titel = document.getElementById('hst-titel').value.trim();
  if (!nummer || !titel) {
    toonMelding('hoofdstukken', 'Vul minstens een nummer en een titel in.', 'fout');
    return;
  }

  const data = {
    nummer,
    titel,
    bronnen: {
      cursus: document.getElementById('hst-cursus').value.trim(),
      theorie: document.getElementById('hst-theorie').value.trim(),
      correctiesleutel: document.getElementById('hst-correctiesleutel').value.trim(),
    },
    paragrafen: haalParagrafen(),
    aangepastOp: new Date().toISOString(),
  };

  try {
    const docId = bewerkId || 'H' + nummer;
    await setDoc(doc(db, 'hoofdstukken', docId), data);
    cache = null; wisCache('hoofdstukken'); zetResetSignaal('referentieDropdown');
    toonMelding('hoofdstukken', `Hoofdstuk ${nummer} opgeslagen.`, 'succes');
    annuleerHoofdstuk();
    laadHoofdstukken();
  } catch (e) {
    toonMelding('hoofdstukken', 'Fout bij opslaan: ' + e.message, 'fout');
  }
}

// ===== LADEN =====
export async function laadHoofdstukken() {
  document.getElementById('hst-lader').style.display = 'block';
  document.getElementById('hst-tabel').style.display = 'none';
  document.getElementById('hst-leeg').style.display = 'none';

  try {
    if (!cache) {
      cache = (await haalCache('hoofdstukken', db)).slice().sort((a, b) => a.nummer - b.nummer);
    }
    renderHoofdstukken(cache);
  } catch (e) {
    toonMelding('hoofdstukken', 'Fout bij laden: ' + e.message, 'fout');
    document.getElementById('hst-lader').style.display = 'none';
  }
}

function renderHoofdstukken(lijst) {
  document.getElementById('hst-lader').style.display = 'none';
  if (!lijst.length) {
    document.getElementById('hst-leeg').style.display = 'block';
    return;
  }
  const tbody = document.getElementById('hst-tbody');
  tbody.innerHTML = lijst.map(h => `
    <tr>
      <td><strong>${h.nummer}</strong></td>
      <td>${h.titel}</td>
      <td style="font-size:9.5pt;color:var(--tekst-licht);">
        ${(h.paragrafen || []).map(p => `${p.nummer} ${p.titel}`).join('<br>') || '—'}
      </td>
      <td style="font-size:11pt;">
        ${h.bronnen?.cursus ? '📄 ' : ''}${h.bronnen?.theorie ? '📖 ' : ''}${h.bronnen?.correctiesleutel ? '✅' : ''}
      </td>
      <td>
        <button class="knop knop-secundair knop-klein" onclick="window._bewerkHoofdstuk('${h.id}')">✏️ Bewerken</button>
        <button class="knop knop-gevaar knop-klein" onclick="window._verwijderHoofdstuk('${h.id}', ${h.nummer})">🗑️</button>
      </td>
    </tr>
  `).join('');
  document.getElementById('hst-tabel').style.display = 'block';
}

// ===== BEWERKEN =====
export async function bewerkHoofdstuk(id) {
  try {
    const snap = await getDoc(doc(db, 'hoofdstukken', id));
    if (!snap.exists()) return;
    const h = snap.data();
    document.getElementById('hst-nummer').value = h.nummer;
    document.getElementById('hst-titel').value = h.titel;
    document.getElementById('hst-cursus').value = h.bronnen?.cursus || '';
    document.getElementById('hst-theorie').value = h.bronnen?.theorie || '';
    document.getElementById('hst-correctiesleutel').value = h.bronnen?.correctiesleutel || '';
    document.getElementById('paragraaf-container').querySelectorAll('.paragraaf-item').forEach(e => e.remove());
    document.getElementById('geen-paragrafen').style.display = h.paragrafen?.length ? 'none' : 'block';
    (h.paragrafen || []).forEach(p => voegParagraafToe(p));
    document.getElementById('formulier-hoofdstuk-titel').textContent = `Hoofdstuk ${h.nummer} bewerken`;
    document.getElementById('annuleer-hoofdstuk').style.display = 'inline-flex';
    bewerkId = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toonMelding('hoofdstukken', 'Fout bij laden: ' + e.message, 'fout');
  }
}

// ===== VERWIJDEREN =====
export async function verwijderHoofdstuk(id, nummer) {
  if (!confirm(`Ben je zeker dat je hoofdstuk ${nummer} wil verwijderen?`)) return;
  try {
    await deleteDoc(doc(db, 'hoofdstukken', id));
    cache = null; wisCache('hoofdstukken'); zetResetSignaal('referentieDropdown');
    toonMelding('hoofdstukken', `Hoofdstuk ${nummer} verwijderd.`, 'succes');
    laadHoofdstukken();
  } catch (e) {
    toonMelding('hoofdstukken', 'Fout bij verwijderen: ' + e.message, 'fout');
  }
}

// ===== CACHE EXPORT (voor gebruik in andere modules) =====
export function getCache() { return cache; }
export async function zorgCache() {
  if (!cache) {
    cache = (await haalCache('hoofdstukken', db)).slice().sort((a, b) => a.nummer - b.nummer);
  }
  return cache;
}
