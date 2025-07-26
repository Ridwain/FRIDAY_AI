import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, getDoc } from './firebase/firebase-firestore.js';

document.addEventListener("DOMContentLoaded", () => {
  import('./ai-helper.js').then(({ getAIResponse }) => {
    const chatMessages = document.getElementById("chatMessages");
    const chatInput = document.getElementById("chatInput");
    const micBtn = document.getElementById("micBtn");
    const voiceReplyToggle = document.getElementById("voiceReplyToggle");
    const sendBtn = document.getElementById("sendBtn");

    if (!chatMessages) {
      console.error("Error: Element with id 'chatMessages' not found in the DOM.");
      return;
    }
    if (!chatInput) {
      console.error("Error: Element with id 'chatInput' not found in the DOM.");
      return;
    }
    if (!micBtn) {
      console.warn("Warning: Element with id 'micBtn' not found; microphone functionality will be disabled.");
    }
    if (!voiceReplyToggle) {
      console.warn("Warning: Element with id 'voiceReplyToggle' not found; voice reply toggle will be disabled.");
    }
    if (!sendBtn) {
      console.warn("Warning: Element with id 'sendBtn' not found; send button functionality will be disabled.");
    }

    const synth = window.speechSynthesis;
    let recognition;
    let isMicActive = false;
    let selectedMeeting = null;
    let userUid = null;
    let isProcessing = false;
    const filesContentMap = {};

    function initSpeechRecognition() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Speech Recognition not supported in this browser.");
        if (micBtn) micBtn.disabled = true;
        return;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        isMicActive = true;
        if (micBtn) {
          micBtn.textContent = '●';
          micBtn.style.color = 'red';
          micBtn.title = 'Listening... Click to stop';
        }
      };

      recognition.onend = () => {
        isMicActive = false;
        if (micBtn) {
          micBtn.textContent = '🎤';
          micBtn.style.color = '';
          micBtn.title = 'Speak your question';
        }
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
        const safeUrl = url.replace(/"/g, "");
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
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

    async function listFilesInFolder(folderId, token) {
      const files = [];

      async function recurse(folderId) {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Drive API error: ' + res.status);
        const data = await res.json();

        for (const file of data.files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            await recurse(file.id);
          } else {
            files.push(file);
          }
        }
      }

      await recurse(folderId);
      return files;
    }

    async function downloadGoogleDocAsText(fileId, token) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to download Google Doc');
      return await res.text();
    }

    async function downloadPlainTextFile(fileId, token) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to download text file');
      return await res.text();
    }

    function splitText(text, maxLen = 500) {
      const chunks = [];
      for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.slice(i, i + maxLen));
      }
      return chunks;
    }

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

    function getMeetingStatus(meetingDateStr) {
      const today = new Date();
      const meetingDate = new Date(meetingDateStr);

      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const meetingOnly = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());

      if (meetingOnly.getTime() === todayOnly.getTime()) return "today";
      if (meetingOnly < todayOnly) return "in the past";
      return "upcoming";
    }

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
        if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      } catch (err) {
        console.error("❌ Failed to load chat history:", err);
      }
    }

    async function loadTranscript(uid, meetingId) {
      const transcriptRef = collection(db, "users", uid, "meetings", meetingId, "transcripts");
      const snapshot = await getDocs(transcriptRef);
      let transcriptContent = "";
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.content) {
          transcriptContent += data.content + "\n";
        }
      });
      return transcriptContent.trim();
    }

    chrome.storage.local.get(["selectedMeetingForChat", "uid"], async (result) => {
      if (result.selectedMeetingForChat && result.uid) {
        selectedMeeting = result.selectedMeetingForChat;
        userUid = result.uid;

        if (selectedMeeting.meetingId) {
          await loadChatHistory(userUid, selectedMeeting.meetingId);
        }
      } else {
        alert("No meeting selected. Please open chat from the dashboard after selecting a meeting.");
      }
    });

    chatInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || isProcessing) return;
      console.log("Enter pressed, input:", chatInput.value);
      isProcessing = true;

      const input = chatInput.value.trim();
      if (!input) {
        isProcessing = false;
        return;
      }

      console.log("Clearing input, current value:", chatInput.value);
      chatInput.value = "";
      chatInput.focus();

      const fileQuestionMatch = input.toLowerCase().match(/what\s+is\s+inside\s+([\w.\-]+\.\w+)/);
      if (fileQuestionMatch) {
        const filename = fileQuestionMatch[1].toLowerCase();
        console.log("Querying file:", filename);
        if (filesContentMap && filesContentMap[filename]) {
          const fileContent = filesContentMap[filename];
          const displayContent = fileContent.length > 0 ? (fileContent.length > 2000 ? fileContent.slice(0, 2000) + "..." : fileContent) : "This file is empty.";
          const aiBubble = document.createElement("div");
          aiBubble.className = "chat-bubble ai-bubble";
          aiBubble.textContent = displayContent;
          chatMessages.appendChild(aiBubble);
          if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

          if (userUid && selectedMeeting?.meetingId) {
            saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", displayContent);
          }
        } else {
          const aiBubble = document.createElement("div");
          aiBubble.className = "chat-bubble ai-bubble";
          aiBubble.textContent = `I couldn't find the file "${filename}" in your Drive folder.`;
          chatMessages.appendChild(aiBubble);
          if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

          if (userUid && selectedMeeting?.meetingId) {
            saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", `I couldn't find the file "${filename}" in your Drive folder.`);
          }
        }
      } else {
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

        if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

        if (!selectedMeeting) {
          aiBubble.textContent = "⚠️ No meeting data found. Please select a meeting first.";
        } else {
          const showFilesQuery = /\b(show|list|display) (me )?(the )?(drive folder|documents|files|docs|drive files)\b/i;
          if (showFilesQuery.test(input)) {
            const folderId = extractFolderId(selectedMeeting.driveFolderLink);
            if (!folderId) {
              aiBubble.innerHTML = "⚠️ Could not extract Drive folder ID.";
            } else {
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
            }
          } else if (/find|search|look.*for/i.test(input)) {
            const keyword = input.match(/["“](.*?)["”]/)?.[1] || input.replace(/.*\b(find|search|look.*for)\b/i, '').trim();
            const folderId = extractFolderId(selectedMeeting.driveFolderLink);
            if (!folderId) {
              aiBubble.innerHTML = "⚠️ Could not extract Drive folder ID.";
            } else {
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
                if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
              } catch (err) {
                console.error("Drive search error:", err);
                aiBubble.textContent = "❌ Error searching Google Drive.";
              }
            }
          } else {
            let fileContext = "";
            try {
              const folderId = extractFolderId(selectedMeeting.driveFolderLink);
              if (folderId) {
                const token = await getAuthToken();
                const files = await listFilesInFolder(folderId, token);

                const relevantFiles = files.filter(f =>
                  f.mimeType === "text/plain" ||
                  f.mimeType === "application/vnd.google-apps.document"
                );

                const fileTexts = [];

                for (const file of relevantFiles) {
                  let content = "";
                  if (file.mimeType === "text/plain") {
                    content = await downloadPlainTextFile(file.id, token);
                  } else if (file.mimeType === "application/vnd.google-apps.document") {
                    content = await downloadGoogleDocAsText(file.id, token);
                  }
                  const fileKey = file.name.toLowerCase();
                  filesContentMap[fileKey] = content;
                  console.log("Mapped file:", fileKey, "with content length:", content.length);
                  const chunks = splitText(content);
                  fileTexts.push(`File: ${file.name}\n${chunks.slice(0, 3).join("\n")}`);
                }

                fileContext = fileTexts.join("\n\n");
              }
            } catch (err) {
              console.warn("Error loading Drive files:", err);
            }

            let transcriptContext = "";
            try {
              transcriptContext = await loadTranscript(userUid, selectedMeeting.meetingId);
              if (!transcriptContext) {
                transcriptContext = "No transcript available for this meeting.";
              }
            } catch (err) {
              console.warn("Error loading transcript:", err);
              transcriptContext = "Failed to load meeting transcript.";
            }

            const today = new Date();
            const todayFormatted = today.toLocaleDateString("en-US", {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            const meetingDateFormatted = new Date(selectedMeeting.meetingDate).toLocaleDateString("en-US", {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            const meetingStatus = getMeetingStatus(selectedMeeting.meetingDate);

            const meetingKeywordsRegex = /\b(meeting|date|time|link|schedule|when|where|discussed|talked about|conversation)\b/i;
            const includeMeetingContext = meetingKeywordsRegex.test(input);

            const messages = [
              {
                role: "system",
                content: `
You are a helpful meeting assistant.

Today's date is ${todayFormatted}. Use this date directly when asked about it, without referencing any sources.

${fileContext ? "Here are some contents from the user's Drive folder, to be used only when relevant to the user's question:\n\n" + fileContext : ""}

${transcriptContext ? "Here is the transcript of the meeting, to be used when the user asks about what was discussed or meeting content:\n\n" + transcriptContext : "No meeting transcript available."}

${includeMeetingContext ? `
Meeting context (use only if explicitly asked about):
- Meeting Date: ${meetingDateFormatted} (${meetingStatus})
- Meeting Time: ${selectedMeeting.meetingTime}
- Meeting Link: ${selectedMeeting.meetingLink}
- Drive Folder: ${selectedMeeting.driveFolderLink}

If the user asks whether the meeting is today, respond naturally:
- If it's today: "Yes, the meeting is today at [time]."
- If it's past: "The meeting was scheduled for [date], so it already took place."
- If it's upcoming: "The meeting is scheduled for [date] at [time]."
` : "Only mention meeting details if the user asks about them explicitly."}

Be brief and friendly. Use Drive folder or meeting transcript only when directly relevant. If the question is unrelated to the provided context, respond with "I can't find an answer to this question."
                `.trim()
              },
              { role: "user", content: input }
            ];

            try {
              const aiReply = await getAIResponse(messages);
              aiBubble.innerHTML = linkify(aiReply);
              if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

              if (userUid && selectedMeeting.meetingId) {
                saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", aiReply);
              }

              if (voiceReplyToggle && voiceReplyToggle.checked && synth) {
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
                  utterance.onend = () => console.log("Speech ended");
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
          }
        }
      }

      isProcessing = false;
    });

    if (voiceReplyToggle) {
      voiceReplyToggle.addEventListener("change", () => {
        if (!voiceReplyToggle.checked && synth.speaking) {
          console.log("Voice reply stopped by user");
          synth.cancel();
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener("click", () => {
        if (isProcessing || !chatInput.value.trim()) return;
        chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      });
    }

    if (micBtn) {
      micBtn.onclick = () => {
        if (!recognition) return;
        if (!isMicActive) {
          recognition.start();
        } else {
          recognition.stop();
        }
      };
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "SPEECH_RESULT") {
        chatInput.value = message.transcript;
        chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      } else if (message.type === "MIC_STATUS") {
        if (micBtn) {
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
        }
      } else if (message.type === "MIC_ERROR") {
        isMicActive = false;
        if (micBtn) {
          micBtn.textContent = '🎤';
          micBtn.style.color = '';
          micBtn.title = 'Speak your question';
        }
        alert("Voice input error: " + message.error);
      } else if (message.type === "MIC_UNSUPPORTED") {
        if (micBtn) {
          micBtn.disabled = true;
          micBtn.title = "Speech Recognition not supported in active tab.";
        }
      }
    });

    window.addEventListener("beforeunload", () => {
      chrome.storage.local.remove("chatWindowId");
    });

    initSpeechRecognition();
  });
});