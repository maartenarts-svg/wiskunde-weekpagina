import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';

// ===== STATE =====
let cache = null;
let bewerkId = null;
let actievEditor = null;

// ===== MARKDOWN PARSER =====
export function parseMarkdown(tekst) {
  if (!tekst) return '';
  const regels = tekst.split('\n');
  let html = '';
  let numTeller = 0;
  let genestNumTeller = 0;

  function inline(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/\^\^(.+?)\^\^/g, '<span class="preview-groot">$1</span>')
      .replace(/~(.+?)~/g, '<span class="preview-klein">$1</span>')
      .replace(/\[kleur:(\w+|#[0-9a-fA-F]{3,6})\](.+?)\[\/kleur\]/g, (m, kleur, tekst) => {
        const kleurMap = { rood: '#c0392b', blauw: '#2c4a6e', groen: '#27ae60', oranje: '#e07b00', grijs: '#6b7280' };
        return `<span style="color:${kleurMap[kleur] || kleur};">${tekst}</span>`;
      })
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" style="color:var(--blauw);">$1</a>')
      .replace(/!\[video-embed\]\((.+?)\)/g, (m, url) => {
        const embedUrl = url.replace('/view', '/preview').replace('?usp=sharing', '');
        return `<div class="preview-video-embed"><iframe src="${embedUrl}" allowfullscreen></iframe></div>`;
      })
      .replace(/!\[video-thumb\]\((.+?)\)/g, (m, url) => {
        const fileId = url.match(/[-\w]{25,}/)?.[0] || '';
        const thumb = fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w320` : '';
        return `<div class="preview-video-thumb"><a href="${url}" target="_blank"><img src="${thumb}" alt="Video" onerror="this.src='';this.parentElement.innerHTML='▶️ Video openen';"></a></div>`;
      })
      .replace(/!\[(.+?)\]\((.+?)\)/g, '<div class="preview-afbeelding"><img src="$2" alt="$1"></div>')
      .replace(/\+\+/g, '<br>')
      .replace(/\{(\w+)\}/g, '<span class="preview-param">{$1}</span>');
  }

  for (const regel of regels) {
    const getrimmed = regel.trimStart();
    const isGenest = regel.startsWith('  ') || regel.startsWith('\t');

    if (!getrimmed) {
      html += '<div style="height:6px;"></div>';
      numTeller = 0; genestNumTeller = 0;
      continue;
    }
    if (getrimmed.startsWith('++')) {
      const rest = inline(getrimmed.slice(2).trim());
      html += `<div style="margin-bottom:2px;">${rest}</div>`;
      continue;
    }
    if (getrimmed.startsWith('## ')) {
      numTeller = 0;
      html += `<div class="preview-subtitel">${inline(getrimmed.slice(3))}</div>`;
      continue;
    }
    if (isGenest && getrimmed.match(/^\d+\|\s*/)) {
      genestNumTeller++;
      html += `<div class="preview-stap preview-genest"><span class="preview-nr">${genestNumTeller}|</span><div style="flex:1;">${inline(getrimmed.replace(/^\d+\|\s*/, ''))}</div></div>`;
      continue;
    }
    if (isGenest && getrimmed.startsWith('- ')) {
      html += `<div class="preview-opsomming preview-genest"><div class="preview-bullet">•</div><div>${inline(getrimmed.slice(2))}</div></div>`;
      continue;
    }
    if (isGenest) {
      html += `<div class="preview-gewoon preview-genest">${inline(getrimmed)}</div>`;
      continue;
    }
    if (getrimmed.match(/^\d+\|\s*/)) {
      numTeller++; genestNumTeller = 0;
      html += `<div class="preview-stap"><span class="preview-nr">${numTeller}|</span><div style="flex:1;">${inline(getrimmed.replace(/^\d+\|\s*/, ''))}</div></div>`;
      continue;
    }
    if (getrimmed.startsWith('- ')) {
      html += `<div class="preview-opsomming"><div class="preview-bullet">•</div><div>${inline(getrimmed.slice(2))}</div></div>`;
      continue;
    }
    html += `<div class="preview-gewoon">${inline(getrimmed)}</div>`;
  }
  return html;
}

// ===== PREVIEW =====
export function updatePreview() {
  const ta = document.getElementById('tmpl-inhoud');
  const preview = document.getElementById('tmpl-preview');
  preview.innerHTML = parseMarkdown(ta.value);
  // Bereken hoogte op basis van beide panelen
  ta.style.height = 'auto';
  const hoogte = Math.max(400, ta.scrollHeight, preview.scrollHeight);
  ta.style.height = hoogte + 'px';
  preview.style.minHeight = hoogte + 'px';
}

// ===== PARAMETERS DETECTEREN =====
export function detecteerParameters() {
  const inhoud = document.getElementById('tmpl-inhoud').value;
  const gevonden = [...new Set([...inhoud.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
  const container = document.getElementById('param-container');
  const lijst = document.getElementById('param-lijst');

  if (!gevonden.length) { container.style.display = 'none'; return; }
  container.style.display = 'block';

  const bestaande = {};
  lijst.querySelectorAll('.param-input').forEach(inp => { bestaande[inp.dataset.param] = inp.value; });

  lijst.innerHTML = gevonden.map(p => `
    <div class="param-rij">
      <div class="param-naam">{${p}}</div>
      <input type="text" class="param-input" data-param="${p}"
        placeholder="Standaardwaarde..." value="${bestaande[p] || ''}">
    </div>
  `).join('');
}

// ===== SYNTAXHULP =====
export function toggleSyntax() {
  const kolom = document.getElementById('syntax-kolom');
  const wrapper = document.getElementById('editor-wrapper');
  const zichtbaar = kolom.style.display !== 'none';
  kolom.style.display = zichtbaar ? 'none' : 'block';
  wrapper.style.gridTemplateColumns = zichtbaar ? '1fr 1fr' : '1fr 1fr 280px';
  actievEditor = document.getElementById('tmpl-inhoud');
}

export function voegSyntaxIn(syntax) {
  const ta = actievEditor || document.getElementById('tmpl-inhoud');
  const start = ta.selectionStart;
  const einde = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + syntax + ta.value.slice(einde);
  ta.selectionStart = ta.selectionEnd = start + syntax.length;
  ta.focus();
  updatePreview();
  detecteerParameters();
}

// ===== RESET FORMULIER =====
export function annuleerTemplate() {
  document.getElementById('tmpl-naam').value = '';
  document.getElementById('tmpl-type').value = 'les';
  document.getElementById('tmpl-inhoud').value = '';
  document.getElementById('tmpl-notities').value = '';
  document.getElementById('tmpl-preview').innerHTML = '';
  document.getElementById('param-container').style.display = 'none';
  document.getElementById('param-lijst').innerHTML = '';
  document.getElementById('formulier-template-titel').textContent = 'Nieuwe template toevoegen';
  document.getElementById('annuleer-template').style.display = 'none';
  // Syntaxkolom sluiten
  const kolom = document.getElementById('syntax-kolom');
  if (kolom.style.display !== 'none') {
    kolom.style.display = 'none';
    document.getElementById('editor-wrapper').style.gridTemplateColumns = '1fr 1fr';
  }
  bewerkId = null;
}

// ===== OPSLAAN =====
export async function slaTemplateOp() {
  const naam = document.getElementById('tmpl-naam').value.trim();
  const inhoud = document.getElementById('tmpl-inhoud').value.trim();
  if (!naam) { toonMelding('templates', 'Vul een naam in.', 'fout'); return; }
  if (!inhoud) { toonMelding('templates', 'Vul de instructies in.', 'fout'); return; }

  const parameters = {};
  document.querySelectorAll('.param-input').forEach(inp => {
    parameters[inp.dataset.param] = inp.value.trim();
  });

  const data = {
    naam,
    type: document.getElementById('tmpl-type').value,
    inhoud,
    parameters,
    notities: document.getElementById('tmpl-notities').value.trim(),
    aangepastOp: new Date().toISOString(),
  };

  try {
    const docRef = bewerkId ? doc(db, 'templates', bewerkId) : doc(collection(db, 'templates'));
    await setDoc(docRef, data);
    cache = null;
    toonMelding('templates', 'Template opgeslagen.', 'succes');
    annuleerTemplate();
    laadTemplates();
  } catch (e) {
    toonMelding('templates', 'Fout bij opslaan: ' + e.message, 'fout');
  }
}

// ===== LADEN =====
export async function laadTemplates() {
  document.getElementById('templates-lader').style.display = 'block';
  document.getElementById('templates-tabel').style.display = 'none';
  document.getElementById('templates-leeg').style.display = 'none';

  try {
    if (!cache) {
      const snap = await getDocs(collection(db, 'templates'));
      cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cache.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
    }

    let templates = cache;
    const filterType = document.getElementById('filter-tmpl-type').value;
    if (filterType) templates = templates.filter(t => t.type === filterType);

    document.getElementById('templates-lader').style.display = 'none';
    if (!templates.length) { document.getElementById('templates-leeg').style.display = 'block'; return; }

    const typeLabels = { les: 'Les', taak: 'Taak', rekenvaardigheden: 'Rekenvaardigheden', andere: 'Andere' };
    const tbody = document.getElementById('templates-tbody');
    tbody.innerHTML = templates.map(t => {
      const params = Object.keys(t.parameters || {});
      return `
        <tr>
          <td><strong>${t.naam}</strong>${t.notities ? `<br><span style="font-size:9pt;color:var(--tekst-licht);">${t.notities}</span>` : ''}</td>
          <td>${typeLabels[t.type] || t.type}</td>
          <td style="font-size:9.5pt;">${params.length ? params.map(p => `<span class="preview-param">{${p}}</span>`).join(' ') : '—'}</td>
          <td>
            <button class="knop knop-secundair knop-klein" onclick="window._bewerkTemplate('${t.id}')">✏️</button>
            <button class="knop knop-gevaar knop-klein" onclick="window._verwijderTemplate('${t.id}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
    document.getElementById('templates-tabel').style.display = 'block';
  } catch (e) {
    toonMelding('templates', 'Fout bij laden: ' + e.message, 'fout');
    document.getElementById('templates-lader').style.display = 'none';
  }
}

// ===== BEWERKEN =====
export async function bewerkTemplate(id) {
  try {
    const snap = await getDoc(doc(db, 'templates', id));
    if (!snap.exists()) return;
    const t = snap.data();
    document.getElementById('tmpl-naam').value = t.naam || '';
    document.getElementById('tmpl-type').value = t.type || 'les';
    document.getElementById('tmpl-inhoud').value = t.inhoud || '';
    document.getElementById('tmpl-notities').value = t.notities || '';
    updatePreview();
    detecteerParameters();
    if (t.parameters) {
      document.querySelectorAll('.param-input').forEach(inp => {
        if (t.parameters[inp.dataset.param] !== undefined) inp.value = t.parameters[inp.dataset.param];
      });
    }
    document.getElementById('formulier-template-titel').textContent = `Template "${t.naam}" bewerken`;
    document.getElementById('annuleer-template').style.display = 'inline-flex';
    bewerkId = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toonMelding('templates', 'Fout bij laden: ' + e.message, 'fout');
  }
}

// ===== VERWIJDEREN =====
export async function verwijderTemplate(id) {
  if (!confirm('Ben je zeker dat je deze template wil verwijderen?')) return;
  try {
    await deleteDoc(doc(db, 'templates', id));
    cache = null;
    toonMelding('templates', 'Template verwijderd.', 'succes');
    laadTemplates();
  } catch (e) {
    toonMelding('templates', 'Fout bij verwijderen: ' + e.message, 'fout');
  }
}

// ===== CACHE EXPORT (voor taken.js) =====
export function getCache() { return cache; }
export async function zorgCache() {
  if (!cache) {
    const snap = await getDocs(collection(db, 'templates'));
    cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cache.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  }
  return cache;
}
