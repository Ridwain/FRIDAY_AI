// dashboard.js
import { auth, db } from './firebase-config.js';
import { signOut } from './firebase/firebase-auth.js';
import { collection, getDocs } from './firebase/firebase-firestore.js';

const welcome = document.getElementById("welcome");
const meetingsDiv = document.getElementById("meetings");
const logoutBtn = document.getElementById("logoutBtn");
const chatContainer = document.getElementById("chatContainer");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const closeChat = document.getElementById("closeChat");
const micBtn = document.getElementById("micBtn");
const voiceReplyToggle = document.getElementById("voiceReplyToggle");

// Speech synthesis (output) - This remains in dashboard.js for replying
const synth = window.speechSynthesis;

// -------------------------------------------------------------------
// Speech Recognition (Input) Logic - Handled by injected content.js
// No direct SpeechRecognition initialization here anymore.
// -------------------------------------------------------------------

let activeTabId = null; // To store the ID of the tab where content.js is injected
let isMicActive = false; // To track mic status based on messages from content.js

// Function to inject content script into a relevant tab
// Now returns true if successful, false otherwise
async function injectContentScript() {
  // Query for an active tab that is any Google page
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: ["*://*.google.com/*",
          "*://*.zoom.us/*",    // Any Zoom.us domain
          "*://*.zoom.com/*"     // Any Zoom.com domain
        ]
  });

  if (tabs.length === 0) {
    alert("Voice features require an open Google page (e.g., google.com, meet.google.com, drive.google.com) in the current window.");
    activeTabId = null; // Ensure activeTabId is null if no suitable tab
    return false; // Indicate failure
  }

  activeTabId = tabs[0].id; // Store the ID of the chosen tab

  try {
    // Inject content.js into the identified tab
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js']
    });
    console.log("content.js injected successfully into tab:", activeTabId);
    return true; // Indicate success
  } catch (error) {
    console.error("Failed to inject content.js:", error);
    alert("Failed to initialize voice features. Please try refreshing the Google page or opening a new one.");
    activeTabId = null; // Clear if injection failed
    return false; // Indicate failure
  }
}

// -------------------------------------------------------------------
// Message listeners from content.js (the actual mic handler)
// -------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SPEECH_RESULT") {
    // When content.js gets a transcript, put it in the chat input
    chatInput.value = message.transcript;
    // Trigger the enter key event to process the input
    chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  } else if (message.type === "MIC_STATUS") {
    // Update mic button based on status from content.js
    if (message.status === "listening") {
      isMicActive = true;
      micBtn.textContent = '●'; // Visual indicator: recording
      micBtn.style.color = 'red';
      micBtn.title = 'Listening... Click to stop';
    } else {
      isMicActive = false;
      micBtn.textContent = 'm'; // Visual indicator: idle
      micBtn.style.color = 'initial';
      micBtn.title = 'Speak your question';
    }
  } else if (message.type === "MIC_ERROR") {
    isMicActive = false; // Reset state on error
    micBtn.textContent = 'm';
    micBtn.style.color = 'initial';
    micBtn.title = 'Speak your question';
    alert("Voice input error: " + message.error);
    console.error("Content Script Speech Recognition Error:", message.error);
  } else if (message.type === "MIC_UNSUPPORTED") {
    micBtn.disabled = true;
    micBtn.title = "Speech Recognition not supported in the active tab.";
    console.warn("Speech Recognition not supported in the active tab.");
  }
  // No need to sendResponse unless the content script is explicitly waiting for it.
});

// -------------------------------------------------------------------
// Event Handlers
// -------------------------------------------------------------------

// Load user info
chrome.storage.local.get(["email", "uid"], async (result) => {
  if (!result.email || !result.uid) {
    welcome.innerText = "Not logged in.";
    return;
  }

  welcome.innerText = `Welcome, ${result.email}`;

  const meetingsRef = collection(db, "users", result.uid, "meetings");
  const snapshot = await getDocs(meetingsRef);

  snapshot.forEach(doc => {
    const data = doc.data();
    const div = document.createElement("div");
    div.className = "meeting-card";
    div.innerHTML = `
      <strong>${data.meetingDate} @ ${data.meetingTime}</strong><br>
      <em>Click to view details</em>
    `;

    div.onclick = () => {
      meetingsDiv.innerHTML = `
        <h3>Meeting Details</h3>
        <p><strong>Date:</strong> ${data.meetingDate}</p>
        <p><strong>Time:</strong> ${data.meetingTime}</p>
        <p><strong>Link:</strong> <a href="${data.meetingLink}" target="_blank">${data.meetingLink}</a></p>
        <p><strong>Drive:</strong> <a href="${data.driveFolderLink}" target="_blank">${data.driveFolderLink}</a></p>
        <button id="backBtn">← Back to all meetings</button>
        <button id="openChatBtn">🧠 Ask AI</button>
      `;

      logoutBtn.style.display = "none";

      document.getElementById("backBtn").onclick = () => window.location.reload();

      // CHANGE HERE: Open chat box unconditionally when "Ask AI" is clicked
      document.getElementById("openChatBtn").onclick = () => {
        chatContainer.style.display = "flex";
        // NO LONGER CALL injectContentScript() here.
        // It will be called when the mic button is first clicked.
      };
    };

    meetingsDiv.appendChild(div);
  });
});

// Logout
logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
    chrome.storage.local.remove(["email", "uid"]);
    window.location.href = "popup.html";
  } catch (error) {
    alert("Logout error: " + error.message);
  }
};

// Close chat
closeChat.onclick = () => {
  chatContainer.style.display = "none";
  // If mic is active and content script was injected, try to stop it
  if (activeTabId && isMicActive) {
    chrome.tabs.sendMessage(activeTabId, { type: "STOP_MIC" }).catch(e => console.error("Error stopping mic on chat close:", e));
  }
  // Reset state variables and button appearance
  activeTabId = null;
  isMicActive = false;
  micBtn.textContent = 'm';
  micBtn.style.color = 'initial';
  micBtn.title = 'Speak your question';
};

// Handle text input
chatInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const input = chatInput.value.trim();
    if (!input) return;

    const userBubble = document.createElement("div");
    userBubble.className = "chat-bubble user-bubble";
    userBubble.textContent = input;
    chatMessages.appendChild(userBubble);

    const aiBubble = document.createElement("div");
    aiBubble.className = "chat-bubble ai-bubble";
    aiBubble.textContent = "Thinking...";
    chatMessages.appendChild(aiBubble);

    chatMessages.scrollTop = chatMessages.scrollHeight;
    chatInput.value = "";

    setTimeout(() => {
      const replyText = `AI (mock): I understand you're asking about "${input}"`;
      aiBubble.textContent = replyText;
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (voiceReplyToggle.checked && synth) {
        const utterance = new SpeechSynthesisUtterance(replyText);
        utterance.lang = 'en-US';
        synth.speak(utterance);
      }
    }, 1000);
  }
});

// Voice input (mic button handler)
micBtn.onclick = async () => {
  // If the content script hasn't been injected yet (no activeTabId)
  if (!activeTabId) {
    console.log("Mic button clicked: Content script not yet injected. Attempting injection.");
    const injectionSuccessful = await injectContentScript(); // Await injection
    if (!injectionSuccessful) {
      console.log("Content script injection failed. Cannot proceed with mic operations.");
      return; // Stop if injection failed (e.g., no Google page open)
    }
    console.log("Content script injected successfully (on mic click). Proceeding with mic operations.");
  }

  // Now that activeTabId is guaranteed to be set (or was already set),
  // proceed with sending messages to the content script.
  let response;
  if (!isMicActive) { // If currently idle, try to start
    response = await chrome.tabs.sendMessage(activeTabId, { type: "START_MIC" }).catch(e => {
        console.error("Error sending START_MIC message:", e);
        alert("Failed to send start command to microphone. Is the Google page still active?");
        return { success: false, message: e.message }; // Return a failure response
    });
    if (response && response.success) {
      console.log("Sent START_MIC message. Response:", response.message);
      // isMicActive will be set by the MIC_STATUS message from content.js
    } else if (response) {
      console.error("Failed to start mic via content script:", response.message);
      alert("Error starting microphone: " + response.message);
    }
  } else { // If currently listening, try to stop
    response = await chrome.tabs.sendMessage(activeTabId, { type: "STOP_MIC" }).catch(e => {
        console.error("Error sending STOP_MIC message:", e);
        alert("Failed to send stop command to microphone.");
        return { success: false, message: e.message }; // Return a failure response
    });
    if (response && response.success) {
      console.log("Sent STOP_MIC message. Response:", response.message);
      // isMicActive will be set by the MIC_STATUS message from content.js
    } else if (response) {
      console.error("Failed to stop mic via content script:", response.message);
      alert("Error stopping microphone: " + response.message);
    }
  }
};