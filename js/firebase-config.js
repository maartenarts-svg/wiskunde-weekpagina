import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCe-t-qqWtlBeYOwG_ZdwpQD6bfhjII_rQ",
  authDomain: "wiskunde-lab.firebaseapp.com",
  projectId: "wiskunde-lab",
  storageBucket: "wiskunde-lab.firebasestorage.app",
  messagingSenderId: "342551199574",
  appId: "1:342551199574:web:00dc6da4ba8e849075e0f7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
