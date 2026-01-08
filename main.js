// ==================== IMPORT MODULES ====================
console.log('=== WEBRTC APP STARTING ===');

import { 
  initializeApp,
  getFirestore, doc, collection, addDoc, setDoc, getDoc, updateDoc,
  onSnapshot, getDocs, writeBatch, query, where, limit, orderBy, serverTimestamp,
  documentId, deleteDoc,
  getMessaging, getToken, onMessage, deleteToken,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, inMemoryPersistence
} from './modules.js';

// ==================== GLOBAL DECLARATIONS ====================
console.log("APP VERSION:", "2026-01-08-fixed-login");

// ==================== NOTIFICATION HANDLING ====================
let webPageShowedNotification = false;

// Handle notification redirects from background app
(function handleNotificationRedirect() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const callId = urlParams.get('callId');
    const roomId = urlParams.get('roomId');
    const fromName = urlParams.get('fromName');
    const toName = urlParams.get('toName');
    const note = urlParams.get('note');
    
    if (callId && roomId) {
      localStorage.setItem('pendingNotificationCall', JSON.stringify({
        callId: callId,
        roomId: roomId,
        fromName: fromName || 'Unknown',
        toName: toName || '',
        note: note || '',
        timestamp: Date.now()
      }));
      
      const cleanUrl = window.location.origin + window.location.pathname;
      if (window.location.hash) {
        window.history.replaceState({}, document.title, cleanUrl + window.location.hash);
      } else {
        window.history.replaceState({}, document.title, cleanUrl);
      }
      
      console.log('Notification stored, waiting for auth...');
    }
  } catch (e) {
    console.warn('Notification redirect handler error:', e);
  }
})();

// ==================== SERVICE WORKER BOOTSTRAP ====================
let swBootstrapReg = null;

// Don't auto-run service worker - it's breaking login
async function ensureServiceWorkerInstalled() {
  console.log("Service worker initialization DELAYED until after login");
  return null;
}

// ==================== CONFIGURATION ====================
const NOTIFY_CALL_URL = "https://us-central1-easosunov-webrtc.cloudfunctions.net/sendTestPush";
const PUBLIC_VAPID_KEY = "BCR4B8uf0WzUuzHKlBCJO22NNnnupe88j8wkjrTwwQALDpWUeJ3umtIkNJTrLb0I_LeIeu2HyBNbogHc6Y7jNzM";

function cleanVapidKey(k){
  return String(k || "").trim().replace(/[\r\n\s]/g, "");
}
const VAPID = cleanVapidKey(PUBLIC_VAPID_KEY);

// ==================== DOM ELEMENT REFERENCES ====================
const errorBox = document.getElementById("errorBox");

const loginOverlay = document.getElementById("loginOverlay");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");
const emailInput = document.getElementById("emailInput");
const passInput = document.getElementById("passInput");
const appRoot = document.getElementById("app");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const startBtn = document.getElementById("startBtn");
const createBtn = document.getElementById("createBtn");
const joinBtn  = document.getElementById("joinBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const roomIdInput = document.getElementById("roomId");
const mediaStatus = document.getElementById("mediaStatus");
const callStatus  = document.getElementById("callStatus");

const diagBtn = document.getElementById("diagBtn");
const diagBox = document.getElementById("diagBox");
const copyDiagBtn = document.getElementById("copyDiagBtn");
const clearDiagBtn = document.getElementById("clearDiagBtn");

const incomingOverlay = document.getElementById("incomingOverlay");
const incomingText = document.getElementById("incomingText");
const answerBtn = document.getElementById("answerBtn");
const declineBtn = document.getElementById("declineBtn");

const myNameInput = document.getElementById("myNameInput");
const saveNameBtn = document.getElementById("saveNameBtn");
const refreshUsersBtn = document.getElementById("refreshUsersBtn");
const myNameStatus = document.getElementById("myNameStatus");
const userSearchInput = document.getElementById("userSearchInput");
const usersList = document.getElementById("usersList");
const dirCallStatus = document.getElementById("dirCallStatus");

const pushStatus = document.getElementById("pushStatus");
const testSoundBtn = document.getElementById("testSoundBtn");
const hangupBtn = document.getElementById("hangupBtn");
const resetPushBtn = document.getElementById("resetPushBtn");
const callNoteInput = document.getElementById("callNoteInput");

const videoQualitySelect = document.getElementById("videoQualitySelect");
const videoQualityStatus = document.getElementById("videoQualityStatus");

const startBgBtn = document.getElementById('startBgBtn');
const stopBgBtn = document.getElementById('stopBgBtn');
const bgStatus = document.getElementById('bgStatus');
const downloadBgLink = document.getElementById('downloadBgLink');

// ==================== STATE VARIABLES ====================
let isAuthed = false;
let myUid = null;
let pendingIncomingCallWhileLoggedOut = null;

const setStatus = (el,msg) => el.textContent = msg;

// ==================== BACKGROUND SERVICE FUNCTIONS ====================
async function checkBackgroundService() {
  try {
    const response = await fetch('http://localhost:3000/status', { 
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    return data;
  } catch (error) {
    return { isRunning: false, uid: null };
  }
}

async function startBackgroundService() {
  if (!isAuthed || !myUid) {
    alert('Please sign in first');
    return;
  }
  
  try {
    bgStatus.textContent = 'Connecting to background service...';
    
    const response = await fetch('http://localhost:3000/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: myUid
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      bgStatus.textContent = '✅ Background service active';
      startBgBtn.disabled = true;
      stopBgBtn.disabled = false;
      logDiag('Background service started for UID: ' + myUid);
    } else {
      throw new Error(data.error || 'Failed to start');
    }
  } catch (error) {
    bgStatus.textContent = '❌ Failed to connect';
    logDiag('Background service error: ' + error.message);
    
    if (error.message.includes('fetch') || error.message.includes('network')) {
      alert('Background app is not running. Please:\n1. Make sure webrtc-notifier.exe is running\n2. Check system tray for the icon\n3. Try starting it manually from the webrtc-notifier-win32-x64 folder');
    }
  }
}

async function stopBackgroundService() {
  try {
    const response = await fetch('http://localhost:3000/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      bgStatus.textContent = 'Background service stopped';
      startBgBtn.disabled = false;
      stopBgBtn.disabled = true;
      logDiag('Background service stopped');
    }
  } catch (error) {
    logDiag('Error stopping background service: ' + error.message);
  }
}

async function updateServiceStatus() {
  if (isAuthed) {
    startBgBtn.disabled = false;
    
    try {
      const status = await checkBackgroundService();
      if (status.isRunning && status.uid === myUid) {
        bgStatus.textContent = '✅ Background service active';
        startBgBtn.disabled = true;
        stopBgBtn.disabled = false;
      } else {
        bgStatus.textContent = 'Background service ready';
        stopBgBtn.disabled = true;
      }
    } catch (error) {
      bgStatus.textContent = 'Background app not detected';
      stopBgBtn.disabled = true;
    }
  } else {
    startBgBtn.disabled = true;
    stopBgBtn.disabled = true;
    bgStatus.textContent = 'Sign in required';
  }
}

// ==================== DIAGNOSTICS SYSTEM ====================
let diagVisible = false;
const diagLog = [];

function logDiag(msg){
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  diagLog.push(line);
  console.log(line);
  if (diagVisible) {
    diagBox.textContent = diagLog.join("\n");
    diagBox.scrollTop = diagBox.scrollHeight;
  }
  copyDiagBtn.disabled = diagLog.length === 0;
  clearDiagBtn.disabled = diagLog.length === 0;
}

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

// ==================== ERROR HANDLING ====================
function showError(e){
  const code = e?.code ? `\ncode: ${e.code}` : "";
  const msg  = e?.message ? `\nmessage: ${e.message}` : "";
  errorBox.style.display = "block";
  errorBox.textContent = `${String(e?.stack || "")}${code}${msg}`.trim() || String(e);
  logDiag("ERROR: " + String(e?.code || "") + " :: " + String(e?.message || e));
}

function hideErrorBox(){
  errorBox.style.display = "none";
  errorBox.textContent = "";
}

window.addEventListener("error", (e) => showError(e.error || e.message || e));
window.addEventListener("unhandledrejection", (e) => showError(e.reason || e));
emailInput.addEventListener("input", () => { hideErrorBox(); loginStatus.textContent=""; });
passInput.addEventListener("input", () => { hideErrorBox(); loginStatus.textContent=""; });

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

// ==================== SINGLE USER PER COMPUTER ENFORCEMENT ====================
const DEVICE_OWNER_KEY = "webrtc_device_owner_uid";
const DEVICE_OWNER_AT  = "webrtc_device_owner_at";

const hasBroadcastChannel = ("BroadcastChannel" in window);
const authBC = hasBroadcastChannel ? new BroadcastChannel("webrtc_auth_channel") : null;

function nowMs(){ return Date.now(); }

function setDeviceOwner(uid){
  try{
    localStorage.setItem(DEVICE_OWNER_KEY, String(uid || ""));
    localStorage.setItem(DEVICE_OWNER_AT, String(nowMs()));
  }catch{}
}

function clearDeviceOwner(){
  try{
    localStorage.removeItem(DEVICE_OWNER_KEY);
    localStorage.removeItem(DEVICE_OWNER_AT);
  }catch{}
}

function getDeviceOwner(){
  try{
    return String(localStorage.getItem(DEVICE_OWNER_KEY) || "").trim() || null;
  }catch{
    return null;
  }
}

async function forceSignOutBecauseDifferentUser(newUid){
  const currentUid = auth.currentUser?.uid || null;
  if (currentUid && newUid && currentUid !== newUid){
    logDiag(`Single-user lock: another user (${newUid}) logged in on this computer -> signing out ${currentUid} in this tab`);
    try{
      stopAll();
    }catch{}
    try{
      await signOut(auth);
    }catch(e){
      showError(e);
    }
  }
}

function broadcastNewOwner(uid){
  if(authBC){
    try{ authBC.postMessage({ type:"NEW_OWNER", uid, at: nowMs() }); }catch{}
  }
}

if(authBC){
  authBC.onmessage = (ev)=>{
    const msg = ev?.data || {};
    if(msg.type === "NEW_OWNER" && msg.uid){
      forceSignOutBecauseDifferentUser(String(msg.uid));
    }
    if(msg.type === "OWNER_CLEARED"){
      // nothing required
    }
  };
}

window.addEventListener("storage", (ev)=>{
  if(ev.key === DEVICE_OWNER_KEY && ev.newValue){
    forceSignOutBecauseDifferentUser(String(ev.newValue));
  }
});

// ==================== AUTH PERSISTENCE ====================
(async function initializeAuth() {
  try {
    await setPersistence(auth, inMemoryPersistence);
    logDiag("Auth persistence set to inMemory");
    
    // Check for existing user
    const owner = getDeviceOwner();
    const currentUid = auth.currentUser?.uid || null;
    if(owner && currentUid && owner !== currentUid){
      await forceSignOutBecauseDifferentUser(owner);
    }
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
      loginStatus.textContent = "Not approved yet. Your UID: " + uid;
      try{ await signOut(auth); }catch{}
      throw new Error("Allowlist missing for UID: " + uid);
    }

    const enabled = snap.data()?.enabled === true;
    if(!enabled){
      loginStatus.textContent = "Not approved yet (enabled=false). Your UID: " + uid;
      try{ await signOut(auth); }catch{}
      throw new Error("Allowlist disabled for UID: " + uid);
    }

    return true;
  }catch(e){
    if(String(e?.code || "").includes("permission-denied")){
      loginStatus.textContent = "Allowlist check blocked by Firestore rules (permission-denied).";
    }
    throw e;
  }
}

// ==================== AUTHENTICATION FUNCTIONS ====================
function requireAuthOrPrompt(){
  if (isAuthed) return true;
  loginOverlay.style.display = "flex";
  appRoot.classList.add("locked");
  loginStatus.textContent = "Please sign in first.";
  return false;
}

loginBtn.onclick = async () => {
  hideErrorBox();
  loginStatus.textContent = "Signing in…";
  
  try {
    const email = emailInput.value.trim();
    const password = passInput.value;
    
    if (!email || !password) {
      throw new Error("Please enter email and password");
    }
    
    // Sign in
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    loginStatus.textContent = "Signed in. Checking allowlist…";
    logDiag(`User signed in: ${user.email}, UID: ${user.uid}`);

    // Set device owner
    setDeviceOwner(user.uid);
    broadcastNewOwner(user.uid);

  } catch (e) {
    loginStatus.textContent = `Login failed: ${e?.code || "unknown"}`;
    logDiag(`Login error: ${e?.code} - ${e?.message}`);
    console.error("Login error details:", e);
    showError(e);
  }
};

logoutBtn.onclick = async () => {
  try{
    stopAll();
    await signOut(auth);
    clearDeviceOwner();
  }catch(e){
    showError(e);
  }
};

// ==================== PENDING NOTIFICATION PROCESSING ====================
async function processPendingNotifications() {
  try {
    const pending = localStorage.getItem('pendingNotificationCall');
    if (pending) {
      try {
        const pendingData = JSON.parse(pending);
        if (Date.now() - pendingData.timestamp < 60000) {
          if (isAuthed && myUid) {
            showIncomingUI(pendingData.callId, {
              roomId: pendingData.roomId,
              fromName: pendingData.fromName || 'Unknown',
              toName: pendingData.toName || '',
              note: pendingData.note || ''
            });
          }
        }
        localStorage.removeItem('pendingNotificationCall');
      } catch (e) {
        localStorage.removeItem('pendingNotificationCall');
      }
    }
  } catch (e) {
    console.warn('processPendingNotifications error:', e);
  }
}

// ==================== URL PARAMETER HANDLING ====================
(function handlePushOpen(){
  try{
    const qs = new URLSearchParams(location.search);
    const callId = qs.get("callId");
    const roomId = qs.get("roomId");
    const fromName = qs.get("fromName");
    const toName = qs.get("toName");

    if(callId && roomId){
      incomingText.textContent = `Call from ${fromName || "unknown"} to ${toName || "you"}…`;
      incomingOverlay.style.display = "flex";
      if (typeof startRingtone === "function") startRingtone();

      pendingIncomingCallWhileLoggedOut = {
        id: callId,
        data: { roomId, fromName, toName }
      };

      roomIdInput.value = roomId;
    }
  }catch(e){
    console.warn("Push open parse failed", e);
  }
})();

// ==================== URL HASH / AUTOJOIN ====================
const openedFromInvite = (location.hash.length > 1);
let suppressAutoJoin = false;

if (openedFromInvite) {
  roomIdInput.value = location.hash.slice(1);
  setStatus(callStatus, "Room ID detected in URL.");
  logDiag("Room ID from URL hash: " + roomIdInput.value);
}

// ==================== SIMPLIFIED PUSH NOTIFICATION MANAGEMENT ====================
let messaging = null;
let swReg = null;
let lastPushUid = null;

const LS_PUSH_UID = "webrtc_push_uid";
const LS_PUSH_TID = "webrtc_push_tokenId";

function getSavedPushBinding(){
  try{
    const uid = localStorage.getItem(LS_PUSH_UID);
    const tid = localStorage.getItem(LS_PUSH_TID);
    return { uid: uid || null, tokenId: tid || null };
  }catch{
    return { uid:null, tokenId:null };
  }
}

function savePushBinding(uid, tokenId){
  try{
    localStorage.setItem(LS_PUSH_UID, String(uid || ""));
    localStorage.setItem(LS_PUSH_TID, String(tokenId || ""));
  }catch{}
}

function clearPushBinding(){
  try{
    localStorage.removeItem(LS_PUSH_UID);
    localStorage.removeItem(LS_PUSH_TID);
  }catch{}
}

async function revokePushForCurrentDevice(){
  const { uid, tokenId } = getSavedPushBinding();
  if(!uid || !tokenId) return;

  logDiag(`Revoking push token for this device: uid=${uid} tokenId=${tokenId}`);

  try{
    await deleteDoc(doc(db, "users", uid, "fcmTokens", tokenId));
    logDiag("Push token doc deleted from Firestore.");
  }catch(e){
    logDiag("Push token doc delete failed: " + (e?.message || e));
  }

  try{
    if(!messaging) messaging = getMessaging(app);
    await deleteToken(messaging);
    logDiag("Browser FCM token deleted (deleteToken).");
  }catch(e){
    logDiag("deleteToken failed: " + (e?.message || e));
  }

  clearPushBinding();
}

function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function validateVapid(vapid) {
  const s = String(vapid || "").trim();
  if (!/^[A-Za-z0-9\-_]+$/.test(s)) return { ok:false, why:"contains invalid characters" };
  try {
    const bytes = base64UrlToUint8Array(s);
    if (bytes.length !== 65) return { ok:false, why:`decoded length ${bytes.length}, expected 65` };
    return { ok:true, why:`ok (65 bytes)` };
  } catch (e) {
    return { ok:false, why:`decode failed: ${e?.message || e}` };
  }
}

// SIMPLIFIED enablePush - just enough to test login
async function enablePush(){
  logDiag("enablePush(): SIMPLIFIED VERSION");
  if(!requireAuthOrPrompt()) return;

  try {
    if (!("Notification" in window)) { 
      setStatus(pushStatus, "Push: not supported in this browser."); 
      return; 
    }
    
    const perm = await Notification.requestPermission();
    if (perm !== "granted"){ 
      setStatus(pushStatus, "Push: permission not granted."); 
      return; 
    }
    
    setStatus(pushStatus, "Push: ready (simplified).");
    logDiag("Push notifications enabled (simplified)");
    
  } catch (e) {
    setStatus(pushStatus, "Push: failed.");
    logDiag("Push enable failed: " + (e?.message || e));
  }
}

let autoPushClickArmed = false;

function autoEnablePushOnLogin(){
  if (!("Notification" in window)) { 
    setStatus(pushStatus, "Push: not supported in this browser."); 
    return; 
  }

  const perm = Notification.permission;

  if (perm === "granted") {
    logDiag("Auto-push: permission granted");
    enablePush().catch((e) => logDiag("Auto-push enable failed: " + (e?.message || e)));
    return;
  }

  if (perm === "denied") {
    setStatus(pushStatus, "Push: blocked in browser settings.");
    logDiag("Auto-push: permission denied");
    return;
  }

  setStatus(pushStatus, "Push: click to enable.");
  if (autoPushClickArmed) return;
  autoPushClickArmed = true;

  const handler = () => {
    autoPushClickArmed = false;
    logDiag("Auto-push: user click detected");
    enablePush().catch((e) => { 
      logDiag("Auto-push enable failed: " + (e?.message || e)); 
      showError(e); 
    });
  };

  window.addEventListener("click", handler, { once:true, capture:true });
}

// ==================== BUTTON EVENT HANDLERS ====================
startBtn.onclick = async ()=>{
  try{
    hideErrorBox();
    await startMedia();
  }catch(e){
    const name = String(e?.name || "");
    if(name === "NotAllowedError" || name === "NotFoundError") return;
    showError(e);
  }
};

createBtn.onclick = ()=> createRoom({updateHash:true, reuseRoomIdInput:true, fixedRoomId:null}).catch(showError);
joinBtn.onclick   = ()=> joinRoom().catch(showError);

roomIdInput.addEventListener("input", ()=> refreshCopyInviteState());

testSoundBtn.onclick = async ()=>{
  await unlockAudio();
  startRingtone();
  setTimeout(()=>stopRingtone(), 1800);
};

resetPushBtn.onclick = async ()=>{
  try{
    setStatus(pushStatus, "Push: resetting…");
    await revokePushForCurrentDevice();
    await enablePush();
    setStatus(pushStatus, "Push: enabled (reset).");
  }catch(e){
    showError(e);
  }
};

hangupBtn.onclick = ()=> hangup().catch(showError);

saveNameBtn.onclick = ()=> saveMyName().catch(showError);
refreshUsersBtn.onclick = ()=> loadAllAllowedUsers().catch(showError);
myNameInput.addEventListener("input", ()=>{
  saveNameBtn.disabled = !isAuthed || !String(myNameInput.value||"").trim();
});
userSearchInput.addEventListener("input", ()=> renderUsersList(userSearchInput.value));

// ==================== BACKGROUND SERVICE EVENT HANDLERS ====================
startBgBtn.onclick = startBackgroundService;
stopBgBtn.onclick = stopBackgroundService;

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
      loginOverlay.style.display = "flex";
      appRoot.classList.add("locked");
      logoutBtn.style.display = "none";
      startBtn.disabled = true;
      return;
    }

    loginOverlay.style.display = "none";
    appRoot.classList.remove("locked");
    logoutBtn.style.display = "inline-block";
    loginStatus.textContent = "Signed in.";

    startBtn.disabled = false;
    setStatus(mediaStatus, "Ready. Click Start to enable camera/mic.");

    videoQualitySelect.disabled = false;
    updateVideoQualityUi();

    testSoundBtn.disabled = false;
    resetPushBtn.disabled = false;

    autoEnablePushOnLogin();

    saveNameBtn.disabled = !String(myNameInput.value||"").trim();
    refreshUsersBtn.disabled = false;

    hangupBtn.disabled = true;

    refreshCopyInviteState();

    try{ await processPendingNotifications(); } catch(e){}
    try{ await ensureMyUserProfile(user); } catch(e){ logDiag("ensureMyUserProfile failed: " + (e?.message || e)); }
    try{ await loadAllAllowedUsers(); } catch(e){ logDiag("loadAllAllowedUsers failed: " + (e?.message || e)); }

    updateServiceStatus();
    setInterval(updateServiceStatus, 30000);

  } else {
    loginOverlay.style.display = "flex";
    appRoot.classList.add("locked");
    logoutBtn.style.display = "none";
    stopAll();

    if(videoQualitySelect) videoQualitySelect.disabled = true;

    testSoundBtn.disabled = true;
    resetPushBtn.disabled = true;

    saveNameBtn.disabled = true;
    refreshUsersBtn.disabled = true;

    setStatus(pushStatus, "Push: not enabled.");
    setStatus(dirCallStatus, "Idle.");
    myNameStatus.textContent = "Not set.";

    bgStatus.textContent = 'Sign in required';
    startBgBtn.disabled = true;
    stopBgBtn.disabled = true;

    usersList.innerHTML = "";
    allUsersCache = [];
    myDisplayName = "";
  }
});

// ==================== WINDOW EVENT LISTENERS ====================
window.addEventListener("beforeunload", ()=>{
  try{ closePeer(); }catch{}
  try{ stopRingtone(); }catch{}
});

// ==================== SIMPLE PWA DETECTION ====================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  logDiag('PWA install prompt available');
});

// ==================== INITIALIZATION ====================
console.log("WebRTC app initialization complete");
console.log("Firebase app:", app.name);
console.log("Ready for login...");

// ==================== ADD MISSING FUNCTIONS (for compilation) ====================
// These functions are referenced but not defined in the code you showed
// I'll add simplified versions to prevent errors

function refreshCopyInviteState(){
  const hasRoomId = !!roomIdInput.value.trim();
  copyLinkBtn.disabled = !(isAuthed && hasRoomId);
}

function startMedia(){ console.log("startMedia called"); }
function createRoom(){ console.log("createRoom called"); }
function joinRoom(){ console.log("joinRoom called"); }
function stopAll(){ console.log("stopAll called"); }
function hangup(){ console.log("hangup called"); }
function saveMyName(){ console.log("saveMyName called"); }
function loadAllAllowedUsers(){ console.log("loadAllAllowedUsers called"); }
function renderUsersList(){ console.log("renderUsersList called"); }
function ensureMyUserProfile(){ console.log("ensureMyUserProfile called"); }
function unlockAudio(){ console.log("unlockAudio called"); }
function startRingtone(){ console.log("startRingtone called"); }
function stopRingtone(){ console.log("stopRingtone called"); }
function closePeer(){ console.log("closePeer called"); }
function showIncomingUI(){ console.log("showIncomingUI called"); }
function stopIncomingUI(){ console.log("stopIncomingUI called"); }
function updateVideoQualityUi(){ 
  if(videoQualitySelect){
    videoQualitySelect.value = "medium";
  }
  if(videoQualityStatus) videoQualityStatus.textContent = `Video: Medium (720p).`;
}

// Call updateVideoQualityUi to initialize
updateVideoQualityUi();
