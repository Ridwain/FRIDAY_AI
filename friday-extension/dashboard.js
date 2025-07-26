import { auth, db } from './firebase-config.js';
import { signOut } from './firebase/firebase-auth.js';
import { collection, getDocs, addDoc, setDoc, doc, serverTimestamp } from './firebase/firebase-firestore.js';

const welcome = document.getElementById("welcome");
const meetingsDiv = document.getElementById("meetings");
const logoutBtn = document.getElementById("logoutBtn");
const transcriptionBtn = document.getElementById("transcriptionBtn");

let selectedMeeting = null;
let isTranscribing = false;
let recognition;
let transcriptDocRef;
let accumulatedTranscript = "";
let audioContext;
let outputGain;

document.getElementById('bottomButtons').style.display = 'none';

chrome.storage.local.get(["email", "uid", "selectedMeetingForChat"], async (result) => {
  if (!result.email || !result.uid) {
    welcome.innerText = "Not logged in.";
    return;
  }

  welcome.innerText = `Welcome, ${result.email}`;
  selectedMeeting = result.selectedMeetingForChat || null;

  if (selectedMeeting) {
    showMeetingDetails(selectedMeeting);
  } else {
    loadMeetingList(result.uid);
  }
});

function loadMeetingList(uid) {
  const meetingsRef = collection(db, "users", uid, "meetings");
  getDocs(meetingsRef).then((snapshot) => {
    meetingsDiv.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      data.meetingId = doc.id;
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
    chrome.storage.local.get("chatWindowId", ({ chatWindowId }) => {
      if (chatWindowId) {
        chrome.windows.remove(chatWindowId, () => {
          chrome.storage.local.remove(["selectedMeetingForChat", "chatWindowId"], () => {
            window.location.reload();
          });
        });
      } else {
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
    openOrFocusChatWindow();
  };

  transcriptionBtn.onclick = () => {
    if (!selectedMeeting) {
      alert("Please select a meeting first.");
      return;
    }
    if (isTranscribing) {
      stopTranscription();
    } else {
      startTranscription();
    }
  };

  chrome.storage.local.set({ selectedMeetingForChat: data });
}

function openOrFocusChatWindow() {
  chrome.storage.local.get("chatWindowId", ({ chatWindowId }) => {
    if (chatWindowId) {
      chrome.windows.get(chatWindowId, (win) => {
        if (chrome.runtime.lastError || !win) {
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
  const screenWidth = screen.availWidth;
  const screenHeight = screen.availHeight;
  const left = screenWidth - chatWidth - 10;
  const top = screenHeight - chatHeight - 10;

  chrome.windows.create({
    url: chrome.runtime.getURL("chat.html"),
    type: "popup",
    focused: true,
    width: chatWidth,
    height: chatHeight,
    left: left,
    top: top
  }, (win) => {
    if (!win || !win.id) return;
    chrome.windows.update(win.id, {
      width: chatWidth,
      height: chatHeight,
      left: left,
      top: top,
      focused: true
    });
    chrome.storage.local.set({ chatWindowId: win.id });
  });
}

function startTranscription() {
  if (!selectedMeeting || !selectedMeeting.meetingLink.includes("meet.google.com")) {
    alert("Transcription is only supported for Google Meet meetings.");
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech Recognition not supported in this browser.");
    return;
  }

  chrome.tabs.query({ url: "*://meet.google.com/*" }, (tabs) => {
    if (!tabs.length) {
      alert("Please open the Google Meet meeting in a tab.");
      return;
    }

    const meetTab = tabs[0];
    chrome.tabCapture.capture({
      audio: true,
      video: false
    }, (stream) => {
      if (chrome.runtime.lastError || !stream) {
        alert("Failed to capture audio: " + (chrome.runtime.lastError?.message || "Unknown error"));
        return;
      }

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      outputGain = audioContext.createGain();
      source.connect(outputGain);
      outputGain.connect(audioContext.destination); // Ensure audio remains audible

      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      transcriptDocRef = doc(collection(db, "users", auth.currentUser.uid, "meetings", selectedMeeting.meetingId, "transcripts"));
      accumulatedTranscript = "";

      recognition.onresult = (event) => {
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            accumulatedTranscript += transcript + " ";
            setDoc(transcriptDocRef, { content: accumulatedTranscript, timestamp: serverTimestamp() }, { merge: true })
              .catch(err => console.error("Failed to save transcript:", err));
          } else {
            interimTranscript += transcript;
          }
        }
      };

      recognition.onerror = (e) => {
        console.error("Speech error:", e.error);
        alert("Transcription error: " + e.error);
        stopTranscription();
      };

      recognition.onend = () => {
        if (isTranscribing) {
          recognition.start(); // Restart to keep continuous transcription
        }
      };

      recognition.start();
      isTranscribing = true;
      transcriptionBtn.textContent = "🎙️ Stop Transcription";
      transcriptionBtn.title = "Stop Transcription";
    });
  });
}

function stopTranscription() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (outputGain) {
    outputGain.disconnect();
    outputGain = null;
  }
  isTranscribing = false;
  transcriptionBtn.textContent = "🎙️ Start Transcription";
  transcriptionBtn.title = "Start Transcription";
}

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
    chrome.storage.local.get("chatWindowId", ({ chatWindowId }) => {
      if (chatWindowId) {
        chrome.windows.remove(chatWindowId, () => {
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
  }
};