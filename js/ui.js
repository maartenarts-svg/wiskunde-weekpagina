// ===== UI HULPFUNCTIES =====

export function toonMelding(sectie, tekst, type) {
  const el = document.getElementById('melding-' + sectie);
  if (!el) return;
  el.textContent = tekst;
  el.className = 'melding ' + type + ' zichtbaar';
  setTimeout(() => el.classList.remove('zichtbaar'), 4000);
}

export function niveauBadge(niveau) {
  const klassen = {
    basisgeletterdheid: 'badge-bg',
    basis: 'badge-basis',
    verdieping: 'badge-verdieping'
  };
  const labels = {
    basisgeletterdheid: 'Basisgel.',
    basis: 'Basis',
    verdieping: 'Verdieping'
  };
  return `<span class="badge ${klassen[niveau] || 'badge-basis'}">${labels[niveau] || niveau}</span>`;
}

export function toonSectie(naam) {
  document.querySelectorAll('.sectie').forEach(s => s.classList.remove('actief'));
  document.querySelectorAll('.menu-item[data-sectie]').forEach(m => m.classList.remove('actief'));
  const sectie = document.getElementById('sectie-' + naam);
  if (sectie) sectie.classList.add('actief');
  const menuItem = document.getElementById('menu-' + naam);
  if (menuItem) menuItem.classList.add('actief');
}
