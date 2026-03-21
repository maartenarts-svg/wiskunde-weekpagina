import { auth } from './firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { toonSectie } from './ui.js';

const provider = new GoogleAuthProvider();

export function initAuth(callbacks) {
  // Koppel inlog/uitlog knoppen
  document.getElementById('google-knop').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const fout = document.getElementById('inlog-fout');
      fout.textContent = 'Aanmelden mislukt: ' + e.message;
      fout.classList.add('zichtbaar');
    }
  });

  document.getElementById('uitlog-knop').addEventListener('click', async () => {
    await signOut(auth);
  });

  // Menu navigatie
  document.querySelectorAll('.menu-item[data-sectie]').forEach(item => {
    item.addEventListener('click', () => {
      toonSectie(item.dataset.sectie);
      if (callbacks.onSectie) callbacks.onSectie(item.dataset.sectie);
    });
  });

  // Auth state listener
  onAuthStateChanged(auth, gebruiker => {
    if (gebruiker) {
      document.getElementById('inlogscherm').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('gebruiker-naam').textContent =
        gebruiker.displayName || gebruiker.email;
      if (gebruiker.photoURL) {
        const foto = document.getElementById('gebruiker-foto');
        foto.src = gebruiker.photoURL;
        foto.style.display = 'block';
      }
      console.log('UID:', gebruiker.uid);
      if (callbacks.onIngelogd) callbacks.onIngelogd(gebruiker);
    } else {
      document.getElementById('inlogscherm').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      if (callbacks.onUitgelogd) callbacks.onUitgelogd();
    }
  });
}
