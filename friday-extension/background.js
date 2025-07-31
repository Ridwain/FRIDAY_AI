// background.js
let transcriptionState = {
  isTranscribing: false,
  selectedMeeting: null,
  userUid: null,
  meetTabId: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGIN_SUCCESS") {
    chrome.storage.local.set({
      email: message.email,
      uid: message.uid
    });
    console.log("Stored user:", message.email);
  }
  
  // Handle transcription control messages
  if (message.type === "START_TRANSCRIPTION") {
    startBackgroundTranscription(message.meeting, message.uid)
      .then(() => sendResponse({success: true}))
      .catch(error => sendResponse({success: false, error: error.message}));
    return true; // Keep message channel open for async response
  }
  
  if (message.type === "STOP_TRANSCRIPTION") {
    stopBackgroundTranscription()
      .then(() => sendResponse({success: true}))
      .catch(error => sendResponse({success: false, error: error.message}));
    return true;
  }
  
  if (message.type === "GET_TRANSCRIPTION_STATUS") {
    sendResponse({isTranscribing: transcriptionState.isTranscribing});
  }

  // Handle messages from content script
  if (message.type === "TRANSCRIPTION_RESULT") {
    handleTranscriptionResult(message.transcript, message.isFinal);
  }

  if (message.type === "TRANSCRIPTION_ERROR") {
    broadcastTranscriptionError(message.error);
    stopBackgroundTranscription();
  }

  if (message.type === "CONTENT_SCRIPT_READY") {
    sendResponse({success: true});
  }
  
  // Handle connection from extension pages
  if (message.type === "EXTENSION_PAGE_CONNECTED") {
    // Process any queued transcripts
    processTranscriptQueue();
    sendResponse({success: true});
  }
});

async function startBackgroundTranscription(meeting, uid) {
  if (transcriptionState.isTranscribing) {
    console.log("Transcription already running");
    return;
  }

  transcriptionState.selectedMeeting = meeting;
  transcriptionState.userUid = uid;

  try {
    // Find Google Meet tab
    const tabs = await chrome.tabs.query({ url: "*://meet.google.com/*" });
    
    if (!tabs.length) {
      throw new Error("Please open the Google Meet meeting in a tab.");
    }

    transcriptionState.meetTabId = tabs[0].id;

    // Inject content script to handle speech recognition
    await chrome.scripting.executeScript({
      target: { tabId: transcriptionState.meetTabId },
      files: ['transcription-content.js']
    });

    // Wait a bit for content script to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start transcription in content script
    await chrome.tabs.sendMessage(transcriptionState.meetTabId, {
      type: "START_TRANSCRIPTION",
      meetingId: meeting.meetingId,
      uid: uid
    });

    transcriptionState.isTranscribing = true;
    broadcastTranscriptionStatus("started");
    
  } catch (error) {
    console.error("Failed to start transcription:", error);
    throw error;
  }
}

async function stopBackgroundTranscription() {
  if (!transcriptionState.isTranscribing) {
    return;
  }

  try {
    // Stop transcription in content script
    if (transcriptionState.meetTabId) {
      await chrome.tabs.sendMessage(transcriptionState.meetTabId, {
        type: "STOP_TRANSCRIPTION"
      }).catch(() => {
        // Ignore errors if tab is closed or content script not available
      });
    }
  } catch (error) {
    console.warn("Error stopping transcription:", error);
  }

  transcriptionState.isTranscribing = false;
  transcriptionState.meetTabId = null;
  
  broadcastTranscriptionStatus("stopped");
}

function handleTranscriptionResult(transcript, isFinal) {
  if (isFinal && transcriptionState.selectedMeeting && transcriptionState.userUid) {
    // Save transcript to Firebase
    saveTranscriptToFirebase(
      transcriptionState.userUid,
      transcriptionState.selectedMeeting.meetingId,
      transcript
    );
  }
}

// Queue for storing transcripts when no extension pages are available
let transcriptQueue = [];

async function saveTranscriptToFirebase(uid, meetingId, transcript) {
  try {
    // Try to send to extension pages first
    const messagePromise = chrome.runtime.sendMessage({
      type: "SAVE_TRANSCRIPT_REQUEST",
      uid: uid,
      meetingId: meetingId,
      transcript: transcript
    });

    try {
      await messagePromise;
      console.log("Transcript saved via extension page");
    } catch (error) {
      // No extension pages available, queue the transcript
      console.log("Queueing transcript for later saving");
      transcriptQueue.push({
        uid: uid,
        meetingId: meetingId,
        transcript: transcript,
        timestamp: Date.now()
      });
      
      // Store in chrome.storage as backup
      await storeTranscriptInStorage(uid, meetingId, transcript);
    }
  } catch (error) {
    console.error("Error saving transcript:", error);
    // Fallback to storage
    await storeTranscriptInStorage(uid, meetingId, transcript);
  }
}

async function storeTranscriptInStorage(uid, meetingId, transcript) {
  try {
    const storageKey = `transcript_${uid}_${meetingId}`;
    const existingData = await chrome.storage.local.get(storageKey);
    const currentTranscript = existingData[storageKey] || "";
    
    await chrome.storage.local.set({
      [storageKey]: currentTranscript + transcript + " "
    });
    
    console.log("Transcript stored in chrome.storage as backup");
  } catch (error) {
    console.error("Failed to store transcript in storage:", error);
  }
}

// Process queued transcripts when extension pages become available
function processTranscriptQueue() {
  if (transcriptQueue.length === 0) return;
  
  chrome.runtime.sendMessage({
    type: "PROCESS_TRANSCRIPT_QUEUE",
    queue: transcriptQueue
  }).then(() => {
    console.log(`Processed ${transcriptQueue.length} queued transcripts`);
    transcriptQueue = [];
  }).catch(() => {
    // Still no extension pages available
    console.log("Extension pages still not available for queue processing");
  });
}

function broadcastTranscriptionStatus(status) {
  // Broadcast to all extension pages
  chrome.runtime.sendMessage({
    type: "TRANSCRIPTION_STATUS_UPDATE",
    status: status,
    isTranscribing: transcriptionState.isTranscribing
  }).catch(() => {
    // Ignore errors if no listeners
  });
}

function broadcastTranscriptionError(error) {
  transcriptionState.isTranscribing = false;
  chrome.runtime.sendMessage({
    type: "TRANSCRIPTION_ERROR",
    error: error
  }).catch(() => {
    // Ignore errors if no listeners
  });
}

// Handle tab close/navigation
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === transcriptionState.meetTabId) {
    stopBackgroundTranscription();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === transcriptionState.meetTabId && 
      changeInfo.url && 
      !changeInfo.url.includes("meet.google.com")) {
    stopBackgroundTranscription();
  }
});