/**
 * Centrale app-brede cache voor Firestore-collecties.
 * Alle modules importeren hieruit i.p.v. zelf getDocs aan te roepen.
 *
 * Gebruik:
 *   import { haalCache, wisCache } from './appCache.js';
 *   const doelen = await haalCache('doelen', db);
 *   wisCache('doelen');
 */

import { collection, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const enkelvoudigeCollecties = new Set(['bronnen', 'doelen', 'leerplandoelen']);

const cache = {};
const bezig = {}; // voorkomt dubbele parallelle reads

/**
 * Haal collectie op uit cache. Laad van Firestore als niet aanwezig.
 * @param {string} naam - collectienaam ('doelen', 'taken', ...)
 * @param {object} db - Firestore instantie
 * @param {boolean} forceer - true = altijd opnieuw laden
 */
export async function haalCache(naam, db, forceer = false) {
  if (!forceer && cache[naam]) return cache[naam];

  // Wacht als dezelfde collectie al geladen wordt
  if (bezig[naam]) {
    await bezig[naam];
    return cache[naam];
  }

  let resolve;
  bezig[naam] = new Promise(r => { resolve = r; });

  try {
    console.log(`[Cache] Laden: ${naam}`);
    if (enkelvoudigeCollecties.has(naam)) {
      const snap = await getDoc(doc(db, naam, 'wiskunde1a'));
      cache[naam] = snap.exists() ? (snap.data().items || []) : [];
    } else {
      const snap = await getDocs(collection(db, naam));
      cache[naam] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    console.log(`[Cache] ${naam}: ${cache[naam].length} ${enkelvoudigeCollecties.has(naam) ? 'items' : 'docs'}`);
  } finally {
    delete bezig[naam];
    resolve?.();
  }
  return cache[naam];
}

/**
 * Wis één of meerdere collecties uit de cache.
 * Volgende aanroep van haalCache laadt opnieuw van Firestore.
 */
export function wisCache(...namen) {
  namen.forEach(naam => {
    delete cache[naam];
    console.log(`[Cache] Gewist: ${naam}`);
  });
}

/**
 * Wis alle caches.
 */
export function wisAlleCache() {
  Object.keys(cache).forEach(k => delete cache[k]);
  console.log('[Cache] Alles gewist');
}

/**
 * Geef huidige cache-staat terug (voor debugging).
 */
export function cacheStatus() {
  return Object.fromEntries(
    Object.entries(cache).map(([k, v]) => [k, v?.length ?? 'null'])
  );
}

// ===== RESET SIGNALEN =====
// Modules kunnen hier flags zetten die andere modules checken
const resetSignalen = {};

export function zetResetSignaal(naam) {
  resetSignalen[naam] = true;
}

export function checkResetSignaal(naam) {
  if (resetSignalen[naam]) {
    delete resetSignalen[naam];
    return true;
  }
  return false;
}
