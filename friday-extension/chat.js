// chat.js
import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs } from './firebase/firebase-firestore.js';

document.addEventListener("DOMContentLoaded", () => {
  import('./ai-helper.js').then(({ getAIResponse }) => {
    const chatMessages = document.getElementById("chatMessages");
    const chatInput = document.getElementById("chatInput");
    const micBtn = document.getElementById("micBtn");
    const voiceReplyToggle = document.getElementById("voiceReplyToggle");

    const synth = window.speechSynthesis;
    let recognition;
    let isMicActive = false;
    let selectedMeeting = null;
    let userUid = null;
    let isProcessing = false;

    function initSpeechRecognition() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Speech Recognition not supported in this browser.");
        micBtn.disabled = true;
        return;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        isMicActive = true;
        micBtn.textContent = '●';
        micBtn.style.color = 'red';
        micBtn.title = 'Listening... Click to stop';
      };

      recognition.onend = () => {
        isMicActive = false;
        micBtn.textContent = '🎤';
        micBtn.style.color = '';
        micBtn.title = 'Speak your question';
      };

      recognition.onerror = (e) => {
        console.error("Speech error:", e.error);
        alert("Mic error: " + e.error);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        chatInput.value = transcript;
        chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      };
    }

    function extractFolderId(driveUrl) {
      const match = driveUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    }

    function linkify(text) {
      const urlPattern = /https?:\/\/[^\s"<>]+/g;
      return text.replace(urlPattern, (url) => {
        const safeUrl = url.replace(/"/g, "&quot;");
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
    }

    chrome.storage.local.get(["selectedMeetingForChat", "uid"], async (result) => {
  if (result.selectedMeetingForChat && result.uid) {
    selectedMeeting = result.selectedMeetingForChat;
    userUid = result.uid;

    if (selectedMeeting.meetingId) {
      await loadChatHistory(userUid, selectedMeeting.meetingId); // 🔁 Load chat
    }
  } else {
    alert("No meeting selected. Please open chat from the dashboard after selecting a meeting.");
  }
});


    async function searchFilesRecursively(folderId, queryText, token) {
      const matches = [];

      async function searchFolder(folderId) {
        const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          }
        });

        if (res.status === 403) {
          const err = new Error("Access denied to Drive folder");
          err.status = 403;
          throw err;
        }

        const data = await res.json();

        if (!data.files || !Array.isArray(data.files)) {
          console.error("Drive API error or no files:", data);
          return;
        }

        for (const file of data.files) {
          if (!queryText || file.name.toLowerCase().includes(queryText.toLowerCase())) {
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

    function getAuthToken() {
      return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError || !token) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(token);
          }
        });
      });
    }
    
    function getMeetingStatus(meetingDateStr) {
      const today = new Date();
      const meetingDate = new Date(meetingDateStr);

      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const meetingOnly = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());

      if (meetingOnly.getTime() === todayOnly.getTime()) return "today";
      if (meetingOnly < todayOnly) return "in the past";
      return "upcoming";
    }
//** 
    async function saveChatMessage(uid, meetingId, role, content) {
        try {
            const chatRef = collection(db, "users", uid, "meetings", meetingId, "chats");
            await addDoc(chatRef, {
            role,
            content,
            timestamp: serverTimestamp()
            });
        } catch (err) {
            console.error("❌ Failed to save chat message:", err);
        }
    }

    async function loadChatHistory(uid, meetingId) {
  const chatRef = collection(db, "users", uid, "meetings", meetingId, "chats");
  const q = query(chatRef, orderBy("timestamp", "asc"));

  try {
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
      const { role, content } = doc.data();
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${role === "user" ? "user-bubble" : "ai-bubble"}`;
      bubble.innerHTML = linkify(content);
      chatMessages.appendChild(bubble);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    console.error("❌ Failed to load chat history:", err);
  }
}


    chatInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || isProcessing) return;
      isProcessing = true;

      const input = chatInput.value.trim();
      if (!input) {
        isProcessing = false;
        return;
      }

      const userBubble = document.createElement("div");
      userBubble.className = "chat-bubble user-bubble";
      userBubble.textContent = input;
      chatMessages.appendChild(userBubble);

      if (userUid && selectedMeeting.meetingId) {
  saveChatMessage(userUid, selectedMeeting.meetingId, "user", input);
}


      const aiBubble = document.createElement("div");
      aiBubble.className = "chat-bubble ai-bubble";
      aiBubble.textContent = "Thinking...";
      chatMessages.appendChild(aiBubble);

      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.value = "";

      if (!selectedMeeting) {
        aiBubble.textContent = "⚠️ No meeting data found. Please select a meeting first.";
        isProcessing = false;
        return;
      }

      // Show all files in drive folder on specific command
      const showFilesQuery = /\b(show|list|display) (me )?(the )?(drive folder|documents|files|docs|drive files)\b/i;
      if (showFilesQuery.test(input)) {
        const folderId = extractFolderId(selectedMeeting.driveFolderLink);
        if (!folderId) {
          aiBubble.innerHTML = "⚠️ Could not extract Drive folder ID.";
          isProcessing = false;
          return;
        }
        try {
          const token = await getAuthToken();
          const files = await searchFilesRecursively(folderId, "", token);

          if (files.length === 0) {
                aiBubble.innerHTML = "No files found inside your Drive folder.";
            if (userUid && selectedMeeting.meetingId) {
                saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", "No files found inside your Drive folder.");
            }
        } else {
            aiBubble.innerHTML = `<b>Files in your Drive folder:</b><br>` + 
            files.map(f =>
             `<div>📄 <a href="${f.webViewLink}" target="_blank" rel="noopener noreferrer">${f.name}</a></div>`
            ).join("");

        if (userUid && selectedMeeting.meetingId) {
            const fileListText = files.map(f => `📄 ${f.name}`).join("\n");
            const replyToSave = `Files in your Drive folder:\n${fileListText}`;
            saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", replyToSave);
        }
}

        } catch (err) {
          if (err && err.status === 403) {
            aiBubble.innerHTML = `
              ⚠️ Access denied to the Drive folder.<br>
              Please <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">request access here</a> and then try again.
            `;
          } else {
            console.error("Drive API error:", err);
            aiBubble.textContent = "❌ Error accessing Google Drive.";
          }
        }
        isProcessing = false;
        return;
      }

      // Search for specific files by keyword
      if (/find|search|look.*for/i.test(input)) {
        const keyword = input.match(/["“](.*?)["”]/)?.[1] || input.replace(/.*\b(find|search|look.*for)\b/i, '').trim();
        const folderId = extractFolderId(selectedMeeting.driveFolderLink);
        if (!folderId) {
          aiBubble.innerHTML = "⚠️ Could not extract Drive folder ID.";
          isProcessing = false;
          return;
        }
        try {
          const token = await getAuthToken();
          const files = await searchFilesRecursively(folderId, keyword, token);
          if (files.length === 0) {
            aiBubble.innerHTML = "No matching files found in Drive.";
          } else {
            aiBubble.innerHTML = files.map(f =>
              `<div>
                🔗 <a href="${f.webViewLink}" target="_blank" rel="noopener noreferrer">${f.name}</a>
                <button class="openFileBtn" data-url="${f.webViewLink}">📂 Open</button>
              </div>`
            ).join("<br>");

            setTimeout(() => {
              aiBubble.querySelectorAll(".openFileBtn").forEach(btn => {
                btn.onclick = () => {
                  const url = btn.getAttribute("data-url");
                  window.open(url, "_blank", "width=600,height=500");
                };
              });
            }, 0);
          }
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } catch (err) {
          console.error("Drive search error:", err);
          aiBubble.textContent = "❌ Error searching Google Drive.";
        }
        isProcessing = false;
        return;
      }

      // Meeting date formatting and status
      const today = new Date();
      const todayFormatted = today.toLocaleDateString("en-US", {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });

      const meetingDateFormatted = new Date(selectedMeeting.meetingDate).toLocaleDateString("en-US", {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });

      const meetingStatus = getMeetingStatus(selectedMeeting.meetingDate);

      // Check if input is related to meeting context (to decide system prompt)
      const meetingKeywordsRegex = /\b(meeting|date|time|link|schedule|when|where)\b/i;
      const includeMeetingContext = meetingKeywordsRegex.test(input);

      const messages = [
        {
          role: "system",
          content: includeMeetingContext
            ? `You are a helpful and polite meeting assistant.
Today's date is ${todayFormatted}.
Meeting context:
- Meeting Date: ${meetingDateFormatted} (${meetingStatus})
- Meeting Time: ${selectedMeeting.meetingTime}
- Meeting Link: ${selectedMeeting.meetingLink}
- Drive Folder: ${selectedMeeting.driveFolderLink}

If the user asks whether the meeting is today, respond naturally:
- If it's today: "Yes, the meeting is today at [time]."
- If it's past: "The meeting was scheduled for [date], so it already took place."
- If it's upcoming: "The meeting is scheduled for [date] at [time]."

Be brief and friendly. Only use meeting info when relevant.`
            : `You are a helpful assistant. Only mention meeting details if the user asks about them explicitly. Answer the user question directly and concisely.`,
        },
        { role: "user", content: input }
      ];

      try {
        const aiReply = await getAIResponse(messages);
        aiBubble.innerHTML = linkify(aiReply);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        if (userUid && selectedMeeting.meetingId) {
  saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", aiReply);
}

        if (voiceReplyToggle.checked && synth) {
          if (synth.speaking) synth.cancel();

          const spokenText = aiReply
            .replace(/https:\/\/drive\.google\.com\/\S+/g, 'your Drive folder')
            .replace(/https:\/\/meet\.google\.com\/\S+/g, 'your meeting link')
            .replace(/https?:\/\/\S+/g, '[a link]');

          function getPreferredVoice() {
            const voices = synth.getVoices();
            return (
              voices.find(v => v.lang.startsWith('en') && v.name.includes('Google US English')) ||
              voices.find(v => v.lang.startsWith('en')) ||
              voices[0]
            );
          }

          function speakNow() {
            const utterance = new SpeechSynthesisUtterance(spokenText);
            utterance.lang = 'en-US';
            utterance.voice = getPreferredVoice();
            utterance.pitch = 1;
            utterance.rate = 1;
            utterance.volume = 1;
            synth.speak(utterance);
          }

          if (synth.getVoices().length === 0) {
            synth.addEventListener('voiceschanged', speakNow);
          } else {
            speakNow();
          }
        }
      } catch (err) {
        aiBubble.textContent = "⚠️ Failed to get AI response.";
        console.error("AI error:", err);
      }
      isProcessing = false;
    });

    micBtn.onclick = () => {
      if (!recognition) return;
      if (!isMicActive) {
        recognition.start();
      } else {
        recognition.stop();
      }
    };

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
          micBtn.textContent = '🎤';
          micBtn.style.color = '';
          micBtn.title = 'Speak your question';
        }
      } else if (message.type === "MIC_ERROR") {
        isMicActive = false;
        micBtn.textContent = '🎤';
        micBtn.style.color = '';
        micBtn.title = 'Speak your question';
        alert("Voice input error: " + message.error);
      } else if (message.type === "MIC_UNSUPPORTED") {
        micBtn.disabled = true;
        micBtn.title = "Speech Recognition not supported in active tab.";
      }
    });

    window.addEventListener("beforeunload", () => {
      chrome.storage.local.remove("chatWindowId");
    });

    initSpeechRecognition();
  });
}); 