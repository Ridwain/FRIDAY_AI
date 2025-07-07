chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGIN_SUCCESS") {
    chrome.storage.local.set({
      email: message.email,
      uid: message.uid
    });
    console.log("Stored user:", message.email);
  }
});