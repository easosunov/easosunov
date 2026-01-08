// ==================== IMPORT MODULES ====================
console.log('=== WEBRTC APP STARTING ===');

import { 
  initializeApp,
  getFirestore, doc, collection, addDoc, setDoc, getDoc, updateDoc,
  onSnapshot, getDocs, query, where, limit, orderBy, serverTimestamp,
  documentId, deleteDoc,
  getMessaging, getToken, deleteToken,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, inMemoryPersistence
} from './modules.js';

// ==================== GLOBAL DECLARATIONS ====================
console.log("APP VERSION:", "2026-01-08-clean");

// ==================== STATE VARIABLES ====================
let isAuthed = false;
let myUid = null;
let myDisplayName = "";
let allUsersCache = [];
let localStream = null;
let pc = null;
let audioCtx = null;
let ringOsc = null;
let ringGain = null;
let ringTimer = null;
let ringbackTimer = null;
let incomingCallsUnsubscribe = null;
let roomCallsUnsubscribe = null;

// ==================== SIMPLE LOGGING ====================
function logDiag(msg){
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
}

// ==================== DOM ELEMENT REFERENCES ====================
const errorBox = document.getElementById("errorBox");
const loginOverlay = document.getElementById("loginOverlay");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");
const emailInput = document.getElementById("emailInput");
const passInput = document.getElementById("passInput");
const appRoot = document.getElementById("app");

// Initialize other DOM elements later, after page loads
let localVideo, remoteVideo, startBtn, createBtn, joinBtn, copyLinkBtn, roomIdInput, mediaStatus, callStatus;
let diagBtn, diagBox, copyDiagBtn, clearDiagBtn;
let incomingOverlay, incomingText, answerBtn, declineBtn;
let myNameInput, saveNameBtn, refreshUsersBtn, myNameStatus, userSearchInput, usersList, dirCallStatus;
let pushStatus, testSoundBtn, hangupBtn, resetPushBtn, callNoteInput;
let videoQualitySelect, videoQualityStatus;
let startBgBtn, stopBgBtn, bgStatus;

// ==================== INITIALIZE DOM ELEMENTS ====================
function initializeDomElements() {
  localVideo = document.getElementById("localVideo");
  remoteVideo = document.getElementById("remoteVideo");
  startBtn = document.getElementById("startBtn");
  createBtn = document.getElementById("createBtn");
  joinBtn = document.getElementById("joinBtn");
  copyLinkBtn = document.getElementById("copyLinkBtn");
  roomIdInput = document.getElementById("roomId");
  mediaStatus = document.getElementById("mediaStatus");
  callStatus = document.getElementById("callStatus");
  
  diagBtn = document.getElementById("diagBtn");
  diagBox = document.getElementById("diagBox");
  copyDiagBtn = document.getElementById("copyDiagBtn");
  clearDiagBtn = document.getElementById("clearDiagBtn");
  
  incomingOverlay = document.getElementById("incomingOverlay");
  incomingText = document.getElementById("incomingText");
  answerBtn = document.getElementById("answerBtn");
  declineBtn = document.getElementById("declineBtn");
  
  myNameInput = document.getElementById("myNameInput");
  saveNameBtn = document.getElementById("saveNameBtn");
  refreshUsersBtn = document.getElementById("refreshUsersBtn");
  myNameStatus = document.getElementById("myNameStatus");
  userSearchInput = document.getElementById("userSearchInput");
  usersList = document.getElementById("usersList");
  dirCallStatus = document.getElementById("dirCallStatus");
  
  pushStatus = document.getElementById("pushStatus");
  testSoundBtn = document.getElementById("testSoundBtn");
  hangupBtn = document.getElementById("hangupBtn");
  resetPushBtn = document.getElementById("resetPushBtn");
  callNoteInput = document.getElementById("callNoteInput");
  
  videoQualitySelect = document.getElementById("videoQualitySelect");
  videoQualityStatus = document.getElementById("videoQualityStatus");
  
  startBgBtn = document.getElementById('startBgBtn');
  stopBgBtn = document.getElementById('stopBgBtn');
  bgStatus = document.getElementById('bgStatus');
  
  setupEventListeners();
}

// ==================== SETUP EVENT LISTENERS ====================
function setupEventListeners() {
  if (startBtn) startBtn.onclick = async () => {
    try{
      hideErrorBox();
      await startMedia();
    }catch(e){
      showError(e);
    }
  };
  
  if (createBtn) createBtn.onclick = () => createRoom().catch(showError);
  if (joinBtn) joinBtn.onclick = () => joinRoom().catch(showError);
  
  if (copyLinkBtn) copyLinkBtn.onclick = async () => {
    const roomId = roomIdInput?.value.trim();
    if (!roomId) {
      setStatus(callStatus, "No room ID to copy");
      return;
    }
    
    const inviteUrl = `${window.location.origin}${window.location.pathname}#${roomId}`;
    const success = await copyTextRobust(inviteUrl);
    
    if (success) {
      setStatus(callStatus, "✅ Invite link copied!");
      logDiag(`Copied invite: ${inviteUrl}`);
      
      setTimeout(() => {
        setStatus(callStatus, `Room: ${roomId}`);
      }, 2000);
    } else {
      setStatus(callStatus, "⚠️ Could not copy automatically");
    }
  };
  
  if (roomIdInput) {
    roomIdInput.addEventListener("input", () => refreshCopyInviteState());
  }
  
  if (testSoundBtn) {
  testSoundBtn.onclick = async () => {
    await unlockAudio();
    startRingtone();
    setTimeout(() => stopRingtone(), 1800);
  };
}
  
  if (hangupBtn) hangupBtn.onclick = () => hangup().catch(showError);
  if (saveNameBtn) saveNameBtn.onclick = () => saveMyName().catch(showError);
  if (refreshUsersBtn) refreshUsersBtn.onclick = () => loadAllAllowedUsers().catch(showError);
  
  if (myNameInput) myNameInput.addEventListener("input", () => {
    if (saveNameBtn) saveNameBtn.disabled = !isAuthed || !String(myNameInput.value||"").trim();
  });
  
  if (userSearchInput) {
    userSearchInput.addEventListener("input", () => renderUsersList(userSearchInput.value));
  }
  if (videoQualitySelect) {
  videoQualitySelect.addEventListener("change", () => {
    const v = String(videoQualitySelect.value || "medium");
    selectedVideoQuality = VIDEO_PROFILES[v] ? v : "medium";
    updateVideoQualityUi();
    
    if (localStream) {
      applyVideoQualityToCurrentStream(selectedVideoQuality);
    }
  });
}
  // Initialize diagnostics buttons if they exist
  initializeDiagnostics();
}

// ==================== UTILITY FUNCTIONS ====================
const setStatus = (el, msg) => {
  if (el) el.textContent = msg;
};

function showError(e){
  const code = e?.code ? `\ncode: ${e.code}` : "";
  const msg  = e?.message ? `\nmessage: ${e.message}` : "";
  if (errorBox) {
    errorBox.style.display = "block";
    errorBox.textContent = `${String(e?.stack || "")}${code}${msg}`.trim() || String(e);
  }
  logDiag("ERROR: " + String(e?.code || "") + " :: " + String(e?.message || e));
}

function hideErrorBox(){
  if (errorBox) {
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }
}
// ==================== AUDIO FUNCTIONS ====================
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

async function unlockAudio() {
  try {
    const ctx = ensureAudio();
    if (ctx.state !== "running") await ctx.resume();
  } catch (e) {
    logDiag("Audio unlock error: " + e.message);
  }
}

function startRingtone() {
  stopRingtone();
  
  try {
    const ctx = ensureAudio();
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    
    ringGain = ctx.createGain();
    ringGain.gain.value = 0.10;
    ringGain.connect(ctx.destination);

    ringOsc = ctx.createOscillator();
    ringOsc.type = "sine";
    ringOsc.frequency.value = 880;
    ringOsc.connect(ringGain);
    ringOsc.start();

    let on = true;
    ringTimer = setInterval(() => {
      if (!ringGain) return;
      ringGain.gain.value = on ? 0.10 : 0.0001;
      on = !on;
    }, 450);

    logDiag("Ringtone started.");
  } catch (e) {
    logDiag("Ringtone failed: " + e.message);
  }
}

function stopRingtone() {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  
  try { if (ringOsc) ringOsc.stop(); } catch {}
  try { if (ringOsc) ringOsc.disconnect(); } catch {}
  try { if (ringGain) ringGain.disconnect(); } catch {}
  
  ringOsc = null;
  ringGain = null;
}

function startRingback() {
  stopRingback();
  logDiag("Ringback started");
  
  // Simple beep pattern for ringback
  ringbackTimer = setInterval(() => {
    startRingtone();
    setTimeout(() => stopRingtone(), 500);
  }, 2000);
}

function stopRingback() {
  if (ringbackTimer) {
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
  stopRingtone();
}
// ==================== FIREBASE INITIALIZATION ====================
const app = initializeApp({
  apiKey: "AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain: "easosunov-webrtc.firebaseapp.com",
  projectId: "easosunov-webrtc",
  storageBucket: "easosunov-webrtc.firebasestorage.app",
  messagingSenderId: "100169991412",
  appId: "1:100169991412:web:27ef6820f9a59add6b4aa1"
});

const db = getFirestore(app);
const auth = getAuth(app);

// ==================== AUTH PERSISTENCE ====================
(async function initializeAuth() {
  try {
    await setPersistence(auth, inMemoryPersistence);
    logDiag("Auth persistence set to inMemory");
  } catch (error) {
    logDiag(`Auth initialization error: ${error.message}`);
  }
})();

// ==================== ALLOWLIST ENFORCEMENT ====================
async function enforceAllowlist(user){
  const uid = user.uid;
  logDiag("Allowlist check uid=" + uid);

  try{
    const ref = doc(db, "allowlistUids", uid);
    const snap = await getDoc(ref);

    if(!snap.exists()){
      if (loginStatus) loginStatus.textContent = "Not approved yet. Your UID: " + uid;
      try{ await signOut(auth); }catch{}
      throw new Error("Allowlist missing for UID: " + uid);
    }

    const enabled = snap.data()?.enabled === true;
    if(!enabled){
      if (loginStatus) loginStatus.textContent = "Not approved yet (enabled=false). Your UID: " + uid;
      try{ await signOut(auth); }catch{}
      throw new Error("Allowlist disabled for UID: " + uid);
    }

    return true;
  }catch(e){
    if(String(e?.code || "").includes("permission-denied")){
      if (loginStatus) loginStatus.textContent = "Allowlist check blocked by Firestore rules (permission-denied).";
    }
    throw e;
  }
}

// ==================== AUTHENTICATION FUNCTIONS ====================
function requireAuthOrPrompt(){
  if (isAuthed) return true;
  if (loginOverlay) loginOverlay.style.display = "flex";
  if (appRoot) appRoot.classList.add("locked");
  if (loginStatus) loginStatus.textContent = "Please sign in first.";
  return false;
}

if (loginBtn) {
  loginBtn.onclick = async () => {
    hideErrorBox();
    if (loginStatus) loginStatus.textContent = "Signing in…";
    
    try {
      const email = emailInput.value.trim();
      const password = passInput.value;
      
      if (!email || !password) {
        throw new Error("Please enter email and password");
      }
      
      // Sign in
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      if (loginStatus) loginStatus.textContent = "Signed in. Checking allowlist…";
      logDiag(`User signed in: ${user.email}, UID: ${user.uid}`);

    } catch (e) {
      if (loginStatus) loginStatus.textContent = `Login failed: ${e?.code || "unknown"}`;
      logDiag(`Login error: ${e?.code} - ${e?.message}`);
      console.error("Login error details:", e);
      showError(e);
    }
  };
}

if (logoutBtn) {
  logoutBtn.onclick = async () => {
    try{
      stopAll();
      await signOut(auth);
    }catch(e){
      showError(e);
    }
  };
}

// ==================== AUTH STATE LISTENER ====================
onAuthStateChanged(auth, async (user)=>{
  isAuthed = !!user;
  myUid = user?.uid || null;
  logDiag(isAuthed ? "Auth: signed in" : "Auth: signed out");

  if (isAuthed){
    try{ 
      await enforceAllowlist(user); 
    } catch(e){
      showError(e);
      if (loginOverlay) loginOverlay.style.display = "flex";
      if (appRoot) appRoot.classList.add("locked");
      if (logoutBtn) logoutBtn.style.display = "none";
      if (startBtn) startBtn.disabled = true;
      return;
    }

    if (loginOverlay) loginOverlay.style.display = "none";
    if (appRoot) appRoot.classList.remove("locked");
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (loginStatus) loginStatus.textContent = "Signed in.";

    if (startBtn) startBtn.disabled = false;
    setStatus(mediaStatus, "Ready. Click Start to enable camera/mic.");

    if (videoQualitySelect) videoQualitySelect.disabled = false;
    updateVideoQualityUi();

    if (testSoundBtn) testSoundBtn.disabled = false;
    if (saveNameBtn) saveNameBtn.disabled = !String(myNameInput?.value||"").trim();
    if (refreshUsersBtn) refreshUsersBtn.disabled = false;
    if (hangupBtn) hangupBtn.disabled = true;

    refreshCopyInviteState();

    try{ await ensureMyUserProfile(user); } catch(e){ logDiag("ensureMyUserProfile failed: " + (e?.message || e)); }
    try{ await loadAllAllowedUsers(); } catch(e){ logDiag("loadAllAllowedUsers failed: " + (e?.message || e)); }

  } else {
    if (loginOverlay) loginOverlay.style.display = "flex";
    if (appRoot) appRoot.classList.add("locked");
    if (logoutBtn) logoutBtn.style.display = "none";
    stopAll();

    if (videoQualitySelect) videoQualitySelect.disabled = true;
    if (testSoundBtn) testSoundBtn.disabled = true;
    if (saveNameBtn) saveNameBtn.disabled = true;
    if (refreshUsersBtn) refreshUsersBtn.disabled = true;

    setStatus(dirCallStatus, "Idle.");
    if (myNameStatus) myNameStatus.textContent = "Not set.";

    if (usersList) usersList.innerHTML = "";
    allUsersCache = [];
    myDisplayName = "";
  }
});

// ==================== BASIC FUNCTIONS ====================
// Add these core functions that are needed for login to work
function refreshCopyInviteState(){
  if (!copyLinkBtn || !roomIdInput) return;
  
  const hasRoomId = !!roomIdInput.value.trim();
  const canCopy = isAuthed && hasRoomId;
  
  copyLinkBtn.disabled = !canCopy;
  
  logDiag(`refreshCopyInviteState: auth=${isAuthed}, hasRoomId=${hasRoomId}, disabled=${copyLinkBtn.disabled}`);
}

function stopAll(){
  // Stop local media
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  // Clear video elements
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  
  // Update UI buttons
  if (startBtn) startBtn.disabled = !isAuthed;
  if (createBtn) createBtn.disabled = true;
  if (joinBtn) joinBtn.disabled = true;
  if (hangupBtn) hangupBtn.disabled = true;
  
  // Update status
  setStatus(mediaStatus, "Not started.");
  setStatus(callStatus, "No room yet.");
  setStatus(dirCallStatus, "Idle.");
  
  refreshCopyInviteState();
  
  logDiag("All stopped and cleaned up");
}

// ==================== INITIALIZATION ====================
// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDomElements);
} else {
  initializeDomElements();
}

// Initialize UI
updateVideoQualityUi();
// Unlock audio on first click
window.addEventListener("click", unlockAudio, { once: true });
// ==================== MINIMAL VERSION - ADD FUNCTIONS GRADUALLY ====================

// Add this placeholder for updateVideoQualityUi
function updateVideoQualityUi(){
  if (videoQualitySelect) {
    videoQualitySelect.value = "medium";
  }
  if (videoQualityStatus) {
    videoQualityStatus.textContent = "Video: Medium (720p).";
  }
}

// Add placeholder for other required functions
// ==================== MEDIA FUNCTIONS ====================
const VIDEO_PROFILES = {
  low:    { label: "Low (360p)",    constraints: { width:{ideal:640},  height:{ideal:360},  frameRate:{ideal:15, max:15} } },
  medium: { label: "Medium (720p)", constraints: { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30, max:30} } },
  high:   { label: "High (1080p)",  constraints: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30, max:30} } },
};

let selectedVideoQuality = "medium";

function updateVideoQualityUi(){
  if (videoQualitySelect) {
    videoQualitySelect.value = selectedVideoQuality;
  }
  const label = VIDEO_PROFILES[selectedVideoQuality]?.label || "Medium (720p)";
  if (videoQualityStatus) {
    videoQualityStatus.textContent = `Video: ${label}.`;
  }
}

// Add video quality change listener
if (videoQualitySelect) {
  videoQualitySelect.addEventListener("change", () => {
    const v = String(videoQualitySelect.value || "medium");
    selectedVideoQuality = VIDEO_PROFILES[v] ? v : "medium";
    updateVideoQualityUi();
    
    // Apply quality to current stream if it's running
    if (localStream) {
      applyVideoQualityToCurrentStream(selectedVideoQuality);
    }
  });
}

async function applyVideoQualityToCurrentStream(quality) {
  const profile = VIDEO_PROFILES[quality] || VIDEO_PROFILES.medium;
  const vTrack = localStream?.getVideoTracks?.()[0];
  if (!vTrack) return;
  
  try {
    await vTrack.applyConstraints(profile.constraints);
    const s = vTrack.getSettings ? vTrack.getSettings() : {};
    logDiag(`Video quality applied: ${quality} (${s.width}x${s.height} @ ${s.frameRate}fps)`);
  } catch (e) {
    logDiag("applyConstraints error: " + e.message);
  }
}

async function startMedia() {
  if (!requireAuthOrPrompt()) return;

  if (localStream) {
    logDiag("Media already started");
    return;
  }

  hideErrorBox();
  setStatus(mediaStatus, "Requesting camera/mic…");

  const profile = VIDEO_PROFILES[selectedVideoQuality] || VIDEO_PROFILES.medium;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: profile.constraints,
      audio: true
    });

    if (localVideo) {
      localVideo.srcObject = localStream;
      
      // Wait for video to load
      localVideo.onloadedmetadata = async () => {
        try {
          await localVideo.play();
          setStatus(mediaStatus, "Camera/mic started.");
          logDiag("Local video playing.");
        } catch (e) {
          logDiag("Video play error: " + e.message);
        }
      };
    }

    // Enable buttons
    if (startBtn) startBtn.disabled = true;
    if (createBtn) createBtn.disabled = false;
    if (joinBtn) joinBtn.disabled = false;

    logDiag("Media started successfully");

  } catch (e) {
    setStatus(mediaStatus, "Failed to start media: " + e.name);
    logDiag("getUserMedia error: " + e.message);
    
    // Reset state on error
    localStream = null;
    if (startBtn) startBtn.disabled = false;
    if (createBtn) createBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = true;
    
    throw e;
  }
}

async function createRoom(){
  if(!requireAuthOrPrompt()) return;
  alert("Create room functionality not yet implemented");
}

async function joinRoom(){
  if(!requireAuthOrPrompt()) return;
  alert("Join room functionality not yet implemented");
}

async function copyTextRobust(text){
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("Clipboard write failed:", e);
    return false;
  }
}

async function unlockAudio(){
  // Placeholder
}

function startRingtone(){
  // Placeholder
}

function stopRingtone(){
  // Placeholder
}

function hangup() {
  stopRingtone();
  stopRingback();
  stopAll();
  setStatus(dirCallStatus, "Call ended.");
  logDiag("Call hung up");
}

async function ensureMyUserProfile(user){
  // Placeholder
  myDisplayName = user.email.split("@")[0];
  if (myNameInput) myNameInput.value = myDisplayName;
  if (myNameStatus) myNameStatus.textContent = `Name: ${myDisplayName}`;
}

async function saveMyName(){
  if(!requireAuthOrPrompt()) return;
  alert("Save name functionality not yet implemented");
}

async function loadAllAllowedUsers(){
  if(!requireAuthOrPrompt()) return;
  // Placeholder
}

function renderUsersList(filterText = ""){
  if(!usersList) return;
  usersList.innerHTML = '<div class="small" style="color:#777">User list functionality not yet implemented</div>';
}

function initializeDiagnostics(){
  // Initialize diagnostics if buttons exist
  if (diagBtn && diagBox && copyDiagBtn && clearDiagBtn) {
    let diagVisible = false;
    const diagLog = [];
    
    diagBtn.onclick = () => {
      diagVisible = !diagVisible;
      diagBox.style.display = diagVisible ? "block" : "none";
      diagBtn.textContent = diagVisible ? "Hide diagnostics" : "Diagnostics";
      if (diagVisible) {
        diagBox.textContent = diagLog.join("\n");
        diagBox.scrollTop = diagBox.scrollHeight;
      }
    };
    
    clearDiagBtn.onclick = () => {
      diagLog.length = 0;
      if (diagVisible) diagBox.textContent = "";
      copyDiagBtn.disabled = true;
      clearDiagBtn.disabled = true;
      logDiag("Diagnostics cleared.");
    };
    
    copyDiagBtn.onclick = async () => {
      const text = diagLog.join("\n");
      if (!text) return;
      try{
        await navigator.clipboard.writeText(text);
        logDiag("Copied diagnostics to clipboard.");
      }catch{
        window.prompt("Copy diagnostics:", text);
      }
    };
    
    // Replace logDiag with enhanced version
    const originalLogDiag = logDiag;
    logDiag = function(msg){
      originalLogDiag(msg);
      diagLog.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
      if (diagVisible && diagBox) {
        diagBox.textContent = diagLog.join("\n");
        diagBox.scrollTop = diagBox.scrollHeight;
      }
      if (copyDiagBtn) copyDiagBtn.disabled = diagLog.length === 0;
      if (clearDiagBtn) clearDiagBtn.disabled = diagLog.length === 0;
    };
  }
}

console.log("WebRTC app initialization complete");
console.log("Firebase app:", app.name);
console.log("Ready for login...");
