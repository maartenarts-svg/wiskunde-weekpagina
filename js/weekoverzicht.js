// ===== WEEKDROPDOWN VULLEN =====
export function vulWoWeekDropdown(schooljaar) {
  // Hergebruik genereerSchoolweken uit taken.js — maar die is niet geëxporteerd.
  // Implementeer hier direct een vereenvoudigde versie.
  const sel = document.getElementById('wo-week');
  if (!sel || !schooljaar) return;
  const huidig = sel.value;

  // Genereer weken 1-38
  const [startJaar] = schooljaar.split('-').map(Number);
  // Eerste september van startJaar → maandag van die week
  let datum = new Date(startJaar, 8, 1);
  const dag = datum.getDay();
  datum.setDate(datum.getDate() - (dag === 0 ? 6 : dag - 1));

  const opties = ['<option value="">Week...</option>'];
  for (let w = 1; w <= 38; w++) {
    const zondag = new Date(datum);
    zondag.setDate(datum.getDate() + 6);
    const fmt = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    opties.push(`<option value="${w}" ${w == huidig ? 'selected' : ''}>Week ${w} — ${fmt(datum)} t/m ${fmt(zondag)}</option>`);
    datum.setDate(datum.getDate() + 7);
  }
  sel.innerHTML = opties.join('');
}

import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { toonMelding } from './ui.js';
import { parseMarkdown } from './templates.js';

// ===== STATE =====
// kolomData[route] = [{...taakData, _kolomVolgorde, _volgtijdelijkheid}]
let kolomData = { G: [], B: [], Z: [] };
let alleTakenVanWeek = [];
let huidigSchooljaarWO = '';
let huidigWeekWO = '';

// ===== INIT =====
export async function laadWeekoverzicht() {
  const sj = document.getElementById('wo-schooljaar')?.value || '';
  const week = document.getElementById('wo-week')?.value || '';

  if (!sj || !week) {
    document.getElementById('wo-kolommen').style.display = 'none';
    document.getElementById('wo-leeg').style.display = 'block';
    return;
  }

  huidigSchooljaarWO = sj;
  huidigWeekWO = week;
  const weekGetal = parseInt(week);

  document.getElementById('wo-lader').style.display = 'block';
  document.getElementById('wo-kolommen').style.display = 'none';
  document.getElementById('wo-leeg').style.display = 'none';
  document.getElementById('wo-acties').style.display = 'none';

  try {
    const snap = await getDocs(collection(db, 'taken'));
    const alleTaken = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log('Alle taken geladen:', alleTaken.length);
    console.log('Filter: schooljaar=', sj, 'week=', weekGetal);
    alleTaken.forEach(t => console.log(' taak:', t.code, 'sj:', t.schooljaar, 'lesweek:', t.lesweek, '(type:', typeof t.lesweek, ')'));

    alleTakenVanWeek = alleTaken
      .filter(t => {
        const sjMatch = t.schooljaar === sj;
        const weekMatch = parseInt(t.lesweek) === weekGetal;
        return sjMatch && weekMatch;
      })
      .sort((a, b) => (a.volgorde || 999) - (b.volgorde || 999));
    console.log('Gefilterde taken:', alleTakenVanWeek.length, alleTakenVanWeek.map(t => t.code));

    // Bouw kolomData op
    kolomData = { G: [], B: [], Z: [] };
    for (const taak of alleTakenVanWeek) {
      const routes = taak.routes || [];
      const relevanteRoutes = routes.includes('geen')
        ? ['G', 'B', 'Z']
        : routes.filter(r => ['G', 'B', 'Z'].includes(r));
      for (const route of relevanteRoutes) {
        kolomData[route].push({
          ...taak,
          _route: route,
          _volgtijdelijkheid: taak.volgtijdelijkheid || '0.0',
        });
      }
    }

    document.getElementById('wo-lader').style.display = 'none';
    renderKolommen();
    document.getElementById('wo-kolommen').style.display = 'grid';
    document.getElementById('wo-acties').style.display = 'flex';
  } catch (e) {
    toonMelding('weekoverzicht', 'Fout bij laden: ' + e.message, 'fout');
    document.getElementById('wo-lader').style.display = 'none';
  }
}

// ===== RENDER KOLOMMEN =====
function renderKolommen() {
  ['G', 'B', 'Z'].forEach(route => {
    const lijst = kolomData[route];
    const container = document.getElementById(`wo-kolom-${route}`);
    if (!container) return;

    // Totale werktijd
    const totaal = lijst.reduce((som, t) => {
      const tijd = t.tijd === 'rooster' ? 50 : (parseInt(t.tijd) || 0);
      return som + tijd;
    }, 0);
    document.getElementById(`wo-tijd-${route}`).textContent = `${totaal} min`;

    // Tegels
    const tegelContainer = document.getElementById(`wo-tegels-${route}`);
    tegelContainer.innerHTML = '';

    if (!lijst.length) {
      tegelContainer.innerHTML = '<div style="color:var(--tekst-licht);font-size:9.5pt;padding:12px;">Geen taken voor deze route.</div>';
      return;
    }

    lijst.forEach((taak, idx) => {
      const tegel = maakTegel(taak, route, idx);
      tegelContainer.appendChild(tegel);
    });

    initialiseerDragDrop(route);
  });
}

function maakTegel(taak, route, idx) {
  const div = document.createElement('div');
  div.className = 'wo-tegel';
  div.dataset.id = taak.id;
  div.dataset.route = route;
  div.draggable = true;

  const tijd = taak.tijd === 'rooster' ? 'rooster (50\')' : `${taak.tijd}'`;
  const routes = (taak.routes || []).filter(r => r !== 'geen').join('/') || '—';

  div.innerHTML = `
    <div class="wo-tegel-header">
      <span class="wo-tegel-greep" title="Slepen om volgorde aan te passen">⠿</span>
      <span class="wo-tegel-code">${taak.code}</span>
      <span class="wo-tegel-tijd">${tijd}</span>
      <button class="wo-tegel-verwijder" onclick="window._verwijderUitKolom('${route}', '${taak.id}')" title="Verwijderen uit deze kolom">✕</button>
    </div>
    <div class="wo-tegel-titel">${taak.titel}</div>
    <div class="wo-tegel-meta">${routes}${taak.klas ? ' · ' + taak.klas : ''}</div>
    <div class="wo-tegel-vt">
      <label style="font-size:8.5pt;color:var(--tekst-licht);text-transform:uppercase;letter-spacing:0.5px;">Volgtijdelijkheid</label>
      <input type="text" class="wo-vt-input" value="${taak._volgtijdelijkheid}"
        data-id="${taak.id}" data-route="${route}"
        style="width:80px;padding:4px 8px;font-size:9.5pt;border:1.5px solid var(--grijs-rand);border-radius:6px;"
        onchange="window._updateVolgtijdelijkheid('${route}', '${taak.id}', this.value)">
    </div>
  `;
  return div;
}

// ===== DRAG & DROP =====
function initialiseerDragDrop(route) {
  const container = document.getElementById(`wo-tegels-${route}`);
  let dragEl = null;

  container.querySelectorAll('.wo-tegel').forEach(tegel => {
    tegel.addEventListener('dragstart', e => {
      dragEl = tegel;
      tegel.classList.add('wo-tegel-sleep');
      e.dataTransfer.effectAllowed = 'move';
    });
    tegel.addEventListener('dragend', () => {
      tegel.classList.remove('wo-tegel-sleep');
      container.querySelectorAll('.wo-tegel').forEach(t => t.classList.remove('wo-tegel-over'));
      dragEl = null;
      // Volgorde bijwerken na slepen
      herberekeningVolgorde(route);
    });
    tegel.addEventListener('dragover', e => {
      e.preventDefault();
      if (dragEl && dragEl !== tegel) {
        tegel.classList.add('wo-tegel-over');
        const rect = tegel.getBoundingClientRect();
        const midden = rect.top + rect.height / 2;
        if (e.clientY < midden) {
          container.insertBefore(dragEl, tegel);
        } else {
          container.insertBefore(dragEl, tegel.nextSibling);
        }
      }
    });
    tegel.addEventListener('dragleave', () => {
      tegel.classList.remove('wo-tegel-over');
    });
    tegel.addEventListener('drop', e => {
      e.preventDefault();
      tegel.classList.remove('wo-tegel-over');
    });
  });
}

function herberekeningVolgorde(route) {
  const container = document.getElementById(`wo-tegels-${route}`);
  const ids = Array.from(container.querySelectorAll('.wo-tegel')).map(t => t.dataset.id);
  // Pas kolomData aan op basis van nieuwe DOM-volgorde
  const nieuw = ids.map(id => kolomData[route].find(t => t.id === id)).filter(Boolean);
  kolomData[route] = nieuw;
  // Update werktijd (volgorde verandert niet de tijd, maar voor consistentie)
  const totaal = nieuw.reduce((s, t) => s + (t.tijd === 'rooster' ? 50 : parseInt(t.tijd) || 0), 0);
  document.getElementById(`wo-tijd-${route}`).textContent = `${totaal} min`;
}

// ===== VERWIJDEREN UIT KOLOM =====
export function verwijderUitKolom(route, id) {
  kolomData[route] = kolomData[route].filter(t => t.id !== id);
  renderKolommen();
}

// ===== VOLGTIJDELIJKHEID UPDATEN =====
export function updateVolgtijdelijkheid(route, id, waarde) {
  const taak = kolomData[route].find(t => t.id === id);
  if (taak) taak._volgtijdelijkheid = waarde.trim() || '0.0';
}

// ===== OPSLAAN VOLGORDE =====
export async function slaWeekoverzichtOp() {
  try {
    const batch = writeBatch(db);
    ['G', 'B', 'Z'].forEach(route => {
      // Lees huidige DOM-volgorde
      const container = document.getElementById(`wo-tegels-${route}`);
      const ids = Array.from(container.querySelectorAll('.wo-tegel')).map(t => t.dataset.id);
      ids.forEach((id, idx) => {
        const taakRef = doc(db, 'taken', id);
        // Sla volgorde op per route — gebruik een gecombineerde sleutel
        const vt = kolomData[route].find(t => t.id === id)?._volgtijdelijkheid || '0.0';
        batch.update(taakRef, {
          [`volgordePerRoute.${route}`]: idx + 1,
          volgtijdelijkheid: vt,
          volgorde: route === 'G' ? idx + 1 : undefined, // hoofdvolgorde op basis van G
        });
      });
    });
    await batch.commit();
    toonMelding('weekoverzicht', 'Volgorde en volgtijdelijkheid opgeslagen.', 'succes');
  } catch (e) {
    toonMelding('weekoverzicht', 'Fout bij opslaan: ' + e.message, 'fout');
  }
}

// ===== VOLGTIJDELIJKHEID TEKST =====
function berekenVtTekst(taak, kolomLijst) {
  const vt = taak._volgtijdelijkheid || '0.0';
  const [xStr, yStr] = vt.split('.');
  const x = parseInt(xStr);
  const y = parseInt(yStr);
  if (!x || isNaN(y)) return ''; // 0.0 of ongeldig

  // Alle taken in deze kolom met hetzelfde x, gesorteerd op y
  const reeks = kolomLijst
    .filter(t => {
      const [tx, ty] = (t._volgtijdelijkheid || '0.0').split('.');
      return parseInt(tx) === x && !isNaN(parseInt(ty));
    })
    .sort((a, b) => {
      const ya = parseInt((a._volgtijdelijkheid || '0.0').split('.')[1]);
      const yb = parseInt((b._volgtijdelijkheid || '0.0').split('.')[1]);
      return ya - yb;
    });

  const eigenIdx = reeks.findIndex(t => t.id === taak.id);
  if (eigenIdx === -1) return '';

  const voorganger = eigenIdx > 0 ? reeks[eigenIdx - 1] : null;
  const opvolger = eigenIdx < reeks.length - 1 ? reeks[eigenIdx + 1] : null;

  if (voorganger && opvolger) {
    return `Opgelet, deze taak kun je pas maken na de taak <strong>${voorganger.code}</strong> en moet je maken voor de taak <strong>${opvolger.code}</strong>.`;
  } else if (voorganger) {
    return `Opgelet, deze taak kun je pas maken na de taak <strong>${voorganger.code}</strong>.`;
  } else if (opvolger) {
    return `Opgelet, deze taak moet je maken voor de taak <strong>${opvolger.code}</strong>.`;
  }
  return '';
}

// ===== PREVIEW =====
export function toonWeekoverzichtPreview() {
  const previewEl = document.getElementById('wo-preview-inhoud');
  if (!previewEl) return;

  // Lees actuele DOM-volgorde voor elke kolom
  const actueleKolommen = {};
  ['G', 'B', 'Z'].forEach(route => {
    const container = document.getElementById(`wo-tegels-${route}`);
    const ids = Array.from(container.querySelectorAll('.wo-tegel')).map(t => t.dataset.id);
    actueleKolommen[route] = ids.map(id => kolomData[route].find(t => t.id === id)).filter(Boolean);
  });

  previewEl.innerHTML = renderWeekpaginaHTML(actueleKolommen, huidigWeekWO, false);
  document.getElementById('wo-beheer-wrapper').style.display = 'none';
  document.getElementById('wo-preview-wrapper').style.display = 'block';
}

export function sluitWeekoverzichtPreview() {
  document.getElementById('wo-beheer-wrapper').style.display = 'block';
  document.getElementById('wo-preview-wrapper').style.display = 'none';
}

// ===== HTML EXPORT =====
export function exporteerWeekpagina() {
  // Lees actuele DOM-volgorde
  const actueleKolommen = {};
  ['G', 'B', 'Z'].forEach(route => {
    const container = document.getElementById(`wo-tegels-${route}`);
    const ids = Array.from(container.querySelectorAll('.wo-tegel')).map(t => t.dataset.id);
    actueleKolommen[route] = ids.map(id => kolomData[route].find(t => t.id === id)).filter(Boolean);
  });

  const html = renderWeekpaginaHTML(actueleKolommen, huidigWeekWO, true);
  const volledigeHTML = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${huidigWeekWO}</title>
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
${weekpaginaCSS()}
</head>
<body>
${html}
${weekpaginaScript()}
</body>
</html>`;

  const blob = new Blob([volledigeHTML], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `week-${huidigWeekWO}-${huidigSchooljaarWO}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== WEEKPAGINA HTML RENDERER =====
function renderWeekpaginaHTML(actueleKolommen, weekNr, isExport) {
  const basisUrl = isExport ? './pictures/' : './pictures/';

  // Verzamel alle unieke taken over alle kolommen, met hun route-info
  // Elke taak kan meerdere keren voorkomen (één per route)
  const taakBlokken = [];

  ['G', 'B', 'Z'].forEach(route => {
    const lijst = actueleKolommen[route];
    lijst.forEach((taak, idx) => {
      const vtTekst = berekenVtTekst(taak, lijst);
      taakBlokken.push({ taak, route, idx, vtTekst });
    });
  });

  // Genereer HTML per taakblok
  const blokkenHtml = taakBlokken.map(({ taak, route, idx, vtTekst }) => {
    const taakId = `taak-${taak.id}-${route}`;
    const tijd = taak.tijd === 'rooster' ? 'rooster' : `${taak.tijd}'`;

    // Instructie
    let instructieHtml = '';
    if (taak.templateInhoud) {
      let tekst = taak.templateInhoud;
      const params = taak.templateParams || {};
      Object.entries(params).forEach(([k, v]) => {
        tekst = tekst.replace(new RegExp(`\\{${k}\\}`, 'g'), v || `{${k}}`);
      });
      instructieHtml = renderInstructieVoorExport(tekst);
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
    const lerenItems = scData.leren || [];
    const evalItems = scData.eval || [];
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
          const score = d.scores ? `<div class="score-tekst">${d.scores.replace(/\n/g, '<br>')}</div>` : '';
          return `<li>${d.tekst}${codes ? ` <span class="leerplandoel">(${codes})</span>` : ''}${score}</li>`;
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
    const typeIconen = { website: '🌐', video: '▶️', classroom: '🎓', bestand: '📄', andere: '📎' };
    let bronnenHtml = '';
    const bronnen = taak.bronnen || [];
    if (bronnen.length) {
      const tegels = bronnen.map(b => {
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
    const ind = taak.indienwijze || {};
    const rijen = [];
    if (ind.map) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon">📁</div><div class="indienen-rij-tekst">Bewaar alles in je map.</div></div>`);
    if (ind.digitaal) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon"><img src="${basisUrl}digitaal.png" style="width:32px;height:32px;object-fit:contain;"></div><div class="indienen-rij-tekst">Indienen in Google Classroom.</div></div>`);
    if (ind.vakje) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon">📥</div><div class="indienen-rij-tekst">In het vakje van ${taak.vak || 'het vak'}.</div></div>`);
    if (ind.anders && ind.andersText) rijen.push(`<div class="indienen-rij"><div class="indienen-rij-icoon">📌</div><div class="indienen-rij-tekst">${ind.andersText}</div></div>`);
    let indienHtml = '';
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

    // Volgtijdelijkheid blok
    const vtHtml = vtTekst
      ? `<div style="background:#fff3f3;border-left:4px solid #c0392b;padding:12px 20px;color:#c0392b;font-size:10.5pt;line-height:1.6;">${vtTekst}</div>`
      : '';

    return `
  <div class="taak-blok verborgen" id="${taakId}" data-routes="${route}">
    <div class="titelbalk">${taak.code}: ${taak.titel} (${tijd})</div>
    ${vtHtml}${voorkennisHtml}${scHtml}${instructieHtml}${bronnenHtml}${indienHtml}
  </div>`;
  }).join('\n');

  // Inhoudstafel
  const inhoudstafelLinks = ['G', 'B', 'Z'].flatMap(route =>
    (actueleKolommen[route] || []).map(taak => {
      const tijd = taak.tijd === 'rooster' ? 'rooster' : `${taak.tijd}'`;
      return `  <a href="#taak-${taak.id}-${route}" class="inhoudslink" data-routes="${route}">${taak.code}: ${taak.titel} (${tijd})</a>`;
    })
  ).join('\n');

  return `
<header class="site-header">
  <h1>week ${weekNr}</h1>
</header>

<div class="route-sectie">
  <div class="route-label">Kies jouw route</div>
  <div class="route-tegels">
    <div class="route-tegel G" onclick="kiesRoute('G')">G-route</div>
    <div class="route-tegel B" onclick="kiesRoute('B')">B-route</div>
    <div class="route-tegel Z" onclick="kiesRoute('Z')">Z-route</div>
  </div>
</div>

<div class="welkom-bericht" id="welkom-bericht">
  <strong>Welkom op de weekpagina!</strong>
  Klik hierboven op jouw route om de taken en lessen voor deze week te zien.
</div>

<nav class="inhoudstafel verborgen" id="inhoudstafel">
  <div class="inhoudstafel-titel">Deze week</div>
${inhoudstafelLinks}
</nav>

${blokkenHtml}`;
}

// ===== INSTRUCTIE RENDER VOOR EXPORT (weekpagina stijl) =====
function renderInstructieVoorExport(tekst) {
  const regels = tekst.split('\n');
  let stappen = '';
  let numTeller = 0;

  function inline(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/\[kleur:(\w+|#[0-9a-fA-F]{3,6})\](.+?)\[\/kleur\]/g, (m, k, t) => `<span style="color:${k};">${t}</span>`)
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\+\+/g, '<br>');
  }

  for (const regel of regels) {
    const g = regel.trimStart();
    const isGenest = regel.startsWith('  ') || regel.startsWith('\t');
    if (!g) { stappen += '<div style="height:5px;"></div>'; numTeller = 0; continue; }

    if (g.startsWith('## ')) {
      numTeller = 0;
      stappen += `<div class="sc-subtitel" style="margin-top:10px;">${g.slice(3)}</div>`;
    } else if (isGenest && g.match(/^\d+\|\s*/)) {
      stappen += `<div class="instructie-stap" style="padding-left:28px;"><div class="stap-nr" style="min-width:28px;"></div><div class="stap-tekst">${inline(g.replace(/^\d+\|\s*/, ''))}</div></div>`;
    } else if (isGenest && g.startsWith('- ')) {
      stappen += `<div style="display:flex;gap:8px;padding-left:28px;margin-bottom:4px;"><span style="color:#2c4a6e;">•</span><span>${inline(g.slice(2))}</span></div>`;
    } else if (g.match(/^\d+\|\s*/)) {
      numTeller++;
      stappen += `<div class="instructie-stap"><div class="stap-nr">${numTeller}|</div><div class="stap-tekst">${inline(g.replace(/^\d+\|\s*/, ''))}</div></div>`;
    } else if (g.startsWith('- ')) {
      stappen += `<div style="display:flex;gap:8px;margin-bottom:4px;"><span style="color:#2c4a6e;">•</span><span>${inline(g.slice(2))}</span></div>`;
    } else {
      stappen += `<div style="margin-bottom:4px;">${inline(g)}</div>`;
    }
  }

  return `
  <div class="sectie wit">
    <div class="sectie-icoon"><img src="./pictures/instructies.png" alt="Instructies"></div>
    <div class="sectie-inhoud">
      <div class="sectie-titel">Instructies</div>
      <div class="instructie-stappen">${stappen}</div>
    </div>
  </div>`;
}

// ===== CSS VOOR EXPORT =====
function weekpaginaCSS() {
  return `<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --blauw: #2c4a6e; --blauw-donker: #1e3a56;
    --grijs-licht: #f2f2f2; --wit: #ffffff; --geel: #fffacd;
    --oranje: #e07b00; --tekst: #222222; --tekst-licht: #555555;
    --font: 'Lato', sans-serif;
  }
  body { font-family: var(--font); font-size: 11pt; color: var(--tekst); background: #fff; }
  .site-header {
    background: linear-gradient(135deg, #1e3a56 0%, #2c4a6e 50%, #3a5f8a 100%);
    color: white; text-align: center; padding: 60px 20px 50px; position: relative;
  }
  .site-header h1 { font-size: 48pt; font-weight: 900; letter-spacing: 2px; }
  .route-sectie { background: #fff; padding: 28px 40px 24px; border-bottom: 1px solid #ddd; }
  .route-label { font-size: 10pt; color: var(--tekst-licht); margin-bottom: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .route-tegels { display: flex; gap: 14px; flex-wrap: wrap; }
  .route-tegel { padding: 14px 32px; border-radius: 8px; font-size: 15pt; font-weight: 900; cursor: pointer; border: 3px solid transparent; transition: all 0.2s ease; letter-spacing: 1px; opacity: 0.72; }
  .route-tegel.G { background: #d4edda; color: #1a6b2f; border-color: #a8d5b5; }
  .route-tegel.B { background: #cce5ff; color: #0d47a1; border-color: #90c4f9; }
  .route-tegel.Z { background: #f8d7da; color: #8b1a1a; border-color: #f0a8ae; }
  .route-tegel:hover, .route-tegel.actief { opacity: 1; box-shadow: 0 4px 16px rgba(0,0,0,0.18); transform: translateY(-2px); }
  .welkom-bericht { padding: 56px 40px; text-align: center; color: var(--tekst-licht); font-size: 13pt; line-height: 1.8; }
  .welkom-bericht strong { color: var(--blauw); font-size: 15pt; display: block; margin-bottom: 8px; }
  .inhoudstafel { padding: 16px 40px 20px; background: #fff; border-bottom: 2px solid #eee; }
  .inhoudstafel-titel { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--tekst-licht); margin-bottom: 8px; }
  .inhoudstafel a { color: var(--blauw); text-decoration: underline; font-size: 11pt; display: block; margin-bottom: 4px; line-height: 1.6; }
  .taak-blok { margin: 0; border-top: 4px solid var(--blauw-donker); }
  .verborgen { display: none !important; }
  .titelbalk { background: var(--blauw); color: white; padding: 16px 40px; font-size: 19pt; font-weight: 700; scroll-margin-top: 20px; }
  .sectie { display: flex; align-items: flex-start; gap: 24px; padding: 28px 40px; }
  .sectie.grijs { background: var(--grijs-licht); }
  .sectie.wit { background: var(--wit); }
  .sectie.geel { background: var(--geel); }
  .sectie-icoon { width: 56px; min-width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; }
  .sectie-icoon img { width: 56px; height: 56px; object-fit: contain; }
  .sectie-inhoud { flex: 1; }
  .sectie-titel { font-size: 15pt; font-weight: 700; color: var(--tekst); margin-bottom: 12px; }
  ul.doel-lijst { list-style: disc; padding-left: 22px; line-height: 1.7; }
  ul.doel-lijst li { margin-bottom: 4px; }
  .instructie-stappen { display: flex; flex-direction: column; gap: 6px; }
  .instructie-stap { display: flex; align-items: flex-start; line-height: 1.7; }
  .stap-nr { min-width: 28px; font-size: 11pt; font-weight: 700; flex-shrink: 0; padding-top: 1px; }
  .stap-tekst { flex: 1; }
  .sc-subtitel { font-size: 11pt; font-weight: 700; color: var(--oranje); margin: 14px 0 6px; text-decoration: underline; }
  .sc-subtitel:first-child { margin-top: 0; }
  .leerplandoel { color: var(--tekst-licht); font-size: 10pt; }
  .score-tekst { font-size: 9pt; color: var(--tekst-licht); margin-left: 4px; line-height: 1.6; margin-top: 2px; }
  .bron-tegels { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; }
  .bron-tegel { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: 110px; height: 110px; padding: 12px 8px; background: white; border: 1.5px solid #ccc; border-radius: 10px; text-decoration: none; color: var(--tekst); font-size: 10pt; font-weight: 700; text-align: center; line-height: 1.3; }
  .bron-icoon { font-size: 28px; }
  .indienen-rijen { display: flex; flex-direction: column; gap: 18px; margin-top: 4px; }
  .indienen-rij { display: flex; align-items: flex-start; gap: 16px; }
  .indienen-rij-icoon { font-size: 28px; min-width: 40px; text-align: center; }
  .indienen-rij-tekst { font-size: 11pt; line-height: 1.6; }
  @media (max-width: 600px) {
    .sectie { padding: 20px 18px; gap: 14px; }
    .titelbalk { padding: 14px 18px; font-size: 15pt; }
    .route-sectie, .inhoudstafel { padding: 18px; }
  }
</style>`;
}

// ===== JS VOOR EXPORT =====
function weekpaginaScript() {
  return `<script>
  function kiesRoute(route) {
    document.querySelectorAll('.route-tegel').forEach(t => t.classList.remove('actief'));
    document.querySelector('.route-tegel.' + route).classList.add('actief');
    document.getElementById('welkom-bericht').classList.add('verborgen');
    document.getElementById('inhoudstafel').classList.remove('verborgen');
    document.querySelectorAll('.taak-blok').forEach(blok => {
      blok.classList.toggle('verborgen', blok.dataset.routes !== route);
    });
    document.querySelectorAll('.inhoudslink').forEach(link => {
      link.style.display = link.dataset.routes === route ? 'block' : 'none';
    });
  }
<\/script>`;
}
