import { db } from './firebase-config.js';
import {
  doc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';
import { haalCache, wisCache } from './appCache.js';

// ===== STATE =====
let cache = null;
let bewerkId = null;

const typeIconen = {
  website: '🌐', video: '▶️', classroom: '🎓', bestand: '📄', andere: '📎'
};
const typeLabels = {
  website: 'Website', video: 'Video', classroom: 'Google Classroom',
  bestand: 'PDF/Bestand', andere: 'Andere'
};

// ===== RESET FORMULIER =====
export function annuleerBron() {
  document.getElementById('bron-label').value = '';
  document.getElementById('bron-type').value = 'website';
  document.getElementById('bron-link').value = '';
  document.getElementById('bron-referentie').value = '';
  document.getElementById('bron-notities').value = '';
  document.getElementById('formulier-bron-titel').textContent = 'Nieuwe bron toevoegen';
  document.getElementById('annuleer-bron').style.display = 'none';
  bewerkId = null;
}

// ===== OPSLAAN =====
export async function slaBronOp() {
  const label = document.getElementById('bron-label').value.trim();
  if (!label) { toonMelding('bronnen', 'Vul minstens een label in.', 'fout'); return; }

  const velden = {
    label,
    type: document.getElementById('bron-type').value,
    link: document.getElementById('bron-link').value.trim(),
    referentie: document.getElementById('bron-referentie').value.trim(),
    notities: document.getElementById('bron-notities').value.trim(),
    aangepastOp: new Date().toISOString(),
  };

  try {
    if (!cache) cache = (await haalCache('bronnen', db)).slice().sort((a, b) => a.label.localeCompare(b.label, 'nl'));
    let items = [...cache];

    if (bewerkId) {
      const idx = items.findIndex(b => b.id === bewerkId);
      if (idx !== -1) items[idx] = { ...items[idx], ...velden };
    } else {
      items.push({ id: crypto.randomUUID(), ...velden });
    }

    await setDoc(doc(db, 'bronnen', 'wiskunde1a'), { items });
    cache = null; wisCache('bronnen');
    toonMelding('bronnen', 'Bron opgeslagen.', 'succes');
    annuleerBron();
    laadBronnen();
  } catch (e) {
    toonMelding('bronnen', 'Fout bij opslaan: ' + e.message, 'fout');
  }
}

// ===== LADEN =====
export async function laadBronnen() {
  document.getElementById('bronnen-lader').style.display = 'block';
  document.getElementById('bronnen-tabel').style.display = 'none';
  document.getElementById('bronnen-leeg').style.display = 'none';

  try {
    if (!cache) {
      cache = (await haalCache('bronnen', db)).slice().sort((a, b) => a.label.localeCompare(b.label, 'nl'));
    }

    let bronnen = cache;
    const filterType = document.getElementById('filter-bron-type').value;
    if (filterType) bronnen = bronnen.filter(b => b.type === filterType);

    document.getElementById('bronnen-lader').style.display = 'none';
    if (!bronnen.length) { document.getElementById('bronnen-leeg').style.display = 'block'; return; }

    const tbody = document.getElementById('bronnen-tbody');
    tbody.innerHTML = bronnen.map(b => `
      <tr>
        <td><strong>${b.label}</strong></td>
        <td>${typeIconen[b.type] || '📎'} ${typeLabels[b.type] || b.type}</td>
        <td style="font-size:9.5pt;">
          ${b.link ? `<a href="${b.link}" target="_blank" style="color:var(--blauw);">Openen ↗</a>` : '—'}
        </td>
        <td>${b.referentie || '—'}</td>
        <td>
          <button class="knop knop-secundair knop-klein" onclick="window._bewerkBron('${b.id}')">✏️</button>
          <button class="knop knop-gevaar knop-klein" onclick="window._verwijderBron('${b.id}')">🗑️</button>
        </td>
      </tr>
    `).join('');
    document.getElementById('bronnen-tabel').style.display = 'block';
  } catch (e) {
    toonMelding('bronnen', 'Fout bij laden: ' + e.message, 'fout');
    document.getElementById('bronnen-lader').style.display = 'none';
  }
}

// ===== BEWERKEN =====
export async function bewerkBron(id) {
  try {
    if (!cache) cache = (await haalCache('bronnen', db)).slice().sort((a, b) => a.label.localeCompare(b.label, 'nl'));
    const b = cache.find(b => b.id === id);
    if (!b) return;
    document.getElementById('bron-label').value = b.label || '';
    document.getElementById('bron-type').value = b.type || 'website';
    document.getElementById('bron-link').value = b.link || '';
    document.getElementById('bron-referentie').value = b.referentie || '';
    document.getElementById('bron-notities').value = b.notities || '';
    document.getElementById('formulier-bron-titel').textContent = 'Bron bewerken';
    document.getElementById('annuleer-bron').style.display = 'inline-flex';
    bewerkId = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toonMelding('bronnen', 'Fout bij laden: ' + e.message, 'fout');
  }
}

// ===== VERWIJDEREN =====
export async function verwijderBron(id) {
  if (!confirm('Ben je zeker dat je deze bron wil verwijderen?')) return;
  try {
    if (!cache) cache = (await haalCache('bronnen', db)).slice().sort((a, b) => a.label.localeCompare(b.label, 'nl'));
    const items = cache.filter(b => b.id !== id);
    await setDoc(doc(db, 'bronnen', 'wiskunde1a'), { items });
    cache = null; wisCache('bronnen');
    toonMelding('bronnen', 'Bron verwijderd.', 'succes');
    laadBronnen();
  } catch (e) {
    toonMelding('bronnen', 'Fout bij verwijderen: ' + e.message, 'fout');
  }
}

// ===== CACHE EXPORT =====
export function getCache() { return cache; }
