import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";

const isLocalhost = window.location.hostname.includes("localhost") || window.location.hostname === "127.0.0.1";

const firebaseConfig = {
  apiKey: "AIzaSyCQkiNi5bsfoOUxj9HsxDupXR7SmUHGKPI",
  authDomain: isLocalhost
    ? "friday-e65f2.firebaseapp.com"
    : "friday-e65f2.web.app",
  projectId: "friday-e65f2",
  storageBucket: "friday-e65f2.appspot.com",
  messagingSenderId: "837567341884",
  appId: "1:837567341884:web:1c940bd2cfdce899252a39"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const userNameSpan = document.getElementById("user-name");
const userPicImg = document.getElementById("user-pic");
const logoutBtn = document.getElementById("logout-btn");
const meetingForm = document.getElementById("meeting-form");
const meetingsList = document.getElementById("meetings-list");

const dateInput = document.getElementById("meeting-date");
const timeInput = document.getElementById("meeting-time");
const meetingLinkInput = document.getElementById("meeting-link");
const driveFolderInput = document.getElementById("drive-folder-link");

let currentUser = null;
let editingMeetingId = null;

function isValidURL(str) {
  try { new URL(str); return true; } catch { return false; }
}

function extractFolderId(link) {
  const m = link.match(/\/folders\/([\w-]+)/);
  return m ? m[1] : null;
}

// Redirect to login if not logged in, replace history so back button can't go back here
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  currentUser = user;
  userNameSpan.textContent = user.displayName || user.email || "User";
  if (user.photoURL) {
    userPicImg.src = user.photoURL;
    userPicImg.style.display = "inline-block";
  }
  loadMeetings();
});

logoutBtn.addEventListener("click", () => {
  signOut(auth)
    .then(() => {
      window.location.replace("index.html");
    })
    .catch(err => alert("Logout failed"));
});

meetingForm.addEventListener("submit", async e => {
  e.preventDefault();
  const date = dateInput.value;
  const time = timeInput.value;
  const link = meetingLinkInput.value.trim();
  const drive = driveFolderInput.value.trim();

  if (!date || !time || !isValidURL(link) || !isValidURL(drive)) {
    return alert("Please fill all fields with valid URLs.");
  }

  const data = {
    meetingDate: date,
    meetingTime: time,
    meetingLink: link,
    driveFolderLink: drive,
    updatedAt: serverTimestamp(),
  };

  const ref = collection(db, "users", currentUser.uid, "meetings");
  try {
    if (editingMeetingId) {
      await updateDoc(doc(ref, editingMeetingId), data);
      editingMeetingId = null;
      alert("Meeting updated");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(ref, data);
      alert("Meeting created");
    }
    meetingForm.reset();
    resetFormButton();
  } catch (err) {
    console.error(err);
    alert("Failed to save meeting.");
  }
});

function loadMeetings() {
  const ref = collection(db, "users", currentUser.uid, "meetings");
  const q = query(ref, orderBy("meetingDate", "asc"), orderBy("meetingTime", "asc"));

  onSnapshot(q, snap => {
    meetingsList.innerHTML = "";
    if (snap.empty) return meetingsList.innerHTML = "<li>No meetings found.</li>";
    snap.forEach(ds => renderMeeting(ds.id, ds.data()));
  });
}

function renderMeeting(id, data) {
  const folderId = extractFolderId(data.driveFolderLink);
  const fileListId = `file-list-${id}`;

  const li = document.createElement("li");
  li.style.marginBottom = "20px";

  const info = document.createElement("div");
  const when = data.meetingDate && data.meetingTime ? `${data.meetingDate} ${data.meetingTime}` : "Invalid date/time";
  info.innerHTML = `
    <strong>Date & Time:</strong> ${when}<br>
    <strong>Meeting Link:</strong> <a href="${data.meetingLink}" target="_blank">${data.meetingLink}</a><br>
    <strong>Drive Folder:</strong> <a href="${data.driveFolderLink}" target="_blank">${data.driveFolderLink}</a><br><br>`;
  li.appendChild(info);

  const ul = document.createElement("ul");
  ul.id = fileListId;
  ul.style.display = "none";
  li.appendChild(ul);

  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "Show Files";
  let showing = false;
  toggleBtn.addEventListener("click", async () => {
    if (!showing) {
      toggleBtn.textContent = "Hide Files";
      ul.style.display = "block";
      folderNavigationStack[fileListId] = [];
      if (!ul.hasChildNodes()) await showFilesFromDrive(folderId, fileListId);
      showing = true;
    } else {
      toggleBtn.textContent = "Show Files";
      ul.style.display = "none";
      showing = false;
    }
  });
  li.appendChild(toggleBtn);

  const actions = document.createElement("div");
  actions.style.marginTop = "10px";

  const edit = document.createElement("button");
  edit.textContent = "Edit";
  edit.addEventListener("click", () => onEditMeeting(id));
  actions.appendChild(edit);

  const del = document.createElement("button");
  del.textContent = "Delete";
  del.style.marginLeft = "10px";
  del.style.color = "red";
  del.addEventListener("click", () => onDeleteMeeting(id));
  actions.appendChild(del);

  li.appendChild(actions);
  meetingsList.appendChild(li);
}

async function onEditMeeting(id) {
  const ds = await getDoc(doc(db, "users", currentUser.uid, "meetings", id));
  if (!ds.exists()) return alert("Meeting not found.");
  const d = ds.data();
  dateInput.value = d.meetingDate;
  timeInput.value = d.meetingTime;
  meetingLinkInput.value = d.meetingLink;
  driveFolderInput.value = d.driveFolderLink;
  editingMeetingId = id;
  setFormButtonToUpdate();
}

async function onDeleteMeeting(id) {
  if (!confirm("Delete this meeting?")) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "meetings", id));
  alert("Meeting deleted.");
}

function setFormButtonToUpdate() {
  meetingForm.querySelector('button[type="submit"]').textContent = "Update Meeting";
}
function resetFormButton() {
  meetingForm.querySelector('button[type="submit"]').textContent = "Create Meeting Assistance";
}

let gapiInitialized = false;
let tokenClient;
const folderNavigationStack = {};

function initGapiClient() {
  return new Promise((resolve, reject) => {
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey: "AIzaSyCQkiNi5bsfoOUxj9HsxDupXR7SmUHGKPI",
          discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
        });
        gapiInitialized = true;
        resolve();
      } catch (error) {
        console.error("API init error:", error);
        reject(error);
      }
    });
  });
}

function initializeTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: "837567341884-0qp9pv773cmos8favl2po8ibhkkv081s.apps.googleusercontent.com",
    scope: "https://www.googleapis.com/auth/drive.readonly",
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        console.error("Token error:", tokenResponse);
        alert("Authorization failed");
      } else {
        gapi.client.setToken(tokenResponse);
      }
    }
  });
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (token) => {
      if (token.error) {
        reject(token);
      } else {
        resolve(token);
      }
    };
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

async function showFilesFromDrive(folderId, containerId) {
  if (!folderId) return;
  const ul = document.getElementById(containerId);
  ul.innerHTML = "";

  const back = document.createElement("button");
  back.textContent = "⬅ Back";
  back.disabled = !(folderNavigationStack[containerId]?.length);
  back.addEventListener("click", () => {
    if (folderNavigationStack[containerId].length) {
      const prevId = folderNavigationStack[containerId].pop();
      showFilesFromDrive(prevId, containerId);
    }
  });
  ul.appendChild(back);

  const label = document.createElement("strong");
  label.textContent = folderNavigationStack[containerId]?.length ? " Subfolder" : " Root";
  label.style.marginLeft = "10px";
  ul.appendChild(label);

  try {
    if (!gapiInitialized) await initGapiClient();
    if (!tokenClient) initializeTokenClient();
    if (!gapi.client.getToken()) await requestAccessToken();

    const resp = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,webViewLink)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = resp.result.files || [];
    if (!files.length) return ul.appendChild(document.createElement("li")).textContent = "No files found.";

    for (let f of files) {
      const li = document.createElement("li");
      if (f.mimeType === "application/vnd.google-apps.folder") {
        li.innerHTML = `📁 <strong>${f.name}</strong>`;
        li.style.cursor = "pointer";
        li.addEventListener("click", () => {
          folderNavigationStack[containerId] ??= [];
          folderNavigationStack[containerId].push(folderId);
          showFilesFromDrive(f.id, containerId);
        });
      } else {
        li.innerHTML = `<a href="${f.webViewLink}" target="_blank">${f.name}</a>`;
      }
      ul.appendChild(li);
    }
  } catch (err) {
    console.error("Drive API error:", err);
    ul.appendChild(document.createElement("li")).textContent = "Failed to load files.";
  }
}
