const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const meetingTitle = document.getElementById("meetingTitle");
const closeBtn = document.getElementById("closeBtn");

// Load selected meeting info
chrome.storage.local.get(["selectedMeetingForChat"], (result) => {
  const meeting = result.selectedMeetingForChat;

  if (!meeting) {
    alert("No meeting selected. Returning to dashboard.");
    window.location.href = "dashboard.html";
    return;
  }

  // Show meeting info in title
  meetingTitle.textContent = `🤖 AI - ${meeting.meetingDate} @ ${meeting.meetingTime}`;

  // Chat input logic
  chatInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const input = chatInput.value.trim();
      if (!input) return;

      const userDiv = document.createElement("div");
      userDiv.textContent = input;
      userDiv.classList.add("user-msg");
      chatMessages.appendChild(userDiv);

      const aiDiv = document.createElement("div");
      aiDiv.textContent = "Thinking...";
      aiDiv.classList.add("ai-msg");
      chatMessages.appendChild(aiDiv);

      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.value = "";

      // Simulated AI response (replace with real call if needed)
      setTimeout(() => {
        aiDiv.textContent = `AI: You asked "${input}" about the meeting on ${meeting.meetingDate}`;
      }, 1000);
    }
  });
});

// Go back to dashboard
closeBtn.addEventListener("click", () => {
  window.location.href = "dashboard.html";
});
