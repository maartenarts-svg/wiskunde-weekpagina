import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export async function migreerNaarWiskunde1a(logFn) {
  const collecties = ['bronnen', 'doelen', 'leerplandoelen'];

  for (const naam of collecties) {
    logFn(`⏳ ${naam}: documenten laden...`);

    const snap = await getDocs(collection(db, naam));
    const oudeDocumenten = snap.docs.filter(d => d.id !== 'wiskunde1a');

    if (!oudeDocumenten.length) {
      logFn(`✓ ${naam}: al gemigreerd of leeg — overgeslagen.`);
      continue;
    }

    logFn(`📦 ${naam}: ${oudeDocumenten.length} documenten gevonden.`);

    const items = oudeDocumenten.map(d => ({ id: d.id, ...d.data() }));

    logFn(`💾 ${naam}: opslaan als wiskunde1a...`);
    await setDoc(doc(db, naam, 'wiskunde1a'), { items });

    logFn(`🗑️ ${naam}: oude documenten verwijderen...`);
    const BATCH_GROOTTE = 400;
    for (let i = 0; i < oudeDocumenten.length; i += BATCH_GROOTTE) {
      const batch = writeBatch(db);
      oudeDocumenten.slice(i, i + BATCH_GROOTTE).forEach(d => {
        batch.delete(doc(db, naam, d.id));
      });
      await batch.commit();
    }

    logFn(`✅ ${naam}: ${items.length} items succesvol gemigreerd.`);
  }

  logFn('🎉 Migratie voltooid! Je kunt deze sectie nu sluiten.');
}
