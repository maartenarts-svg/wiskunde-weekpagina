import { db } from './firebase-config.js';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding, niveauBadge } from './ui.js';

export const cache = { leerplandoelen: null, hoofdstukken: null };

  // ===== CODE BEREKENING LEERPLANDOEL =====

export function berekeningCode() {
    const niveau = document.getElementById('lp-niveau').value;
    const nummer = document.getElementById('lp-nummer').value.trim();
    if (!nummer) { document.getElementById('lp-code').value = ''; return; }
    let code = niveau === 'basisgeletterdheid' ? 'BG' : niveau === 'verdieping' ? 'V' : '';
    document.getElementById('lp-code').value = code + nummer;
  };

  // ===== SUBDOELEN =====

let subdoelTeller = 0;

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
        <input type="text" placeholder="Nr. (6.3.1)" value="${data.nummer || ''}"
          style="width:100%;" class="subdoel-nummer">
      </div>
      <div style="flex:1;">
        <input type="text" placeholder="Omschrijving subdoel" value="${data.doel || ''}"
          style="width:100%;" class="subdoel-doel">
      </div>
      <div style="flex:0 0 130px;">
        <input type="text" placeholder="Beheersingsniveau" value="${data.beheersingsniveau || ''}"
          style="width:100%;" class="subdoel-beheersingsniveau">
      </div>
      <div style="flex:0 0 130px;">
        <input type="text" placeholder="Afbakening" value="${data.afbakening || ''}"
          style="width:100%;" class="subdoel-afbakening">
      </div>
      <button class="subdoel-verwijder" onclick="verwijderSubdoel('${id}')">✕</button>
    `;
    container.appendChild(div);
  };

export function verwijderSubdoel(id) {
    document.getElementById(id).remove();
    if (document.querySelectorAll('.subdoel-item').length === 0) {
      document.getElementById('geen-subdoelen').style.display = 'block';
    }
  };

function haalSubdoelen() {
    return Array.from(document.querySelectorAll('.subdoel-item')).map(item => ({
      nummer: item.querySelector('.subdoel-nummer').value.trim(),
      doel: item.querySelector('.subdoel-doel').value.trim(),
      beheersingsniveau: item.querySelector('.subdoel-beheersingsniveau').value.trim(),
      afbakening: item.querySelector('.subdoel-afbakening').value.trim(),
    })).filter(s => s.nummer && s.doel);
  }

function resetLeerplandoelFormulier() {
    document.getElementById('lp-niveau').value = 'basis';
    document.getElementById('lp-nummer').value = '';
    document.getElementById('lp-code').value = '';
    document.getElementById('lp-doel').value = '';
    document.getElementById('lp-beheersingsniveau').value = '';
    document.getElementById('lp-afbakening').value = '';
    document.getElementById('subdoel-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
    document.getElementById('geen-subdoelen').style.display = 'block';
    document.getElementById('formulier-leerplandoel-titel').textContent = 'Nieuw leerplandoel toevoegen';
    document.getElementById('annuleer-leerplandoel').style.display = 'none';
    bewerkLeerplandoelId = null;
  }

export const annuleerLeerplandoel = resetLeerplandoelFormulier;


  // ===== CSV IMPORT =====

export async function importeerCSV(event) {
    const bestand = event.target.files[0];
    if (!bestand) return;

    const tekst = await bestand.text();

    // Robuuste CSV parser: behandelt meerregelige cellen correct
    function parseCSV(tekst) {
      const rijen = [];
      let huidigRij = [];
      let huidigVeld = '';
      let inAanhalingstekens = false;
      let i = 0;
      while (i < tekst.length) {
        const teken = tekst[i];
        if (teken === '"') {
          if (inAanhalingstekens && tekst[i+1] === '"') {
            // Dubbel aanhalingsteken = letterlijk aanhalingsteken
            huidigVeld += '"';
            i += 2;
          } else {
            inAanhalingstekens = !inAanhalingstekens;
            i++;
          }
        } else if (teken === ',' && !inAanhalingstekens) {
          huidigRij.push(huidigVeld.trim());
          huidigVeld = '';
          i++;
        } else if ((teken === '\n' || (teken === '\r' && tekst[i+1] === '\n')) && !inAanhalingstekens) {
          huidigRij.push(huidigVeld.trim());
          huidigVeld = '';
          if (huidigRij.some(v => v)) rijen.push(huidigRij);
          huidigRij = [];
          i += (teken === '\r') ? 2 : 1;
        } else if (teken === '\r' && !inAanhalingstekens) {
          i++;
        } else {
          huidigVeld += teken;
          i++;
        }
      }
      if (huidigVeld || huidigRij.length) {
        huidigRij.push(huidigVeld.trim());
        if (huidigRij.some(v => v)) rijen.push(huidigRij);
      }
      return rijen;
    }

    const alleRijen = parseCSV(tekst);
    // Sla header en lege/sectierijen over
    const dataRijen = alleRijen.slice(2).filter(r => r[0] && r[0].trim() && r[1] && r[1].trim());

    // Parsing: hoofddoelen met subdoelen
    const doelen = [];
    let huidigHoofdDoel = null;

    function bepaalNiveau(code) {
      if (code.startsWith('BG')) return { niveau: 'basisgeletterdheid', cijferDeel: code.slice(2) };
      if (code.startsWith('V')) return { niveau: 'verdieping', cijferDeel: code.slice(1) };
      return { niveau: 'basis', cijferDeel: code };
    }

    for (const rij of dataRijen) {
      const code = rij[0].trim();
      const doel = rij[1].trim();
      const beheersingsniveau = (rij[2] || '').trim();
      const afbakening = (rij[3] || '').trim().replace(/###/g, '\n');

      const { niveau, cijferDeel } = bepaalNiveau(code);
      const isSubdoel = cijferDeel.split('.').length >= 3;

      if (isSubdoel) {
        if (huidigHoofdDoel) {
          huidigHoofdDoel.subdoelen.push({ nummer: code, doel, beheersingsniveau, afbakening });
        }
      } else {
        huidigHoofdDoel = { code, niveau, nummer: cijferDeel, doel, beheersingsniveau, afbakening, subdoelen: [], aangepastOp: new Date().toISOString() };
        doelen.push(huidigHoofdDoel);
      }
    }

    if (doelen.length === 0) {
      toonMelding('leerplandoelen', 'Geen geldige doelen gevonden in het CSV-bestand.', 'fout');
      return;
    }

    // Voortgangsbalk tonen
    const voortgang = document.getElementById('import-voortgang');
    const balk = document.getElementById('import-balk');
    const importTekst = document.getElementById('import-tekst');
    voortgang.style.display = 'block';

    let opgeslagen = 0;
    let fouten = 0;

    for (let i = 0; i < doelen.length; i++) {
      const d = doelen[i];
      importTekst.textContent = `Bezig met importeren... ${i + 1} van ${doelen.length} (${d.code})`;
      balk.style.width = ((i + 1) / doelen.length * 100) + '%';
      try {
        await setDoc(doc(db, 'leerplandoelen', d.code), d);
        opgeslagen++;
      } catch (e) {
        fouten++;
      }
      // Kleine pauze om Firebase niet te overbelasten
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 200));
    }

    cache.leerplandoelen = null;
    voortgang.style.display = 'none';
    event.target.value = '';

    if (fouten === 0) {
      toonMelding('leerplandoelen', `✓ ${opgeslagen} leerplandoelen succesvol geïmporteerd.`, 'succes');
    } else {
      toonMelding('leerplandoelen', `${opgeslagen} geïmporteerd, ${fouten} mislukt.`, 'fout');
    }
    laadLeerplandoelen();
  };

  // ===== LEERPLANDOELEN OPSLAAN =====

export async function slaLeerplandoelOp() {
    const code = document.getElementById('lp-code').value.trim();
    const doel = document.getElementById('lp-doel').value.trim();
    if (!code || !doel) {
      toonMelding('leerplandoelen', 'Vul minstens een nummer en een doel in.', 'fout');
      return;
    }
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
      const docId = bewerkLeerplandoelId || code;
      await setDoc(doc(db, 'leerplandoelen', docId), data);
      cache.leerplandoelen = null;
      toonMelding('leerplandoelen', `Leerplandoel ${code} succesvol opgeslagen.`, 'succes');
      resetLeerplandoelFormulier();
      laadLeerplandoelen();
    } catch (e) {
      toonMelding('leerplandoelen', 'Fout bij opslaan: ' + e.message, 'fout');
    }
  };

  // ===== LEERPLANDOELEN LADEN =====

export async function laadLeerplandoelen() {
    const filterNiveau = document.getElementById('filter-niveau').value;
    document.getElementById('leerplandoelen-lader').style.display = 'block';
    document.getElementById('leerplandoelen-tabel').style.display = 'none';
    document.getElementById('leerplandoelen-leeg').style.display = 'none';

    try {
      // Gebruik cache tenzij gefilterd
      let doelen;
      if (!filterNiveau && cache.leerplandoelen) {
        doelen = cache.leerplandoelen;
      } else {
        let q = filterNiveau
          ? query(collection(db, 'leerplandoelen'), where('niveau', '==', filterNiveau))
          : collection(db, 'leerplandoelen');
        const snap = await getDocs(q);
        doelen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        doelen.sort((a, b) => a.code.localeCompare(b.code, 'nl', { numeric: true }));
        if (!filterNiveau) cache.leerplandoelen = doelen;
      }

      document.getElementById('leerplandoelen-lader').style.display = 'none';
      if (doelen.length === 0) {
        document.getElementById('leerplandoelen-leeg').style.display = 'block';
        return;
      }
      const tbody = document.getElementById('leerplandoelen-tbody');
      tbody.innerHTML = doelen.map(d => `
        <tr>
          <td><strong>${d.code}</strong></td>
          <td>${niveauBadge(d.niveau)}</td>
          <td style="max-width:320px;">${d.doel}</td>
          <td>${d.subdoelen?.length || 0}</td>
          <td>
            <button class="knop knop-secundair knop-klein" onclick="bewerkLeerplandoel('${d.id}')">✏️ Bewerken</button>
            <button class="knop knop-gevaar knop-klein" onclick="verwijderLeerplandoel('${d.id}', '${d.code}')">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.getElementById('leerplandoelen-tabel').style.display = 'block';
    } catch (e) {
      toonMelding('leerplandoelen', 'Fout bij laden: ' + e.message, 'fout');
      document.getElementById('leerplandoelen-lader').style.display = 'none';
    }
  };

  // ===== LEERPLANDOEL BEWERKEN =====

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
      const afbakeningWaarde = d.afbakening || '';
      document.getElementById('lp-afbakening').value = afbakeningWaarde;
      const icoon = document.getElementById('afbakening-tooltip-icoon');
      const tooltipTekst = document.getElementById('afbakening-tooltip-tekst');
      if (afbakeningWaarde.includes('\n') || afbakeningWaarde.length > 60) {
        icoon.style.display = 'flex';
        tooltipTekst.textContent = afbakeningWaarde;
      } else {
        icoon.style.display = 'none';
      }
      document.getElementById('subdoel-container').querySelectorAll('.subdoel-item').forEach(e => e.remove());
      document.getElementById('geen-subdoelen').style.display = d.subdoelen?.length ? 'none' : 'block';
      (d.subdoelen || []).forEach(s => voegSubdoelToe(s));
      document.getElementById('formulier-leerplandoel-titel').textContent = `Leerplandoel ${d.code} bewerken`;
      document.getElementById('annuleer-leerplandoel').style.display = 'inline-flex';
      bewerkLeerplandoelId = id;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toonMelding('leerplandoelen', 'Fout bij laden: ' + e.message, 'fout');
    }
  };

  // ===== LEERPLANDOEL VERWIJDEREN =====

export async function verwijderLeerplandoel(id, code) {
    if (!confirm(`Ben je zeker dat je leerplandoel ${code} wil verwijderen?`)) return;
    try {
      await deleteDoc(doc(db, 'leerplandoelen', id));
      cache.leerplandoelen = null;
      toonMelding('leerplandoelen', `Leerplandoel ${code} verwijderd.`, 'succes');
      laadLeerplandoelen();
    } catch (e) {
      toonMelding('leerplandoelen', 'Fout bij verwijderen: ' + e.message, 'fout');
    }
  };
