import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";

// Firebase config
const isLocalhost = window.location.hostname.includes("localhost") || window.location.hostname === "127.0.0.1";

const firebaseConfig = {
  apiKey: "AIzaSyCQkiNi5bsfoOUxj9HsxDupXR7SmUHGKPI",
  authDomain: isLocalhost
    ? "friday-e65f2.firebaseapp.com"
    : "friday-e65f2.web.app",
  projectId: "friday-e65f2",
  storageBucket: "friday-e65f2.appspot.com",
  messagingSenderId: "837567341884",
  appId: "1:837567341884:web:1c940bd2cfdce899252a39"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
auth.languageCode = 'en';

document.addEventListener("DOMContentLoaded", () => {
  // Redirect if already logged in (replace history so back doesn't come back)
  onAuthStateChanged(auth, (user) => {
    if (user && window.location.pathname.includes("index.html")) {
      window.location.replace("dashboard.html");
    }
  });

  // Toggle forms
  document.getElementById("show-signup").addEventListener("click", () => {
    document.getElementById("signup-form").classList.remove("hidden");
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("reset-password-form").classList.add("hidden");
    document.getElementById("show-reset").classList.remove("hidden");
    document.getElementById("back-to-login").classList.add("hidden");
  });

  document.getElementById("show-login").addEventListener("click", () => {
    document.getElementById("signup-form").classList.add("hidden");
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("reset-password-form").classList.add("hidden");
    document.getElementById("show-reset").classList.remove("hidden");
    document.getElementById("back-to-login").classList.add("hidden");
  });

  // Google login
  const provider = new GoogleAuthProvider();
  document.getElementById("google-login-btn").addEventListener("click", () => {
    signInWithPopup(auth, provider)
      .then((result) => {
        console.log("Google user:", result.user);
        // Use replace to avoid back button going back to login
        window.location.replace("dashboard.html");
      })
      .catch((error) => {
        console.error(error);
        alert(error.message);
      });
  });

  // Signup
  document.getElementById("signup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("signup-email").value;
    const password = document.getElementById("signup-password").value;

    createUserWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        console.log("Signed up:", userCredential.user);
        window.location.replace("dashboard.html");
      })
      .catch((error) => {
        console.error(error);
        alert(error.message);
      });
  });

  // Login
  document.getElementById("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;

    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        console.log("Logged in:", userCredential.user);
        window.location.replace("dashboard.html");
      })
      .catch((error) => {
        console.error(error);
        alert(error.message);
      });
  });

  // Show password reset form
  document.getElementById("show-reset").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("signup-form").classList.add("hidden");
    document.getElementById("reset-password-form").classList.remove("hidden");
    document.getElementById("show-reset").classList.add("hidden");
    document.getElementById("back-to-login").classList.remove("hidden");
  });

  // Back to login
  document.getElementById("back-to-login").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("reset-password-form").classList.add("hidden");
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("show-reset").classList.remove("hidden");
    document.getElementById("back-to-login").classList.add("hidden");
  });

  // Submit reset password form
  document.getElementById("reset-password-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const resetEmail = document.getElementById("reset-email").value;

    sendPasswordResetEmail(auth, resetEmail)
      .then(() => {
        alert("Password reset email sent! Check your inbox.");
        document.getElementById("reset-password-form").classList.add("hidden");
        document.getElementById("login-form").classList.remove("hidden");
        document.getElementById("show-reset").classList.remove("hidden");
        document.getElementById("back-to-login").classList.add("hidden");
      })
      .catch((error) => {
        console.error("Password reset error:", error);
        alert(error.message);
      });
  });

  // *** Improved auto-logout logic: only sign out if user returns after 1 minute ***
  const SIGNOUT_DELAY_MS = 12000; // 12 seconds (adjust as needed)

  window.addEventListener("beforeunload", () => {
    sessionStorage.setItem("lastUnload", Date.now().toString());
  });

  window.addEventListener("load", () => {
    const lastUnload = sessionStorage.getItem("lastUnload");
    if (lastUnload) {
      const diff = Date.now() - parseInt(lastUnload, 10);
      if (diff < SIGNOUT_DELAY_MS) {
        // Reload or quick revisit detected — do NOT sign out
        console.log("Page reloaded or quickly revisited; user stays logged in");
        sessionStorage.removeItem("lastUnload");
        return;
      }
    }
    // User returned after delay or no previous unload detected — sign out
    auth.signOut().catch((error) => {
      console.error("Error signing out on load:", error);
    });
  });
});
