// UI functies

export function toonMelding(sectie, tekst, type) {
  const el = document.getElementById('melding-' + sectie);
  el.textContent = tekst;
  el.className = 'melding ' + type + ' zichtbaar';
  setTimeout(() => el.classList.remove('zichtbaar'), 4000);
}

export function niveauBadge(niveau) {
  const klassen = { basisgeletterdheid: 'badge-bg', basis: 'badge-basis', verdieping: 'badge-verdieping' };
  const labels = { basisgeletterdheid: 'Basisgel.', basis: 'Basis', verdieping: 'Verdieping' };
  return `<span class="badge ${klassen[niveau] || 'badge-basis'}">${labels[niveau] || niveau}</span>`;
}

export function toonSectie(naam) {
  document.querySelectorAll('.sectie').forEach(s => s.classList.remove('actief'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('actief'));
  document.getElementById('sectie-' + naam).classList.add('actief');
  const menuItem = document.getElementById('menu-' + naam);
  if (menuItem) menuItem.classList.add('actief');
  if (naam === 'doelen' || naam === 'bronnen') {
    import('./doelen.js').then(m => m.vulDatalijsten && m.vulDatalijsten());
  }
}
