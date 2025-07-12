import { auth, db } from './firebase-config.js';
import { signOut } from './firebase/firebase-auth.js';
import { collection, getDocs } from './firebase/firebase-firestore.js';

const welcome = document.getElementById("welcome");
const meetingsDiv = document.getElementById("meetings");
const logoutBtn = document.getElementById("logoutBtn");

let selectedMeeting = null;

document.getElementById('bottomButtons').style.display = 'none';

chrome.storage.local.get(["email", "uid", "selectedMeetingForChat"], async (result) => {
  if (!result.email || !result.uid) {
    welcome.innerText = "Not logged in.";
    return;
  }

  welcome.innerText = `Welcome, ${result.email}`;
  selectedMeeting = result.selectedMeetingForChat || null;

  if (selectedMeeting) {
    showMeetingDetails(selectedMeeting); // show saved meeting view
  } else {
    loadMeetingList(result.uid); // load list if no meeting selected
  }
});

function loadMeetingList(uid) {
  const meetingsRef = collection(db, "users", uid, "meetings");
  getDocs(meetingsRef).then((snapshot) => {
    meetingsDiv.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      const div = document.createElement("div");
      div.className = "meeting-card";
      div.innerHTML = `
        <strong>${data.meetingDate} @ ${data.meetingTime}</strong><br>
        <em>Click to view details</em>
      `;
      div.onclick = () => showMeetingDetails(data);
      meetingsDiv.appendChild(div);
    });
  });
}

function showMeetingDetails(data) {
  selectedMeeting = data;

  meetingsDiv.innerHTML = `
    <h3>Meeting Details</h3>
    <p><strong>Date:</strong> ${data.meetingDate}</p>
    <p><strong>Time:</strong> ${data.meetingTime}</p>
    <p><strong>Link:</strong> <a href="${data.meetingLink}" target="_blank">${data.meetingLink}</a></p>
    <p><strong>Drive:</strong> <a href="${data.driveFolderLink}" target="_blank">${data.driveFolderLink}</a></p>
  `;

  const bottomButtons = document.getElementById('bottomButtons');
  bottomButtons.style.display = 'flex';

  document.getElementById("backBtn").onclick = () => {
    // First, get the window ID BEFORE clearing it
    chrome.storage.local.get("chatWindowId", ({ chatWindowId }) => {
      if (chatWindowId) {
        // Try to close the chat window
        chrome.windows.remove(chatWindowId, () => {
          // Now clear everything after closing the window
          chrome.storage.local.remove(["selectedMeetingForChat", "chatWindowId"], () => {
            window.location.reload();
          });
        });
      } else {
        // No chat window found, just clear and reload
        chrome.storage.local.remove(["selectedMeetingForChat", "chatWindowId"], () => {
          window.location.reload();
        });
      }
    });
  };

  document.getElementById("openChatBtn").onclick = () => {
    if (!selectedMeeting) {
      alert("Please select a meeting first.");
      return;
    }
    openOrFocusChatWindow(); // ✅ NEW FUNCTION BELOW
  };

  chrome.storage.local.set({ selectedMeetingForChat: data });
}

function openOrFocusChatWindow() {
  chrome.storage.local.get("chatWindowId", ({ chatWindowId }) => {
    if (chatWindowId) {
      chrome.windows.get(chatWindowId, (win) => {
        if (chrome.runtime.lastError || !win) {
          // Chat window not found (closed manually)
          launchChatWindow();
        } else {
          chrome.windows.update(chatWindowId, { focused: true });
        }
      });
    } else {
      launchChatWindow();
    }
  });
}

function launchChatWindow() {
  const chatWidth = 400;
  const chatHeight = 500;

  // Calculate bottom-right position
  const screenWidth = screen.availWidth;
  const screenHeight = screen.availHeight;

  const left = screenWidth - chatWidth - 10;  // 10px from right edge
  const top = screenHeight - chatHeight - 10; // 10px from bottom edge
  chrome.windows.create({
    url: "chat.html",
    type: "popup",
    width: chatWidth,
    height: chatHeight,
    left: left,
    top: top
  }, (win) => {
    if (win && win.id !== undefined) {
      chrome.storage.local.set({ chatWindowId: win.id });
    }
  });
}

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);

    chrome.storage.local.get("chatWindowId", ({ chatWindowId }) => {
      if (chatWindowId) {
        // Try to close the chat window if it's open
        chrome.windows.remove(chatWindowId, () => {
          // Clear storage afterward
          chrome.storage.local.remove([
            "email",
            "uid",
            "selectedMeetingForChat",
            "chatWindowId"
          ], () => {
            window.location.href = "popup.html";
          });
        });
      } else {
        // No chat window to close, just clear storage
        chrome.storage.local.remove([
          "email",
          "uid",
          "selectedMeetingForChat",
          "chatWindowId"
        ], () => {
          window.location.href = "popup.html";
        });
      }
    });

  } catch (error) {
    alert("Logout error: " + error.message);
  }}