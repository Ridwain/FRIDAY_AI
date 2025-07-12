// dashboard.js
import { auth, db } from './firebase-config.js';
import { signOut } from './firebase/firebase-auth.js';
import { collection, getDocs } from './firebase/firebase-firestore.js';
import { getAIResponse } from './ai-helper.js';

const welcome = document.getElementById("welcome");
const meetingsDiv = document.getElementById("meetings");
const logoutBtn = document.getElementById("logoutBtn");
const chatContainer = document.getElementById("chatContainer");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const closeChat = document.getElementById("closeChat");
const micBtn = document.getElementById("micBtn");
const voiceReplyToggle = document.getElementById("voiceReplyToggle");

// Speech synthesis (output)
const synth = window.speechSynthesis;

function formatDate(dateStr) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateStr).toLocaleDateString('en-US', options);
}

// -------------------------------------------------------------------
// Speech Recognition handled by content.js
// -------------------------------------------------------------------

let activeTabId = null; // Tab ID for injected content.js
let isMicActive = false; // Mic state from content.js messages
let selectedMeeting = null; // Clicked meeting

function extractFolderId(driveUrl) {
  const match = driveUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function searchFilesRecursively(folderId, queryText, token) {
  const matches = [];

  async function searchFolder(folderId) {
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (!data.files || !Array.isArray(data.files)) {
      console.error("Drive API returned error or no files:", data);
      return;
    }

    for (const file of data.files) {
      if (file.name.toLowerCase().includes(queryText.toLowerCase())) {
        matches.push(file);
      }
      if (file.mimeType === "application/vnd.google-apps.folder") {
        await searchFolder(file.id);
      }
    }
  }

  await searchFolder(folderId);
  return matches;
}

async function injectContentScript() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: [
      "*://*.google.com/*",
      "*://*.zoom.us/*",
      "*://*.zoom.com/*"
    ]
  });

  if (tabs.length === 0) {
    alert("Voice features require an open Google page (e.g., google.com, meet.google.com, drive.google.com) in the current window.");
    activeTabId = null;
    return false;
  }

  activeTabId = tabs[0].id;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js']
    });
    console.log("content.js injected into tab:", activeTabId);
    return true;
  } catch (error) {
    console.error("Failed to inject content.js:", error);
    alert("Failed to initialize voice features. Try refreshing or opening a new Google page.");
    activeTabId = null;
    return false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SPEECH_RESULT") {
    chatInput.value = message.transcript;
    chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  } else if (message.type === "MIC_STATUS") {
    if (message.status === "listening") {
      isMicActive = true;
      micBtn.textContent = '●';
      micBtn.style.color = 'red';
      micBtn.title = 'Listening... Click to stop';
    } else {
      isMicActive = false;
      micBtn.textContent = 'm';
      micBtn.style.color = 'initial';
      micBtn.title = 'Speak your question';
    }
  } else if (message.type === "MIC_ERROR") {
    isMicActive = false;
    micBtn.textContent = 'm';
    micBtn.style.color = 'initial';
    micBtn.title = 'Speak your question';
    alert("Voice input error: " + message.error);
    console.error("Speech Recognition Error:", message.error);
  } else if (message.type === "MIC_UNSUPPORTED") {
    micBtn.disabled = true;
    micBtn.title = "Speech Recognition not supported in the active tab.";
    console.warn("Speech Recognition not supported.");
  }
});

// -------------------------------------------------------------------
// Load user info and meetings
// -------------------------------------------------------------------

chrome.storage.local.get(["email", "uid"], async (result) => {
  if (!result.email || !result.uid) {
    welcome.innerText = "Not logged in.";
    return;
  }

  welcome.innerText = `Welcome, ${result.email}`;

  const meetingsRef = collection(db, "users", result.uid, "meetings");
  const snapshot = await getDocs(meetingsRef);

  meetingsDiv.innerHTML = ""; // Clear previous meetings

  snapshot.forEach(doc => {
    const data = doc.data();
    const div = document.createElement("div");
    div.className = "meeting-card";
    div.innerHTML = `
      <strong>${data.meetingDate} @ ${data.meetingTime}</strong><br>
      <em>Click to view details</em>
    `;

    div.onclick = () => {
      selectedMeeting = data;
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
      chrome.storage.local.set({ selectedMeetingForChat: data });

      document.getElementById("openChatBtn").onclick = () => {
        chatContainer.style.display = "flex";
        // Mic injection handled on mic button click now
      };
    };

    meetingsDiv.appendChild(div);
  });
});

// Logout handler
logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
    chrome.storage.local.remove(["email", "uid"]);
    window.location.href = "popup.html";
  } catch (error) {
    alert("Logout error: " + error.message);
  }
};

// Close chat handler
closeChat.onclick = () => {
  chatContainer.style.display = "none";
  if (activeTabId && isMicActive) {
    chrome.tabs.sendMessage(activeTabId, { type: "STOP_MIC" }).catch(e => console.error("Error stopping mic:", e));
  }
  activeTabId = null;
  isMicActive = false;
  micBtn.textContent = 'm';
  micBtn.style.color = 'initial';
  micBtn.title = 'Speak your question';
};

function linkify(text) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlPattern, (url) => {
    const safeUrl = url.replace(/"/g, "&quot;");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

// -------------------------------------------------------------------
// Chat input handler
// -------------------------------------------------------------------

chatInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;

  const input = chatInput.value.trim();
  if (!input) return;

  // Create chat bubbles for user input and AI reply placeholder
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

  // EARLY RETURN if no meeting selected — avoids null errors later
  if (!selectedMeeting) {
    aiBubble.textContent = "⚠️ No meeting data found. Please select a meeting first.";
    return;
  }

  // Safe to access selectedMeeting now
  try {
    // Prepare date objects and format them
    const todayObj = new Date();
    const meetingDateObj = new Date(selectedMeeting.meetingDate);

    const today = formatDate(todayObj.toISOString().split("T")[0]);
    const meetingDate = formatDate(meetingDateObj.toISOString().split("T")[0]);

    let meetingContextNote = "";
    if (meetingDateObj < todayObj && meetingDateObj.toDateString() !== todayObj.toDateString()) {
      meetingContextNote = `This meeting happened on ${meetingDate}.`;
    } else if (meetingDateObj.toDateString() === todayObj.toDateString()) {
      meetingContextNote = `This meeting is happening today.`;
    } else {
      meetingContextNote = `This meeting is scheduled for ${meetingDate}.`;
    }

    // Handle "list files" style queries directly with Drive API
    if (/\b(list|show|what|which|give|display).*(files|documents|items)\b/i.test(input)) {
      const folderId = extractFolderId(selectedMeeting.driveFolderLink);
      if (!folderId) {
        aiBubble.innerHTML = "⚠️ Could not extract Drive folder ID.";
        return;
      }

      const token = await getGoogleAccessToken();
      const files = await searchFilesRecursively(folderId, "", token);

      if (files.length === 0) {
        aiBubble.innerHTML = "❌ No files found in this Drive folder.";
      } else {
        aiBubble.innerHTML = `<strong>The Drive folder contains ${files.length} file(s):</strong><br><br>` +
          files.map(f => `🔹 <a href="${f.webViewLink}" target="_blank">${f.name}</a>`).join("<br>");
      }

      chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    // Prepare messages for AI prompt
    const messages = [
      {
        role: "system",
        content: `You are a helpful meeting assistant. Today's date is ${today}.
${meetingContextNote}
Meeting Info:
- Date: ${meetingDate}
- Time: ${selectedMeeting.meetingTime}
- Meeting Link: ${selectedMeeting.meetingLink}
- Drive Folder: ${selectedMeeting.driveFolderLink}`
      },
      {
        role: "user",
        content: input
      }
    ];

    // Handle 'find' keyword for file search within Drive folder
    let aiReply = "";

    if (input.toLowerCase().startsWith("find")) {
      const queryText = input.slice(5).trim();

      if (!selectedMeeting.driveFolderLink.includes("folders/")) {
        aiReply = "⚠️ Drive folder link is missing or invalid.";
      } else {
        const folderId = selectedMeeting.driveFolderLink.split("/folders/")[1].split(/[?#]/)[0];
        try {
          const token = await getAuthToken();
          const matches = await searchFilesRecursively(folderId, queryText, token);

          if (matches.length > 0) {
            aiReply = `🔍 Found ${matches.length} file(s):<br>` + matches.map(file =>
              `<a href="https://drive.google.com/file/d/${file.id}/view" target="_blank">${file.name}</a>`
            ).join("<br>");
          } else {
            aiReply = `❌ No files found matching "${queryText}" inside the Drive folder.`;
          }
        } catch (err) {
          aiReply = "⚠️ Error searching Drive folder.";
          console.error("Drive search error:", err);
        }
      }
    } else {
      aiReply = await getAIResponse(messages);
    }

    aiBubble.innerHTML = linkify(aiReply);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Optional voice reply
    if (voiceReplyToggle.checked && synth) {
      const spokenText = aiReply
        .replace(/https:\/\/drive\.google\.com\/\S+/g, 'your Drive folder')
        .replace(/https:\/\/meet\.google\.com\/\S+/g, 'your meeting link')
        .replace(/https?:\/\/\S+/g, '[a link]');

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = 'en-US';
      synth.speak(utterance);
    }

  } catch (err) {
    aiBubble.textContent = "⚠️ Failed to process your request.";
    console.error("Error processing chat input:", err);
  }
});


// -------------------------------------------------------------------
// Mic button click handler
// -------------------------------------------------------------------

micBtn.onclick = async () => {
  if (!activeTabId) {
    console.log("Injecting content script on mic click...");
    const success = await injectContentScript();
    if (!success) {
      console.log("Injection failed, aborting mic start.");
      return;
    }
  }

  try {
    if (!isMicActive) {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: "START_MIC" });
      if (!response || !response.success) {
        alert("Error starting microphone: " + (response?.message || "Unknown error"));
        return;
      }
      console.log("Mic started.");
    } else {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: "STOP_MIC" });
      if (!response || !response.success) {
        alert("Error stopping microphone: " + (response?.message || "Unknown error"));
        return;
      }
      console.log("Mic stopped.");
    }
  } catch (e) {
    console.error("Error communicating with content script:", e);
    alert("Mic command failed. Is the Google page still open?");
  }
};

// -------------------------------------------------------------------
// Helper functions to get Google OAuth tokens
// -------------------------------------------------------------------

export async function getGoogleAccessToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("Token missing"));
      } else {
        resolve(token);
      }
    });
  });
}

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("Token missing"));
      } else {
        resolve(token);
      }
    });
  });
}
