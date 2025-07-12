import { initializeApp } from './firebase/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup
} from './firebase/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyCQkiNi5bsfoOUxj9HsxDupXR7SmUHGKPI",
  authDomain: "friday-e65f2.web.app",
  projectId: "friday-e65f2",
  storageBucket: "friday-e65f2.appspot.com",
  messagingSenderId: "837567341884",
  appId: "1:837567341884:web:1c940bd2cfdce899252a39"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// 🧠 THIS must run immediately after page load
signInWithPopup(auth, provider)
  .then(result => {
    const user = result.user;

    // Send info back to background script
    chrome.runtime.sendMessage({
      type: "LOGIN_SUCCESS",
      email: user.email,
      uid: user.uid
    });

    window.close(); // Close popup after success
  })
  .catch(err => {
    console.error("Google sign-in error:", err.message);
  });