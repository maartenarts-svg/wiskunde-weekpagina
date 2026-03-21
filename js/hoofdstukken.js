import { db } from './firebase-config.js';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';

export let cacheHoofdstukken = null;

  // ===== PARAGRAFEN =====

  let paragraafTeller = 0;

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
        <input type="text" placeholder="Nr. (6.1)" value="${data.nummer || ''}"
          style="width:100%;" class="paragraaf-nummer">
      </div>
      <div style="flex:1;">
        <input type="text" placeholder="Titel paragraaf" value="${data.titel || ''}"
          style="width:100%;" class="paragraaf-titel">
      </div>
      <button class="subdoel-verwijder" onclick="verwijderParagraaf('${id}')">✕</button>
    `;
    container.appendChild(div);
  };

export function verwijderParagraaf(id) {
    document.getElementById(id).remove();
    if (document.querySelectorAll('.paragraaf-item').length === 0) {
      document.getElementById('geen-paragrafen').style.display = 'block';
    }
  };

  function haalParagrafen() {
    return Array.from(document.querySelectorAll('.paragraaf-item')).map(item => ({
      nummer: item.querySelector('.paragraaf-nummer').value.trim(),
      titel: item.querySelector('.paragraaf-titel').value.trim(),
    })).filter(p => p.nummer && p.titel);
  }

  function resetHoofdstukFormulier() {
    document.getElementById('hst-nummer').value = '';
    document.getElementById('hst-cursus').value = '';
    document.getElementById('hst-theorie').value = '';
    document.getElementById('hst-correctiesleutel').value = '';
    document.getElementById('hst-titel').value = '';
    document.getElementById('paragraaf-container').querySelectorAll('.paragraaf-item').forEach(e => e.remove());
    document.getElementById('geen-paragrafen').style.display = 'block';
    document.getElementById('formulier-hoofdstuk-titel').textContent = 'Nieuw hoofdstuk toevoegen';
    document.getElementById('annuleer-hoofdstuk').style.display = 'none';
    bewerkHoofdstukId = null;
  }

export const annuleerHoofdstuk = resetHoofdstukFormulier;

  // ===== HOOFDSTUK OPSLAAN =====

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
      const docId = bewerkHoofdstukId || 'H' + nummer;
      await setDoc(doc(db, 'hoofdstukken', docId), data);
      cache.hoofdstukken = null;
      toonMelding('hoofdstukken', `Hoofdstuk ${nummer} succesvol opgeslagen.`, 'succes');
      resetHoofdstukFormulier();
      laadHoofdstukken();
    } catch (e) {
      toonMelding('hoofdstukken', 'Fout bij opslaan: ' + e.message, 'fout');
    }
  };

  // ===== HOOFDSTUKKEN LADEN =====

export async function laadHoofdstukken() {
    document.getElementById('hoofdstukken-lader').style.display = 'block';
    document.getElementById('hoofdstukken-tabel').style.display = 'none';
    document.getElementById('hoofdstukken-leeg').style.display = 'none';

    try {
      let hfst;
      if (cache.hoofdstukken) {
        hfst = cache.hoofdstukken;
      } else {
        const snap = await getDocs(collection(db, 'hoofdstukken'));
        hfst = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        hfst.sort((a, b) => a.nummer - b.nummer);
        cache.hoofdstukken = hfst;
      }

      document.getElementById('hoofdstukken-lader').style.display = 'none';
      if (hfst.length === 0) {
        document.getElementById('hoofdstukken-leeg').style.display = 'block';
        return;
      }
      const tbody = document.getElementById('hoofdstukken-tbody');
      tbody.innerHTML = hfst.map(h => `
        <tr>
          <td><strong>${h.nummer}</strong></td>
          <td>${h.titel}</td>
          <td style="font-size:9.5pt;color:var(--tekst-licht);">
            ${(h.paragrafen || []).map(p => `${p.nummer} ${p.titel}`).join('<br>') || '—'}
          </td>
          <td style="font-size:9.5pt;">
            ${h.bronnen?.cursus ? '📄 ' : ''}${h.bronnen?.theorie ? '📖 ' : ''}${h.bronnen?.correctiesleutel ? '✅ ' : ''}
          </td>
          <td>
            <button class="knop knop-secundair knop-klein" onclick="bewerkHoofdstuk('${h.id}')">✏️ Bewerken</button>
            <button class="knop knop-gevaar knop-klein" onclick="verwijderHoofdstuk('${h.id}', ${h.nummer})">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.getElementById('hoofdstukken-tabel').style.display = 'block';
    } catch (e) {
      toonMelding('hoofdstukken', 'Fout bij laden: ' + e.message, 'fout');
      document.getElementById('hoofdstukken-lader').style.display = 'none';
    }
  };

  // ===== HOOFDSTUK BEWERKEN =====

export async function bewerkHoofdstuk(id) {
    try {
      const snap = await getDoc(doc(db, 'hoofdstukken', id));
      if (!snap.exists()) return;
      const h = snap.data();
      document.getElementById('hst-nummer').value = h.nummer;
      document.getElementById('hst-cursus').value = h.bronnen?.cursus || '';
      document.getElementById('hst-theorie').value = h.bronnen?.theorie || '';
      document.getElementById('hst-correctiesleutel').value = h.bronnen?.correctiesleutel || '';
      document.getElementById('hst-titel').value = h.titel;
      document.getElementById('paragraaf-container').querySelectorAll('.paragraaf-item').forEach(e => e.remove());
      document.getElementById('geen-paragrafen').style.display = h.paragrafen?.length ? 'none' : 'block';
      (h.paragrafen || []).forEach(p => voegParagraafToe(p));
      document.getElementById('formulier-hoofdstuk-titel').textContent = `Hoofdstuk ${h.nummer} bewerken`;
      document.getElementById('annuleer-hoofdstuk').style.display = 'inline-flex';
      bewerkHoofdstukId = id;
      toonSectie('hoofdstukken');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toonMelding('hoofdstukken', 'Fout bij laden: ' + e.message, 'fout');
    }
  };

  // ===== HOOFDSTUK VERWIJDEREN =====

export async function verwijderHoofdstuk(id, nummer) {
    if (!confirm(`Ben je zeker dat je hoofdstuk ${nummer} wil verwijderen?`)) return;
    try {
      await deleteDoc(doc(db, 'hoofdstukken', id));
      cache.hoofdstukken = null;
      toonMelding('hoofdstukken', `Hoofdstuk ${nummer} verwijderd.`, 'succes');
      laadHoofdstukken();
    } catch (e) {
      toonMelding('hoofdstukken', 'Fout bij verwijderen: ' + e.message, 'fout');
    }
  };
