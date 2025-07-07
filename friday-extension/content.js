// content.js

// Use an IIFE to create a new scope and prevent global variable conflicts
(function() {
    // Check if the script has already been initialized in this context
    // This prevents re-declaration errors if the script is injected multiple times
    if (window.fridayMeetingAssistantContentScriptInitialized) {
        console.log("Friday Meeting Assistant content script already initialized.");
        return;
    }
    window.fridayMeetingAssistantContentScriptInitialized = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;
    let isRecognizing = false;
    let shouldListenContinuously = false; // New flag to control continuous listening

    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      // IMPORTANT: Set continuous to true for longer speech sessions
      recognition.continuous = true;

      recognition.onstart = () => {
        isRecognizing = true;
        chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "listening" });
        console.log("Content script: Recognition started.");
      };

      recognition.onend = () => {
        isRecognizing = false;
        // Check if we should restart only if the user hasn't explicitly told us to stop
        if (shouldListenContinuously) {
            console.log("Content script: Recognition ended, restarting due to continuous mode.");
            try {
                recognition.start(); // Restart recognition
                // Don't send MIC_STATUS idle immediately, as it's restarting
            } catch (e) {
                console.error("Content script: Error restarting recognition:", e);
                // If restart fails, then truly send idle status and stop continuous
                shouldListenContinuously = false;
                chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "idle" });
            }
        } else {
            console.log("Content script: Recognition ended, stopping as per user/system.");
            chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "idle" });
        }
      };

      recognition.onresult = (event) => {
        // Get the latest final result. For continuous, you might get multiple results.
        const transcript = event.results[event.results.length - 1][0].transcript;
        chrome.runtime.sendMessage({ type: "SPEECH_RESULT", transcript: transcript });
        console.log("Content script: Recognition result:", transcript);
      };

      recognition.onerror = (event) => {
        isRecognizing = false;
        shouldListenContinuously = false; // Stop continuous listening on error
        chrome.runtime.sendMessage({ type: "MIC_ERROR", error: event.error });
        console.error("Content script: Speech Recognition Error:", event.error);
      };

      // Listen for messages from the extension's popup/dashboard
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Ensure the message is from your extension and specifically for this content script
        if (message.type === "START_MIC") {
          if (!isRecognizing) {
            try {
              shouldListenContinuously = true; // Set flag to enable continuous listening
              recognition.start();
              sendResponse({ success: true, message: "Recognition started" });
            } catch (e) {
              console.error("Content script: Error starting recognition:", e);
              shouldListenContinuously = false; // Reset flag on start failure
              sendResponse({ success: false, message: e.message });
            }
          } else {
            sendResponse({ success: true, message: "Recognition already active" });
          }
          return true; // Keep the message channel open for sendResponse
        } else if (message.type === "STOP_MIC") {
          if (isRecognizing) {
            shouldListenContinuously = false; // Stop continuous listening
            recognition.stop(); // Explicitly stop
            sendResponse({ success: true, message: "Recognition stopped" });
          } else {
            sendResponse({ success: true, message: "Recognition not active" });
          }
          return true; // Keep the message channel open for sendResponse
        }
      });

    } else {
      console.warn("SpeechRecognition NOT supported in this content script context.");
      chrome.runtime.sendMessage({ type: "MIC_UNSUPPORTED" });
    }
})(); // Immediately Invoked Function Expression