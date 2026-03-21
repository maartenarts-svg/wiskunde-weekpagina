import { db } from './firebase-config.js';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';

export let cacheBronnen = { alle: null };

  // ===== BRONNEN =====

  let bewerkBronId = null;


  const typeIconen = {
    website: '🌐', video: '▶️', classroom: '🎓', bestand: '📄', andere: '📎'
  };
  const typeLabels = {
    website: 'Website', video: 'Video', classroom: 'Google Classroom',
    bestand: 'PDF/Bestand', andere: 'Andere'
  };

  function resetBronFormulier() {
    document.getElementById('bron-label').value = '';
    document.getElementById('bron-type').value = 'website';
    document.getElementById('bron-link').value = '';
    document.getElementById('bron-referentie').value = '';
    document.getElementById('bron-notities').value = '';
    document.getElementById('formulier-bron-titel').textContent = 'Nieuwe bron toevoegen';
    document.getElementById('annuleer-bron').style.display = 'none';
    bewerkBronId = null;
  }

export const annuleerBron = resetBronFormulier;

export async function slaBronOp() {
    const label = document.getElementById('bron-label').value.trim();
    const link = document.getElementById('bron-link').value.trim();
    if (!label) { toonMelding('bronnen', 'Vul minstens een label in.', 'fout'); return; }
    const data = {
      label,
      type: document.getElementById('bron-type').value,
      link,
      referentie: document.getElementById('bron-referentie').value.trim(),
      notities: document.getElementById('bron-notities').value.trim(),
      aangepastOp: new Date().toISOString(),
    };
    try {
      const docRef = bewerkBronId ? doc(db, 'bronnen', bewerkBronId) : doc(collection(db, 'bronnen'));
      await setDoc(docRef, data);
      cacheBronnen.alle = null;
      toonMelding('bronnen', 'Bron succesvol opgeslagen.', 'succes');
      resetBronFormulier();
      laadBronnen();
    } catch(e) {
      toonMelding('bronnen', 'Fout bij opslaan: ' + e.message, 'fout');
    }
  };

export async function laadBronnen() {
    document.getElementById('bronnen-lader').style.display = 'block';
    document.getElementById('bronnen-tabel').style.display = 'none';
    document.getElementById('bronnen-leeg').style.display = 'none';
    try {
      if (!cacheBronnen.alle) {
        const snap = await getDocs(collection(db, 'bronnen'));
        cacheBronnen.alle = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cacheBronnen.alle.sort((a,b) => a.label.localeCompare(b.label, 'nl'));
      }
      let bronnen = cacheBronnen.alle;
      const filterType = document.getElementById('filter-bron-type').value;
      if (filterType) bronnen = bronnen.filter(b => b.type === filterType);

      document.getElementById('bronnen-lader').style.display = 'none';
      if (bronnen.length === 0) {
        document.getElementById('bronnen-leeg').style.display = 'block'; return;
      }
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
            <button class="knop knop-secundair knop-klein" onclick="bewerkBron('${b.id}')">✏️</button>
            <button class="knop knop-gevaar knop-klein" onclick="verwijderBron('${b.id}')">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.getElementById('bronnen-tabel').style.display = 'block';
    } catch(e) {
      toonMelding('bronnen', 'Fout bij laden: ' + e.message, 'fout');
      document.getElementById('bronnen-lader').style.display = 'none';
    }
  };

export async function bewerkBron(id) {
    try {
      const snap = await getDoc(doc(db, 'bronnen', id));
      if (!snap.exists()) return;
      const b = snap.data();
      document.getElementById('bron-label').value = b.label || '';
      document.getElementById('bron-type').value = b.type || 'website';
      document.getElementById('bron-link').value = b.link || '';
      document.getElementById('bron-referentie').value = b.referentie || '';
      document.getElementById('bron-notities').value = b.notities || '';
      document.getElementById('formulier-bron-titel').textContent = 'Bron bewerken';
      document.getElementById('annuleer-bron').style.display = 'inline-flex';
      bewerkBronId = id;
      toonSectie('bronnen');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch(e) {
      toonMelding('bronnen', 'Fout bij laden: ' + e.message, 'fout');
    }
  };

export async function verwijderBron(id) {
    if (!confirm('Ben je zeker dat je deze bron wil verwijderen?')) return;
    try {
      await deleteDoc(doc(db, 'bronnen', id));
      cacheBronnen.alle = null;
      toonMelding('bronnen', 'Bron verwijderd.', 'succes');
      laadBronnen();
    } catch(e) {
      toonMelding('bronnen', 'Fout bij verwijderen: ' + e.message, 'fout');
    }
  };
