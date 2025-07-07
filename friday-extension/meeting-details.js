chrome.storage.local.get(["selectedMeeting"], (result) => {
  const meeting = result.selectedMeeting;

  if (!meeting) {
    alert("No meeting selected.");
    window.location.href = "dashboard.html";
    return;
  }

  document.getElementById("title").innerText = meeting.meetingTitle;
  document.getElementById("date").innerText = meeting.meetingDate;
  document.getElementById("time").innerText = meeting.meetingTime;
  document.getElementById("link").href = meeting.meetingLink;
  document.getElementById("drive").href = meeting.driveFolderLink;

  const chatBtn = document.getElementById("chatBtn");
  chatBtn.onclick = () => {
    window.location.href = "assistant.html";
  };
});
