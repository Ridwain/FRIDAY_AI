// // content.js

// // Use an IIFE to create a new scope and prevent global variable conflicts
// (function() {
//     // Check if the script has already been initialized in this context
//     if (window.fridayMeetingAssistantContentScriptInitialized) {
//         console.log("Friday Meeting Assistant content script already initialized.");
//         return;
//     }
//     window.fridayMeetingAssistantContentScriptInitialized = true;

//     const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
//     let recognition;
//     let isRecognizing = false;
//     let shouldListenContinuously = false; // Flag to control continuous listening
//     let finalTranscript = ''; // Variable to accumulate the final transcript

//     if (SpeechRecognition) {
//       recognition = new SpeechRecognition();
//       recognition.lang = 'en-US';
//       // Set interimResults to true to get partial results in real-time for display
//       recognition.interimResults = true;
//       recognition.continuous = true; // IMPORTANT: Keep this for longer speech sessions

//       recognition.onstart = () => {
//         isRecognizing = true;
//         finalTranscript = ''; // Clear accumulated transcript on start of a new session
//         chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "listening" });
//         console.log("Content script: Recognition started.");
//       };

//       recognition.onend = () => {
//         isRecognizing = false;
//         // If we are truly stopping (not just a pause in continuous mode, and not already restarting)
//         if (!shouldListenContinuously || !recognition._isRestarting) { // _isRestarting is a conceptual flag, not directly from API.
//                                                                      // The goal is to only send final transcript once the mic is truly off.
//             console.log("Content script: Recognition session truly ended.");
//             if (finalTranscript) {
//                 // Send accumulated transcript if there's any when recognition stops completely
//                 chrome.runtime.sendMessage({ type: "SPEECH_RESULT", transcript: finalTranscript.trim() });
//                 finalTranscript = ''; // Clear after sending
//             }
//             chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "idle" });
//         }

//         // Restart recognition only if we intend to listen continuously and it's not already running
//         if (shouldListenContinuously) {
//             console.log("Content script: Recognition ended, attempting restart due to continuous mode.");
//             try {
//                 recognition._isRestarting = true; // Indicate we are restarting
//                 recognition.start();
//             } catch (e) {
//                 console.error("Content script: Error restarting recognition:", e);
//                 shouldListenContinuously = false; // Stop continuous if restart fails
//                 chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "idle" });
//             } finally {
//                 recognition._isRestarting = false; // Reset the flag
//             }
//         }
//       };

//       recognition.onresult = (event) => {
//         let currentInterimTranscript = '';
//         let currentFinalTranscript = '';

//         for (let i = event.resultIndex; i < event.results.length; ++i) {
//           const transcript = event.results[i][0].transcript;
//           if (event.results[i].isFinal) {
//             currentFinalTranscript += transcript + ' '; // Accumulate final results for current event
//           } else {
//             currentInterimTranscript += transcript; // Accumulate interim results for current event
//           }
//         }

//         // Add the new final portions to our accumulated finalTranscript
//         finalTranscript += currentFinalTranscript;

//         // Send a message with the current state of both final and interim for real-time display
//         // This will update the input box as the user speaks.
//         chrome.runtime.sendMessage({
//             type: "SPEECH_INTERIM",
//             transcript: finalTranscript + currentInterimTranscript
//         });
//         console.log("Content script: Interim/Partial Result (for display):", finalTranscript + currentInterimTranscript);
//       };


//       recognition.onerror = (event) => {
//         isRecognizing = false;
//         shouldListenContinuously = false; // Stop continuous listening on error
//         finalTranscript = ''; // Clear any pending transcript on error
//         chrome.runtime.sendMessage({ type: "MIC_ERROR", error: event.error });
//         chrome.runtime.sendMessage({ type: "MIC_STATUS", status: "idle" }); // Ensure UI updates to idle
//         console.error("Content script: Speech Recognition Error:", event.error);
//       };

//       // Listen for messages from the extension's popup/dashboard
//       chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//         if (message.type === "START_MIC") {
//           if (!isRecognizing) {
//             try {
//               finalTranscript = ''; // Ensure clear on manual start
//               shouldListenContinuously = true;
//               recognition.start();
//               sendResponse({ success: true, message: "Recognition started" });
//             } catch (e) {
//               console.error("Content script: Error starting recognition:", e);
//               shouldListenContinuously = false; // Reset flag on start failure
//               sendResponse({ success: false, message: e.message });
//             }
//           } else {
//             sendResponse({ success: true, message: "Recognition already active" });
//           }
//           return true;
//         } else if (message.type === "STOP_MIC") {
//           if (isRecognizing) {
//             shouldListenContinuously = false; // User explicitly stopped
//             recognition.stop(); // This will trigger onend, which will then send finalTranscript
//             // Do NOT send finalTranscript here directly to avoid duplicates with onend
//             sendResponse({ success: true, message: "Recognition stopped" });
//           } else {
//             sendResponse({ success: true, message: "Recognition not active" });
//           }
//           return true;
//         }
//       });

//     } else {
//       console.warn("SpeechRecognition NOT supported in this content script context.");
//       chrome.runtime.sendMessage({ type: "MIC_UNSUPPORTED" });
//     }
// })();