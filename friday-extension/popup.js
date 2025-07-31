chrome.storage.local.get(["email", "uid"], (result) => {
  if (result.email && result.uid) {
    window.location.href = "dashboard.html";
  } else {
    // Notify background script that extension page is available
    chrome.runtime.sendMessage({ type: "EXTENSION_PAGE_CONNECTED" });
  }
});

// Add message listener for transcript processing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROCESS_TRANSCRIPT_QUEUE") {
    // Process queued transcripts
    processQueuedTranscripts(message.queue);
    sendResponse({success: true});
  } else if (message.type === "SAVE_TRANSCRIPT_REQUEST") {
    // Handle direct transcript saving request
    saveTranscriptToFirebase(message.uid, message.meetingId, message.transcript);
    sendResponse({success: true});
  }
});

// Function to process queued transcripts
async function processQueuedTranscripts(queue) {
  const { db } = await import('./firebase-config.js');
  const { doc, setDoc, collection, serverTimestamp } = await import('./firebase/firebase-firestore.js');
  
  for (const item of queue) {
    try {
      const transcriptDocRef = doc(collection(db, "users", item.uid, "meetings", item.meetingId, "transcripts"));
      await setDoc(transcriptDocRef, { 
        content: item.transcript, 
        timestamp: serverTimestamp() 
      }, { merge: true });
      console.log(`Processed queued transcript for meeting ${item.meetingId}`);
    } catch (error) {
      console.error("Error processing queued transcript:", error);
    }
  }
  
  // Also process any stored transcripts
  await processStoredTranscripts();
}

// Function to process transcripts stored in chrome.storage
async function processStoredTranscripts() {
  try {
    const allData = await chrome.storage.local.get();
    const transcriptKeys = Object.keys(allData).filter(key => key.startsWith('transcript_'));
    
    if (transcriptKeys.length > 0) {
      const { db } = await import('./firebase-config.js');
      const { doc, setDoc, collection, serverTimestamp } = await import('./firebase/firebase-firestore.js');
      
      for (const key of transcriptKeys) {
        const [, uid, meetingId] = key.split('_');
        const transcript = allData[key];
        
        if (transcript && transcript.trim()) {
          const transcriptDocRef = doc(collection(db, "users", uid, "meetings", meetingId, "transcripts"));
          await setDoc(transcriptDocRef, { 
            content: transcript, 
            timestamp: serverTimestamp() 
          }, { merge: true });
          
          // Remove from storage after successful save
          await chrome.storage.local.remove(key);
          console.log(`Processed stored transcript for meeting ${meetingId}`);
        }
      }
    }
  } catch (error) {
    console.error("Error processing stored transcripts:", error);
  }
}

// Function to save transcript to Firebase (for direct requests)
async function saveTranscriptToFirebase(uid, meetingId, transcript) {
  try {
    const { db } = await import('./firebase-config.js');
    const { doc, setDoc, collection, serverTimestamp } = await import('./firebase/firebase-firestore.js');
    
    const transcriptDocRef = doc(collection(db, "users", uid, "meetings", meetingId, "transcripts"));
    await setDoc(transcriptDocRef, { 
      content: transcript, 
      timestamp: serverTimestamp() 
    }, { merge: true });
    console.log("Transcript saved successfully via popup");
  } catch (err) {
    console.error("Failed to save transcript:", err);
  }
}

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
const logoutBtn = document.getElementById("logoutBtn");

loginBtn.onclick = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    chrome.storage.local.set({ email: user.email, uid: user.uid }, () => {
      window.location.href = "dashboard.html"; // ✅ Redirect to dashboard
    });
  } catch (err) {
    status.innerText = `Login error: ${err.message}`;
  }
};

googleBtn.onclick = () => {
  const clientId = "837567341884-p2ri11n3tv2ha5l7v59rmd62p50iocu1.apps.googleusercontent.com"; // ⚠️
  const redirectUri = "https://friday-e65f2.web.app/oauth2callback.html"; // ⚠️
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

  // Listen for message from the hosted redirect page
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
          chrome.storage.local.set({ email: user.email, uid: user.uid }, () => {
            window.location.href = "dashboard.html"; // ✅ Redirect to dashboard
          });
        } catch (error) {
          status.innerText = `Firebase sign-in error: ${error.message}`;
          console.error(error);
        }
      }
    }
  }, { once: true });
};

chrome.storage.local.get(["email", "uid"], async (result) => {
  if (result.email && result.uid) {
    status.innerText = `Welcome ${result.email}`;
    document.getElementById("logoutBtn").style.display = "block"; // ✅ Show logout
    loadMeetings(result.uid);
  } else {
    document.getElementById("logoutBtn").style.display = "none"; // ✅ Hide logout
  }
});

async function loadMeetings(uid) {
  const meetingsRef = collection(db, "users", uid, "meetings");
  const snapshot = await getDocs(meetingsRef);
  const container = document.getElementById("meetings");
  container.innerHTML = "";

  snapshot.forEach(doc => {
    const data = doc.data();
    data.meetingId = doc.id;
    const div = document.createElement("div");
    div.style.marginBottom = "10px";
    div.innerHTML = `
      <strong>${data.meetingDate} @ ${data.meetingTime}</strong><br>
      <a href="${data.meetingLink}" target="_blank">Join</a><br>
      <a href="${data.driveFolderLink}" target="_blank">Drive</a>
    `;
    container.appendChild(div);
  });
}

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
    chrome.storage.local.remove(["email", "uid"]);
    status.innerText = "Logged out.";
    document.getElementById("meetings").innerHTML = "";
  } catch (error) {
    status.innerText = `Logout error: ${error.message}`;
  }
};