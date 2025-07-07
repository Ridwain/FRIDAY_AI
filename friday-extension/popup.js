// 🔁 Redirect immediately if already logged in
chrome.storage.local.get(["email", "uid"], (result) => {
  if (result.email && result.uid) {
    window.location.href = "dashboard.html";
  }
});

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  signOut
} from './firebase/firebase-auth.js';
import {
  collection,
  getDocs
} from './firebase/firebase-firestore.js';

const loginBtn = document.getElementById("loginBtn");
const googleBtn = document.getElementById("googleBtn");
const status = document.getElementById("status");


loginBtn.onclick = async () => {
  chrome.storage.local.get(["email", "uid"], async (result) => {
    if (result.email && result.uid) {
      status.innerText = `Already logged in as ${result.email}`;
      return;
    }

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      chrome.storage.local.set({ email: user.email, uid: user.uid });
      window.location.href = "dashboard.html";

    } catch (err) {
      status.innerText = `Login error: ${err.message}`;
    }
  });
};


googleBtn.onclick = () => {
  chrome.storage.local.get(["email", "uid"], (result) => {
    if (result.email && result.uid) {
      status.innerText = `Already logged in as ${result.email}`;
      return;
    }

    const clientId = "837567341884-p2ri11n3tv2ha5l7v59rmd62p50iocu1.apps.googleusercontent.com";
    const redirectUri = "https://friday-e65f2.web.app/oauth2callback.html"; // hosted redirect URI
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `response_type=token&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=email%20profile&` +
      `prompt=select_account`;

    // Open the OAuth URL in a popup window
    const width = 500;
    const height = 600;
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);

    const popup = window.open(authUrl, "oauth2_popup",
      `width=${width},height=${height},top=${top},left=${left}`);

    window.addEventListener("message", async (event) => {
       if (event.origin !== new URL(redirectUri).origin) return;
      if (event.data.type === "oauth2callback") {
        if (event.data.error) {
          status.innerText = `OAuth error: ${event.data.error}`;
          popup.close();
          return;
        }
        if (event.data.accessToken) {
          popup.close();
          try {
            const credential = GoogleAuthProvider.credential(null, event.data.accessToken);
            const result = await signInWithCredential(auth, credential);
            const user = result.user;
            chrome.storage.local.set({ email: user.email, uid: user.uid });
            window.location.href = "dashboard.html";

          } catch (error) {
            status.innerText = `Firebase sign-in error: ${error.message}`;
            console.error(error);
          }
        }
      }
    }, { once: true });
  });
};
