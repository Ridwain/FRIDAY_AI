// transcription-content.js
(function() {
  let transcriptionState = {
    recognition: null,
    isActive: false,
    accumulatedTranscript: "",
    meetingId: null,
    uid: null,
    lastSaveTime: 0,
    saveInterval: 2000 // Save every 2 seconds during active transcription
  };

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_TRANSCRIPTION") {
      startTranscription(message.meetingId, message.uid);
      sendResponse({success: true});
    } else if (message.type === "STOP_TRANSCRIPTION") {
      stopTranscription();
      sendResponse({success: true});
    }
  });

  function startTranscription(meetingId, uid) {
    if (transcriptionState.isActive) {
      console.log("Transcription already active");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      chrome.runtime.sendMessage({
        type: "TRANSCRIPTION_ERROR",
        error: "Speech Recognition not supported in this browser"
      });
      return;
    }

    transcriptionState.meetingId = meetingId;
    transcriptionState.uid = uid;
    transcriptionState.accumulatedTranscript = "";
    transcriptionState.lastSaveTime = 0;
    transcriptionState.recognition = new SpeechRecognition();

    const recognition = transcriptionState.recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      transcriptionState.isActive = true;
      console.log("Speech recognition started");
      
      // Initialize the transcript document
      initializeTranscriptDocument();
      
      // Add visual indicator to the page
      addTranscriptionIndicator();
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interimTranscript += transcript;
        }
      }

      // Update accumulated transcript with final results
      if (finalTranscript) {
        transcriptionState.accumulatedTranscript += finalTranscript;
        
        // Save immediately when we have final transcript
        saveTranscriptRealtime();
      }

      // Update visual indicator with current transcript
      updateTranscriptionIndicator(finalTranscript || interimTranscript);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      
      // Don't stop on network errors, just restart
      if (event.error === 'network') {
        console.log("Network error, restarting recognition...");
        setTimeout(() => {
          if (transcriptionState.isActive) {
            try {
              recognition.start();
            } catch (e) {
              console.log("Recognition restart failed:", e.message);
            }
          }
        }, 1000);
        return;
      }

      chrome.runtime.sendMessage({
        type: "TRANSCRIPTION_ERROR",
        error: `Speech recognition error: ${event.error}`
      });
    };

    recognition.onend = () => {
      console.log("Speech recognition ended");
      
      // Restart recognition if still active (for continuous transcription)
      if (transcriptionState.isActive) {
        setTimeout(() => {
          try {
            if (transcriptionState.recognition && transcriptionState.isActive) {
              transcriptionState.recognition.start();
            }
          } catch (e) {
            // Recognition might already be started or failed
            console.log("Recognition restart failed:", e.message);
            if (e.name === 'InvalidStateError') {
              // Recognition is already started, ignore
              return;
            }
            // For other errors, report them
            chrome.runtime.sendMessage({
              type: "TRANSCRIPTION_ERROR",
              error: `Failed to restart recognition: ${e.message}`
            });
          }
        }, 100);
      }
    };

    try {
      recognition.start();
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "TRANSCRIPTION_ERROR",
        error: `Failed to start recognition: ${error.message}`
      });
    }
  }

  function stopTranscription() {
    if (!transcriptionState.isActive) {
      return;
    }

    transcriptionState.isActive = false;

    if (transcriptionState.recognition) {
      try {
        transcriptionState.recognition.stop();
      } catch (error) {
        console.error("Error stopping recognition:", error);
      }
      transcriptionState.recognition = null;
    }

    // Final save before stopping
    if (transcriptionState.accumulatedTranscript.trim()) {
      finalizeTranscriptDocument();
    }

    // Remove visual indicator
    removeTranscriptionIndicator();

    console.log("Transcription stopped");
  }

  function initializeTranscriptDocument() {
    // Initialize the transcript document with metadata
    chrome.runtime.sendMessage({
      type: "INITIALIZE_TRANSCRIPT",
      uid: transcriptionState.uid,
      meetingId: transcriptionState.meetingId,
      startTime: new Date().toISOString()
    });
  }

  function saveTranscriptRealtime() {
    const now = Date.now();
    
    // Throttle saves to avoid too frequent updates
    if (now - transcriptionState.lastSaveTime < transcriptionState.saveInterval) {
      return;
    }
    
    transcriptionState.lastSaveTime = now;

    if (transcriptionState.accumulatedTranscript.trim()) {
      chrome.runtime.sendMessage({
        type: "UPDATE_TRANSCRIPT_REALTIME",
        uid: transcriptionState.uid,
        meetingId: transcriptionState.meetingId,
        transcript: transcriptionState.accumulatedTranscript,
        lastUpdated: new Date().toISOString()
      });
    }
  }

  function finalizeTranscriptDocument() {
    // Final save with completion status
    chrome.runtime.sendMessage({
      type: "FINALIZE_TRANSCRIPT",
      uid: transcriptionState.uid,
      meetingId: transcriptionState.meetingId,
      transcript: transcriptionState.accumulatedTranscript,
      endTime: new Date().toISOString(),
      wordCount: transcriptionState.accumulatedTranscript.trim().split(/\s+/).length
    });
  }

  function addTranscriptionIndicator() {
    // Remove existing indicator if any
    removeTranscriptionIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'friday-transcription-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(220, 53, 69, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 12px;
      font-weight: bold;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      max-width: 300px;
      word-wrap: break-word;
    `;
    indicator.innerHTML = '🎙️ Recording...';
    document.body.appendChild(indicator);
  }

  function updateTranscriptionIndicator(text) {
    const indicator = document.getElementById('friday-transcription-indicator');
    if (indicator && text.trim()) {
      const truncatedText = text.length > 50 ? text.substring(0, 50) + '...' : text;
      indicator.innerHTML = `🎙️ Recording...<br><small style="opacity: 0.8;">${truncatedText}</small>`;
    }
  }

  function removeTranscriptionIndicator() {
    const indicator = document.getElementById('friday-transcription-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  // Clean up when page unloads
  window.addEventListener('beforeunload', () => {
    stopTranscription();
  });

  // Notify background script that content script is ready
  chrome.runtime.sendMessage({
    type: "CONTENT_SCRIPT_READY"
  });

})()