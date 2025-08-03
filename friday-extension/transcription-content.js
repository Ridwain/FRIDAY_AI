(function() {
  // Configuration constants
  const CONFIG = {
    SAVE_INTERVAL: 2000,
    MAX_TEXT_LENGTH: 50,
    SUPPORTED_LANGUAGES: ['en-US', 'es-ES', 'fr-FR'],
    MAX_RESTART_ATTEMPTS: 5,
    RESTART_DELAY: 1000,
    NO_SPEECH_TIMEOUT: 10000, // 10 seconds
    INDICATOR_STYLES: `
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
    `
  };

  // State management
  let transcriptionState = {
    recognition: null,
    isActive: false,
    accumulatedTranscript: "",
    meetingId: null,
    uid: null,
    lastSaveTime: 0,
    language: CONFIG.SUPPORTED_LANGUAGES[0],
    restartAttempts: 0,
    lastActivity: Date.now(),
    restartTimeout: null,
    noSpeechTimeout: null,
    isRestarting: false
  };

  // Logging utility
  const logger = {
    info: (msg) => console.log(`[Transcription] ${msg}`),
    error: (msg, error) => console.error(`[Transcription] ${msg}`, error),
    warn: (msg) => console.warn(`[Transcription] ${msg}`)
  };

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      switch (message.type) {
        case "START_TRANSCRIPTION":
          startTranscription(message.meetingId, message.uid, message.language);
          sendResponse({ success: true });
          break;
        case "STOP_TRANSCRIPTION":
          stopTranscription();
          sendResponse({ success: true });
          break;
        default:
          logger.warn(`Unknown message type: ${message.type}`);
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      logger.error("Message handling failed:", error);
      sendResponse({ success: false, error: error.message });
    }
  });

  /**
   * Starts speech recognition
   * @param {string} meetingId - Meeting identifier
   * @param {string} uid - User identifier
   * @param {string} [language] - Speech recognition language
   */
  function startTranscription(meetingId, uid, language = CONFIG.SUPPORTED_LANGUAGES[0]) {
    if (transcriptionState.isActive && !transcriptionState.isRestarting) {
      logger.info("Transcription already active");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      sendErrorMessage("Speech Recognition not supported in this browser");
      return;
    }

    try {
      // Initialize state
      Object.assign(transcriptionState, {
        meetingId,
        uid,
        accumulatedTranscript: transcriptionState.isRestarting ? transcriptionState.accumulatedTranscript : "",
        lastSaveTime: 0,
        language,
        lastActivity: Date.now(),
        isRestarting: false
      });

      // Clean up previous recognition if exists
      if (transcriptionState.recognition) {
        try {
          transcriptionState.recognition.stop();
          transcriptionState.recognition = null;
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      transcriptionState.recognition = new SpeechRecognition();
      const recognition = transcriptionState.recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      setupRecognitionEvents(recognition);
      recognition.start();
    } catch (error) {
      sendErrorMessage(`Failed to start recognition: ${error.message}`);
      transcriptionState.isRestarting = false;
    }
  }

  /**
   * Sets up recognition event handlers
   * @param {SpeechRecognition} recognition - Speech recognition instance
   */
  function setupRecognitionEvents(recognition) {
    recognition.onstart = () => {
      transcriptionState.isActive = true;
      transcriptionState.restartAttempts = 0;
      transcriptionState.lastActivity = Date.now();
      logger.info("Speech recognition started");
      
      if (!transcriptionState.isRestarting) {
        initializeTranscriptDocument();
        addTranscriptionIndicator();
      }
      
      // Set up no-speech timeout
      clearTimeout(transcriptionState.noSpeechTimeout);
      transcriptionState.noSpeechTimeout = setTimeout(() => {
        if (transcriptionState.isActive && Date.now() - transcriptionState.lastActivity > CONFIG.NO_SPEECH_TIMEOUT) {
          logger.warn("No speech detected for extended period, restarting...");
          restartRecognition();
        }
      }, CONFIG.NO_SPEECH_TIMEOUT);
    };

    recognition.onresult = (event) => {
      transcriptionState.lastActivity = Date.now();
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

      if (finalTranscript) {
        transcriptionState.accumulatedTranscript += finalTranscript;
        saveTranscriptRealtime();
        transcriptionState.restartAttempts = 0; // Reset on successful speech
      }

      updateTranscriptionIndicator(finalTranscript || interimTranscript);
      
      // Reset no-speech timeout
      clearTimeout(transcriptionState.noSpeechTimeout);
      transcriptionState.noSpeechTimeout = setTimeout(() => {
        if (transcriptionState.isActive && Date.now() - transcriptionState.lastActivity > CONFIG.NO_SPEECH_TIMEOUT) {
          logger.warn("No speech detected for extended period, restarting...");
          restartRecognition();
        }
      }, CONFIG.NO_SPEECH_TIMEOUT);
    };

    recognition.onerror = (event) => {
      logger.error("Speech recognition error:", event.error);
      clearTimeout(transcriptionState.noSpeechTimeout);

      // Handle different error types
      switch (event.error) {
        case 'network':
          logger.warn("Network error, will retry...");
          if (transcriptionState.restartAttempts < CONFIG.MAX_RESTART_ATTEMPTS) {
            setTimeout(() => restartRecognition(), 2000);
          } else {
            sendErrorMessage("Network connectivity issues. Please check your connection and try again.");
            stopTranscription();
          }
          break;
          
        case 'no-speech':
          logger.warn("No speech detected, restarting...");
          if (transcriptionState.restartAttempts < CONFIG.MAX_RESTART_ATTEMPTS) {
            restartRecognition();
          } else {
            logger.warn("Too many no-speech errors, stopping transcription");
            sendErrorMessage("Extended period without speech detected. Transcription stopped.");
            stopTranscription();
          }
          break;
          
        case 'aborted':
          logger.info("Speech recognition was aborted");
          // Don't restart if aborted intentionally
          if (transcriptionState.isActive && !transcriptionState.isRestarting) {
            logger.warn("Unexpected abort, restarting...");
            restartRecognition();
          }
          break;
          
        case 'audio-capture':
          sendErrorMessage("Microphone access denied or not available. Please check your microphone permissions.");
          stopTranscription();
          break;
          
        case 'not-allowed':
          sendErrorMessage("Microphone permission denied. Please allow microphone access and try again.");
          stopTranscription();
          break;
          
        default:
          logger.error(`Unhandled error: ${event.error}`);
          if (transcriptionState.restartAttempts < CONFIG.MAX_RESTART_ATTEMPTS) {
            setTimeout(() => restartRecognition(), 1000);
          } else {
            sendErrorMessage(`Speech recognition error: ${event.error}`);
            stopTranscription();
          }
      }
    };

    recognition.onend = () => {
      logger.info("Speech recognition ended");
      clearTimeout(transcriptionState.noSpeechTimeout);
      
      if (transcriptionState.isActive && !transcriptionState.isRestarting) {
        logger.info("Unexpected end, restarting...");
        restartRecognition();
      }
    };
  }

  /**
   * Restarts speech recognition with exponential backoff
   */
  function restartRecognition() {
    if (!transcriptionState.isActive || transcriptionState.isRestarting) {
      return;
    }

    transcriptionState.isRestarting = true;
    transcriptionState.restartAttempts++;

    logger.info(`Restart attempt ${transcriptionState.restartAttempts}/${CONFIG.MAX_RESTART_ATTEMPTS}`);

    if (transcriptionState.restartAttempts > CONFIG.MAX_RESTART_ATTEMPTS) {
      logger.error("Max restart attempts reached, stopping transcription");
      sendErrorMessage("Transcription failed after multiple attempts. Please try again.");
      stopTranscription();
      return;
    }

    // Clear any existing timeouts
    clearTimeout(transcriptionState.restartTimeout);
    clearTimeout(transcriptionState.noSpeechTimeout);

    // Clean up current recognition
    if (transcriptionState.recognition) {
      try {
        transcriptionState.recognition.stop();
        transcriptionState.recognition = null;
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(CONFIG.RESTART_DELAY * Math.pow(2, transcriptionState.restartAttempts - 1), 16000);
    
    updateTranscriptionIndicator(`Restarting in ${Math.ceil(delay/1000)}s...`);

    transcriptionState.restartTimeout = setTimeout(() => {
      if (transcriptionState.isActive) {
        logger.info("Restarting speech recognition...");
        try {
          startTranscription(
            transcriptionState.meetingId, 
            transcriptionState.uid, 
            transcriptionState.language
          );
        } catch (error) {
          logger.error("Failed to restart recognition:", error);
          sendErrorMessage(`Failed to restart transcription: ${error.message}`);
          stopTranscription();
        }
      }
    }, delay);
  }

  /**
   * Stops transcription and cleans up
   */
  function stopTranscription() {
    if (!transcriptionState.isActive) {
      return;
    }

    try {
      transcriptionState.isActive = false;
      transcriptionState.isRestarting = false;

      // Clear all timeouts
      clearTimeout(transcriptionState.restartTimeout);
      clearTimeout(transcriptionState.noSpeechTimeout);

      if (transcriptionState.recognition) {
        transcriptionState.recognition.stop();
        transcriptionState.recognition = null;
      }

      if (transcriptionState.accumulatedTranscript.trim()) {
        finalizeTranscriptDocument();
      }

      removeTranscriptionIndicator();
      logger.info("Transcription stopped");
    } catch (error) {
      logger.error("Error stopping transcription:", error);
    }
  }

  /**
   * Initializes transcript document
   */
  function initializeTranscriptDocument() {
    try {
      chrome.runtime.sendMessage({
        type: "INITIALIZE_TRANSCRIPT",
        uid: transcriptionState.uid,
        meetingId: transcriptionState.meetingId,
        startTime: new Date().toISOString(),
        language: transcriptionState.language
      });
    } catch (error) {
      logger.error("Failed to initialize transcript:", error);
    }
  }

  /**
   * Saves transcript in real-time with throttling
   */
  function saveTranscriptRealtime() {
    const now = Date.now();
    if (now - transcriptionState.lastSaveTime < CONFIG.SAVE_INTERVAL) {
      return;
    }

    transcriptionState.lastSaveTime = now;

    if (transcriptionState.accumulatedTranscript.trim()) {
      try {
        chrome.runtime.sendMessage({
          type: "UPDATE_TRANSCRIPT_REALTIME",
          uid: transcriptionState.uid,
          meetingId: transcriptionState.meetingId,
          transcript: transcriptionState.accumulatedTranscript,
          lastUpdated: new Date().toISOString(),
          language: transcriptionState.language
        });
      } catch (error) {
        logger.error("Failed to save transcript:", error);
      }
    }
  }

  /**
   * Finalizes transcript document
   */
  function finalizeTranscriptDocument() {
    try {
      chrome.runtime.sendMessage({
        type: "FINALIZE_TRANSCRIPT",
        uid: transcriptionState.uid,
        meetingId: transcriptionState.meetingId,
        transcript: transcriptionState.accumulatedTranscript,
        endTime: new Date().toISOString(),
        wordCount: transcriptionState.accumulatedTranscript.trim().split(/\s+/).length,
        language: transcriptionState.language
      });
    } catch (error) {
      logger.error("Failed to finalize transcript:", error);
    }
  }

  /**
   * Adds visual transcription indicator
   */
  function addTranscriptionIndicator() {
    removeTranscriptionIndicator();
    const indicator = document.createElement('div');
    indicator.id = 'friday-transcription-indicator';
    indicator.style.cssText = CONFIG.INDICATOR_STYLES;
    indicator.innerHTML = '🎙️ Recording...';
    document.body.appendChild(indicator);
  }

  /**
   * Updates transcription indicator with current text
   * @param {string} text - Current transcript text
   */
  function updateTranscriptionIndicator(text) {
    const indicator = document.getElementById('friday-transcription-indicator');
    if (indicator && text.trim()) {
      const truncatedText = text.length > CONFIG.MAX_TEXT_LENGTH 
        ? text.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...' 
        : text;
      
      const statusIcon = transcriptionState.isRestarting ? '🔄' : '🎙️';
      const statusText = transcriptionState.isRestarting ? 'Restarting...' : 'Recording...';
      
      indicator.innerHTML = `${statusIcon} ${statusText}<br><small style="opacity: 0.8;">${truncatedText}</small>`;
    }
  }

  /**
   * Removes transcription indicator
   */
  function removeTranscriptionIndicator() {
    const indicator = document.getElementById('friday-transcription-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * Sends error message to background script
   * @param {string} error - Error message
   */
  function sendErrorMessage(error) {
    try {
      chrome.runtime.sendMessage({
        type: "TRANSCRIPTION_ERROR",
        error
      });
    } catch (e) {
      logger.error("Failed to send error message:", e);
    }
  }

  /**
   * Cleans up resources
   */
  function cleanup() {
    stopTranscription();
    clearTimeout(transcriptionState.restartTimeout);
    clearTimeout(transcriptionState.noSpeechTimeout);
    transcriptionState = {
      recognition: null,
      isActive: false,
      accumulatedTranscript: "",
      meetingId: null,
      uid: null,
      lastSaveTime: 0,
      language: CONFIG.SUPPORTED_LANGUAGES[0],
      restartAttempts: 0,
      lastActivity: Date.now(),
      restartTimeout: null,
      noSpeechTimeout: null,
      isRestarting: false
    };
  }

  // Event listeners
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('unload', cleanup);

  // Notify background script that content script is ready
  try {
    chrome.runtime.sendMessage({
      type: "CONTENT_SCRIPT_READY"
    });
  } catch (error) {
    logger.error("Failed to send ready message:", error);
  }
})();