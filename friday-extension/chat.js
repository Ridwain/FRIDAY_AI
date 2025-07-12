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
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      return text.replace(urlPattern, (url) => {
        const safeUrl = url.replace(/"/g, "&quot;");
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
    }

    chrome.storage.local.get("selectedMeetingForChat", (result) => {
      if (result.selectedMeetingForChat) {
        selectedMeeting = result.selectedMeetingForChat;


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
        const data = await res.json();
        if (!data.files || !Array.isArray(data.files)) {
          console.error("Drive API error or no files:", data);
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


    chatInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
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

      if (!selectedMeeting) {
        aiBubble.textContent = "⚠️ No meeting data found. Please select a meeting first.";
        return;
      }

      if (/find|search|look.*for/i.test(input)) {
        const keyword = input.split(" ").pop();
        const folderId = extractFolderId(selectedMeeting.driveFolderLink);
        if (!folderId) {
          aiBubble.innerHTML = "⚠️ Could not extract Drive folder ID.";
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
          return;
        } catch (err) {
          console.error("Drive search error:", err);
          aiBubble.textContent = "❌ Error searching Google Drive.";
          return;
        }
      }

      const messages = [
        {
          role: "system",
          content: `You are a helpful meeting assistant. Meeting context:
        - Date: ${selectedMeeting.meetingDate}
        - Time: ${selectedMeeting.meetingTime}
        - Meeting Link: ${selectedMeeting.meetingLink}
        - Drive Folder: ${selectedMeeting.driveFolderLink}
        Only use this info if relevant to the user's question. Be brief and helpful.`
        },
        { role: "user", content: input }
      ];

      try {
        const aiReply = await getAIResponse(messages);
        aiBubble.innerHTML = linkify(aiReply);
        chatMessages.scrollTop = chatMessages.scrollHeight;

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
        aiBubble.textContent = "⚠️ Failed to get AI response.";
        console.error("AI error:", err);
      }
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
  });})