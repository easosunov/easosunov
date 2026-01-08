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
let incomingCallsUnsubscribe = null;
let roomCallsUnsubscribe = null;
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
    
    // Force refresh - sometimes needed
    window.location.reload();

  } catch (e) {
    loginStatus.textContent = `Login failed: ${e?.code || "unknown"}`;
    logDiag(`Login error: ${e?.code} - ${e?.message}`);
    console.error("Login error details:", e);
    showError(e);
    
    // Clear inputs on error
    passInput.value = "";
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

// ==================== UI STATE MANAGEMENT ====================
function refreshCopyInviteState(){
  if (!copyLinkBtn || !roomIdInput) {
    logDiag("refreshCopyInviteState: elements not found");
    return;
  }
  
  // Use requestAnimationFrame to ensure DOM is updated
  requestAnimationFrame(() => {
    const hasRoomId = !!roomIdInput.value.trim();
    const canCopy = isAuthed && hasRoomId;
    
    copyLinkBtn.disabled = !canCopy;
    
    // Debug logging
    logDiag(`refreshCopyInviteState: auth=${isAuthed}, hasRoomId="${roomIdInput.value}" (${hasRoomId}), disabled=${copyLinkBtn.disabled}`);
    
    // Also update copy link button text and style
    if (canCopy) {
      copyLinkBtn.title = "Copy invite link to clipboard";
      copyLinkBtn.style.opacity = "1";
      copyLinkBtn.style.cursor = "pointer";
    } else if (!isAuthed) {
      copyLinkBtn.title = "Sign in to copy invite";
      copyLinkBtn.style.opacity = "0.6";
      copyLinkBtn.style.cursor = "not-allowed";
    } else {
      copyLinkBtn.title = "Create or join a room first";
      copyLinkBtn.style.opacity = "0.6";
      copyLinkBtn.style.cursor = "not-allowed";
    }
  });
}
// ==================== COPY INVITE LINK ====================
async function copyTextRobust(text){
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn("Clipboard write failed:", e);
    }
  }
  
  // Fallback for older browsers or insecure contexts
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    return true;
  } catch (e) {
    console.warn("Fallback copy failed:", e);
  } finally {
    document.body.removeChild(textArea);
  }
  
  // Last resort: prompt
  window.prompt("Copy this invite link:", text);
  return false;
}

// Update the copyLinkBtn event handler
if (copyLinkBtn) {
  copyLinkBtn.onclick = async () => {
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
      
      // Show temporary success message
      setTimeout(() => {
        setStatus(callStatus, `Room: ${roomId}`);
      }, 2000);
    } else {
      setStatus(callStatus, "⚠️ Could not copy automatically");
    }
  };
}

// ==================== ROOM INPUT LISTENER ====================
if (roomIdInput) {
  roomIdInput.addEventListener("input", () => {
    refreshCopyInviteState();
  });
}

// ==================== AUTO-JOIN FROM URL HASH ====================
(function checkUrlHashForRoom() {
  if (location.hash && location.hash.length > 1) {
    const roomIdFromHash = location.hash.substring(1);
    if (roomIdInput && roomIdFromHash) {
      roomIdInput.value = roomIdFromHash;
      logDiag(`Room ID from URL hash: ${roomIdFromHash}`);
      setStatus(callStatus, `Room detected in URL: ${roomIdFromHash}`);
      
      // Auto-enable copy button if user is logged in
      setTimeout(() => refreshCopyInviteState(), 100);
    }
  }
})();




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

createBtn.onclick = () => createRoom().catch(showError);
joinBtn.onclick = () => joinRoom().catch(showError);

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
    
    // ADD THIS: Start listening for incoming calls
    try{ listenForIncomingCalls(); } catch(e){ logDiag("listenForIncomingCalls failed: " + (e?.message || e)); }
    
    // Also listen for incoming calls through rooms (for backward compatibility)
    try{ setupIncomingCallListener(); } catch(e){ logDiag("setupIncomingCallListener failed: " + (e?.message || e)); }

    updateServiceStatus();
    setInterval(updateServiceStatus, 30000);

    // Check for any pending calls that came in while logged out
    try{ checkPendingDirectCalls(); } catch(e){ logDiag("checkPendingDirectCalls failed: " + (e?.message || e)); }

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
    
    // Clear any incoming call UI if user logs out during a call
    try{ 
      incomingOverlay.style.display = "none";
      stopRingtone();
      window.currentIncomingCall = null;
    } catch(e){}
  }
});
// ==================== WINDOW EVENT LISTENERS ====================
window.addEventListener("beforeunload", ()=>{
  try{ closePeer(); }catch{}
  try{ stopRingtone(); }catch{}
});
let incomingCallsUnsubscribe = null;

async function listenForIncomingCalls() {
  if (!isAuthed || !myUid) return;
  
  // Clean up previous listener if exists
  if (incomingCallsUnsubscribe) {
    incomingCallsUnsubscribe();
    incomingCallsUnsubscribe = null;
  }
  
  try {
    const incomingCallsRef = collection(db, "users", myUid, "incomingCalls");
    
    incomingCallsUnsubscribe = onSnapshot(
      query(incomingCallsRef, where("status", "==", "ringing"), orderBy("createdAt", "desc"), limit(1)),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const callData = change.doc.data();
            
            // Check if this call is recent (within last 60 seconds)
            const now = Date.now();
            const createdAt = callData.createdAt?.toMillis ? callData.createdAt.toMillis() : now;
            const callAge = now - createdAt;
            
            if (callAge < 60000) { // Only show calls from last minute
              logDiag(`Incoming call detected: ${callData.callId} from ${callData.fromName} (${Math.round(callAge/1000)}s ago)`);
              
              // Show incoming call UI
              showIncomingCallUI(callData);
              
              // Mark as displayed to prevent duplicates
              updateDoc(change.doc.ref, { 
                displayed: true,
                displayedAt: serverTimestamp() 
              }).catch(e => logDiag("Failed to mark call as displayed: " + e.message));
            }
          }
        });
      }
    );
    
    logDiag("Listening for incoming direct calls");
  } catch (error) {
    logDiag("listenForIncomingCalls error: " + error.message);
    console.error("Incoming calls listener error details:", error);
  }
}

let roomCallsUnsubscribe = null;

function setupIncomingCallListener() {
  if (!isAuthed || !myUid) return;
  
  // Clean up previous listener if exists
  if (roomCallsUnsubscribe) {
    roomCallsUnsubscribe();
    roomCallsUnsubscribe = null;
  }
  
  try {
    const roomsRef = collection(db, "rooms");
    
    // FIXED: Remove the 'and' keyword, use proper Firestore query syntax
    roomCallsUnsubscribe = onSnapshot(
      query(roomsRef, 
        where("calledToUid", "==", myUid),
        where("status", "==", "calling"),
        where("updatedAt", ">", Date.now() - 60000), // Last 60 seconds
        orderBy("updatedAt", "desc"),
        limit(1)
      ),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const roomData = change.doc.data();
            const roomId = change.doc.id;
            
            logDiag(`Room-based call detected: ${roomId} from ${roomData.createdByName}`);
            
            // Create call data from room info
            const callData = {
              callId: `room-${roomId}`,
              roomId: roomId,
              fromUid: roomData.createdBy,
              fromName: roomData.createdByName || "Unknown",
              toUid: myUid,
              toName: roomData.calledToName || "",
              note: roomData.callNote || "",
              createdAt: new Date(roomData.updatedAt || Date.now())
            };
            
            // Show incoming call UI
            showIncomingCallUI(callData);
          }
        });
      }
    );
    
    logDiag("Listening for room-based incoming calls");
  } catch (error) {
    logDiag("setupIncomingCallListener error: " + error.message);
    console.error("Room call listener error details:", error);
  }
}

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

// ==================== RESTORED WEBRTC FUNCTIONS ====================

// ==================== WEBRTC CONFIGURATION ====================
let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function loadIceServers() {
  logDiag("Fetching ICE servers …");
  try {
    const r = await fetch("https://turn-token.easosunov.workers.dev/ice");
    if (!r.ok) throw new Error("ICE fetch failed: " + r.status);
    const data = await r.json();
    rtcConfig = { iceServers: data.iceServers };
    logDiag("ICE servers loaded: " + (data.iceServers?.length || 0));
  } catch (e) {
    logDiag("ICE server load failed, using default STUN: " + e.message);
  }
}

// ==================== MEDIA STREAM MANAGEMENT ====================
let localStream = null;
let pc = null;

// ==================== VIDEO QUALITY PROFILES ====================
const VIDEO_PROFILES = {
  low:    { label: "Low (360p)",    constraints: { width:{ideal:640},  height:{ideal:360},  frameRate:{ideal:15, max:15} } },
  medium: { label: "Medium (720p)", constraints: { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30, max:30} } },
  high:   { label: "High (1080p)",  constraints: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30, max:30} } },
};

const LS_VIDEO_QUALITY = "webrtc_video_quality";
function getSavedVideoQuality(){
  try{
    const v = String(localStorage.getItem(LS_VIDEO_QUALITY) || "").trim();
    return (v && VIDEO_PROFILES[v]) ? v : "medium";
  }catch{
    return "medium";
  }
}

function saveVideoQuality(v){
  try{ localStorage.setItem(LS_VIDEO_QUALITY, String(v||"")); }catch{}
}

let selectedVideoQuality = getSavedVideoQuality();

function updateVideoQualityUi(){
  if(videoQualitySelect){
    videoQualitySelect.value = selectedVideoQuality;
  }
  const label = VIDEO_PROFILES[selectedVideoQuality]?.label || "Medium (720p)";
  if(videoQualityStatus) videoQualityStatus.textContent = `Video: ${label}.`;
}

// Update video quality when changed
videoQualitySelect?.addEventListener("change", async ()=>{
  const v = String(videoQualitySelect.value || "medium");
  selectedVideoQuality = VIDEO_PROFILES[v] ? v : "medium";
  saveVideoQuality(selectedVideoQuality);
  updateVideoQualityUi();

  if(localStream){
    try{
      await applyVideoQualityToCurrentStream(selectedVideoQuality);
      logDiag("Video quality applied while running: " + selectedVideoQuality);
    }catch(e){
      logDiag("applyVideoQuality error: " + (e?.message || e));
    }
  }
});

async function applyVideoQualityToCurrentStream(quality){
  const profile = VIDEO_PROFILES[quality] || VIDEO_PROFILES.medium;
  const vTrack = localStream?.getVideoTracks?.()[0];
  if(!vTrack) return;
  
  try {
    await vTrack.applyConstraints(profile.constraints);
    const s = vTrack.getSettings ? vTrack.getSettings() : {};
    logDiag("Video track settings: " + JSON.stringify({
      width: s.width, height: s.height, frameRate: s.frameRate
    }));
  } catch (e) {
    logDiag("applyConstraints error: " + e.message);
  }
}

// ==================== PEER CONNECTION MANAGEMENT ====================
function closePeer(){
  if(pc){
    try{
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    }catch{}
    pc = null;
  }
  if(remoteVideo) remoteVideo.srcObject = null;
}

async function ensurePeer() {
  closePeer();

  if (!rtcConfig || !rtcConfig.iceServers || rtcConfig.iceServers.length === 0) {
    await loadIceServers();
  }

  pc = new RTCPeerConnection(rtcConfig);
  logDiag("Created RTCPeerConnection");

  const remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      e.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    }
    remoteVideo.muted = false;
    remoteVideo.play().catch(console.error);
  };

  pc.onconnectionstatechange = () => {
    if (pc) logDiag("Connection state: " + pc.connectionState);
  };

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
}


// ==================== INCOMING CALL UI ====================
function showIncomingUI(callId, data){
  // Your incoming call UI logic
  logDiag(`Incoming call: ${callId} from ${data.fromName}`);
}

function stopIncomingUI(){
  // Your stop incoming UI logic
}

// ==================== RINGBACK FUNCTIONS ====================
let ringbackTimer = null;

function stopRingback(){
  if(ringbackTimer){
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
}

function startRingback(){
  // Your ringback logic
  logDiag("Ringback started");
}

// ==================== CALL LISTENERS ====================
function listenIncomingCalls(){
  // Your incoming call listener logic
  logDiag("Listening for incoming calls");
}


// ==================== MEDIA INITIALIZATION ====================
let startingPromise = null;

async function startMedia(){
  if(!requireAuthOrPrompt()) return;

  if(localStream){
    logDiag("Media already started");
    return;
  }

  if(startingPromise) return startingPromise;

  startingPromise = (async () => {
    hideErrorBox();
    setStatus(mediaStatus, "Requesting camera/mic…");

    const profile = VIDEO_PROFILES[selectedVideoQuality] || VIDEO_PROFILES.medium;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: profile.constraints,
        audio: true
      });

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

      // Load ICE servers
      await loadIceServers();

      // Enable buttons
      startBtn.disabled = true;
      createBtn.disabled = false;
      joinBtn.disabled = false;

      logDiag("Media started successfully");

    } catch (e) {
      setStatus(mediaStatus, "Failed to start media: " + e.name);
      logDiag("getUserMedia error: " + e.message);
      throw e;
    }
  })();

  try {
    await startingPromise;
  } finally {
    startingPromise = null;
  }
}

// ==================== ROOM MANAGEMENT ====================
async function createRoom(){
  if(!requireAuthOrPrompt()) {
    logDiag("createRoom: not authenticated");
    return null;
  }

  try {
    logDiag("Starting createRoom...");
    
    // Start media if not already started
    if (!localStream) {
      await startMedia();
    }
    
    // Close any existing connection
    closePeer();
    
    // Create new room
    const roomRef = doc(collection(db, "rooms"));
    const roomId = roomRef.id;
    
    logDiag(`Creating room: ${roomId}`);
    
    // Update UI - CRITICAL: Update roomIdInput before refreshing state
    roomIdInput.value = roomId;
    location.hash = roomId;
    setStatus(callStatus, `Creating room: ${roomId}`);
    
    // Immediately refresh copy button state
    refreshCopyInviteState();
    
    // Create collections
    const callerCandidates = collection(roomRef, "callerCandidates");
    const calleeCandidates = collection(roomRef, "calleeCandidates");
    
    // Create peer connection
    await ensurePeer();
    
    // Handle ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        addDoc(callerCandidates, { 
          session: 1, 
          ...e.candidate.toJSON() 
        })
        .then(() => logDiag("Caller ICE candidate written"))
        .catch(err => console.error("Failed to write caller candidate:", err));
      }
    };
    
    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Save room data
    await setDoc(roomRef, {
      session: 1,
      offer: { type: offer.type, sdp: offer.sdp },
      answer: null,
      updatedAt: Date.now(),
      createdBy: myUid,
      createdByName: myDisplayName || "Unknown",
      status: "waiting"
    });
    
    setStatus(callStatus, `✅ Room created: ${roomId}`);
    logDiag("Created and saved offer");
    
    // Listen for answer
    const unsubscribe = onSnapshot(roomRef, async (snap) => {
      if (!snap.exists()) return;
      
      const data = snap.data();
      if (data.answer && pc.signalingState === "have-local-offer") {
        try {
          await pc.setRemoteDescription(data.answer);
          setStatus(callStatus, "✅ Connected!");
          logDiag("Remote answer accepted");
        } catch (e) {
          logDiag("Failed to set remote description: " + e.message);
        }
      }
    });
    
    // Listen for callee ICE candidates
    const unsubscribeCallee = onSnapshot(calleeCandidates, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type === "added" && pc) {
          try {
            pc.addIceCandidate(change.doc.data());
          } catch (e) {
            console.error("Failed to add ICE candidate:", e);
          }
        }
      });
    });
    
    // Store unsubscribe functions
    window._roomUnsubscribers = {
      room: unsubscribe,
      callee: unsubscribeCallee
    };
    
    // Enable hangup button
    hangupBtn.disabled = false;
    
    // FINAL refresh of copy button state - ensure it's enabled
    setTimeout(() => {
      refreshCopyInviteState();
      logDiag(`Final copy button check - Room ID: "${roomIdInput.value}", Disabled: ${copyLinkBtn.disabled}`);
    }, 100);
    
    logDiag(`Room ${roomId} created successfully`);
    return { roomId, roomRef };
    
  } catch (error) {
    setStatus(callStatus, "❌ Failed to create room");
    logDiag("createRoom error: " + error.message);
    console.error("Create room error details:", error);
    return null;
  }
}
// ==================== ROOM LISTENERS ====================
function setupRoomListeners(roomRef) {
  // Listen for answers
  const unsubscribe = onSnapshot(roomRef, async (snap) => {
    if (!snap.exists()) return;
    
    const data = snap.data();
    
    // Check for answer
    if (data.answer && pc && pc.signalingState === "have-local-offer") {
      try {
        await pc.setRemoteDescription(data.answer);
        logDiag("Remote answer accepted");
        setStatus(callStatus, "✅ Connected!");
        setStatus(dirCallStatus, "In call...");
      } catch (e) {
        logDiag("Failed to set remote description: " + e.message);
      }
    }
    
    // Check for ICE candidates
    if (data.iceCandidates) {
      // Handle incoming ICE candidates
    }
  });
  
  // Store unsubscribe function for cleanup
  window.currentRoomUnsubscribe = unsubscribe;
}

// ==================== CLEANUP FUNCTION ====================
function cleanupRoom() {
  if (window.currentRoomUnsubscribe) {
    window.currentRoomUnsubscribe();
    window.currentRoomUnsubscribe = null;
  }
  closePeer();
}
// ==================== SIMPLIFIED ROOM JOINING ====================
async function joinRoom(){
  if(!requireAuthOrPrompt()) {
    logDiag("joinRoom: not authenticated");
    return;
  }

  try {
    logDiag("Starting joinRoom...");
    
    const roomId = roomIdInput.value.trim();
    if(!roomId) {
      setStatus(callStatus, "Please enter a room ID");
      return;
    }
    
    logDiag(`Joining room: ${roomId}`);
    
    // Start media if not already started
    if (!localStream) {
      await startMedia();
    }
    
    // Close any existing connection
    closePeer();
    
    // Get room reference
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);
    
    if(!roomSnap.exists()) {
      throw new Error(`Room "${roomId}" not found`);
    }
    
    const roomData = roomSnap.data();
    
    if (!roomData.offer) {
      throw new Error("Room has no offer yet");
    }
    
    // Update UI
    location.hash = roomId;
    setStatus(callStatus, `Joining room: ${roomId}`);
    
    // Refresh copy button state immediately
    refreshCopyInviteState();
    
    // Create collections
    const callerCandidates = collection(roomRef, "callerCandidates");
    const calleeCandidates = collection(roomRef, "calleeCandidates");
    
    // Create peer connection
    await ensurePeer();
    
    // Handle ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        addDoc(calleeCandidates, { 
          session: roomData.session || 1, 
          ...e.candidate.toJSON() 
        })
        .then(() => logDiag("Callee ICE candidate written"))
        .catch(err => console.error("Failed to write callee candidate:", err));
      }
    };
    
    // Set remote offer and create answer
    await pc.setRemoteDescription(roomData.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    // Send answer back
    await updateDoc(roomRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      answeredBy: myUid,
      answeredByName: myDisplayName || "Unknown",
      answeredAt: Date.now(),
      status: "connected"
    });
    
    setStatus(callStatus, "✅ Joined room. Connecting...");
    logDiag("Answer written to room doc");
    
    // Listen for caller ICE candidates
    const unsubscribeCaller = onSnapshot(callerCandidates, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type === "added" && pc) {
          try {
            pc.addIceCandidate(change.doc.data());
          } catch (e) {
            console.error("Failed to add ICE candidate:", e);
          }
        }
      });
    });
    
    // Store unsubscribe function
    window._callerUnsubscriber = unsubscribeCaller;
    
    // Enable hangup button
    hangupBtn.disabled = false;
    
    // Final refresh of copy button state
    setTimeout(() => {
      refreshCopyInviteState();
      logDiag(`Final copy button check after join - Room ID: "${roomIdInput.value}", Disabled: ${copyLinkBtn.disabled}`);
    }, 100);
    
    logDiag(`Successfully joined room ${roomId}`);
    
  } catch (error) {
    setStatus(callStatus, "❌ Failed to join room: " + error.message);
    logDiag("joinRoom error: " + error.message);
    console.error("Join room error details:", error);
  }
}
// ==================== SYSTEM CLEANUP ====================

function stopAll(){
  // Clean up room listeners
  cleanupRoom();
  
  // Clean up call listeners
  if (incomingCallsUnsubscribe) {
    try {
      incomingCallsUnsubscribe();
    } catch (e) {
      logDiag("Error unsubscribing incoming calls: " + e.message);
    }
    incomingCallsUnsubscribe = null;
  }
  
  if (roomCallsUnsubscribe) {
    try {
      roomCallsUnsubscribe();
    } catch (e) {
      logDiag("Error unsubscribing room calls: " + e.message);
    }
    roomCallsUnsubscribe = null;
  }
  
  // Clean up direct call listeners
  if (window._directCallUnsubscribers) {
    try {
      if (window._directCallUnsubscribers.room) window._directCallUnsubscribers.room();
      if (window._directCallUnsubscribers.callee) window._directCallUnsubscribers.callee();
    } catch (e) {
      logDiag("Error cleaning up direct call subscribers: " + e.message);
    }
    window._directCallUnsubscribers = null;
  }
  
  // Close peer connection
  closePeer();
  
  // Stop local media
  if(localStream){
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  // Clear video elements
  if(localVideo) localVideo.srcObject = null;
  if(remoteVideo) remoteVideo.srcObject = null;
  
  // Update UI buttons
  if(startBtn) startBtn.disabled = !isAuthed;
  if(createBtn) createBtn.disabled = true;
  if(joinBtn) joinBtn.disabled = true;
  if(hangupBtn) hangupBtn.disabled = true;
  
  // Update status
  setStatus(mediaStatus, "Not started.");
  setStatus(callStatus, "No room yet.");
  setStatus(dirCallStatus, "Idle.");
  
  // Hide incoming call UI
  if (incomingOverlay) incomingOverlay.style.display = "none";
  stopRingtone();
  stopRingback();
  window.currentIncomingCall = null;
  
  // Refresh copy invite state
  refreshCopyInviteState();
  
  logDiag("All stopped and cleaned up");
}

// ==================== AUDIO MANAGEMENT ====================
let audioCtx = null;
let ringOsc = null;
let ringGain = null;
let ringTimer = null;

function ensureAudio(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

async function unlockAudio(){
  try{
    const ctx = ensureAudio();
    if(ctx.state !== "running") await ctx.resume();
  }catch{}
}

// Unlock audio on first click
window.addEventListener("click", unlockAudio, { once: true });

function startRingtone(){
  stopRingtone();
  
  try{
    const ctx = ensureAudio();
    if(ctx.state !== "running") ctx.resume().catch(()=>{});
    
    ringGain = ctx.createGain();
    ringGain.gain.value = 0.10;
    ringGain.connect(ctx.destination);

    ringOsc = ctx.createOscillator();
    ringOsc.type = "sine";
    ringOsc.frequency.value = 880;
    ringOsc.connect(ringGain);
    ringOsc.start();

    let on = true;
    ringTimer = setInterval(()=>{
      if(!ringGain) return;
      ringGain.gain.value = on ? 0.10 : 0.0001;
      on = !on;
    }, 450);

    logDiag("Ringtone started.");
  }catch(e){
    logDiag("Ringtone failed: " + e.message);
  }
}

function stopRingtone(){
  if(ringTimer){
    clearInterval(ringTimer);
    ringTimer = null;
  }
  
  try{ if(ringOsc) ringOsc.stop(); }catch{}
  try{ if(ringOsc) ringOsc.disconnect(); }catch{}
  try{ if(ringGain) ringGain.disconnect(); }catch{}
  
  ringOsc = null;
  ringGain = null;
}

// ==================== CALL MANAGEMENT ====================
function hangup(){
  stopRingtone();
  stopRingback();
  
  // Clean up direct call listeners
  if (window._directCallUnsubscribers) {
    if (window._directCallUnsubscribers.room) window._directCallUnsubscribers.room();
    if (window._directCallUnsubscribers.callee) window._directCallUnsubscribers.callee();
    window._directCallUnsubscribers = null;
  }
  
  // Update room status if we were in a direct call
  const roomId = roomIdInput.value.trim();
  if (roomId) {
    const roomRef = doc(db, "rooms", roomId);
    updateDoc(roomRef, {
      status: "ended",
      endedAt: Date.now(),
      endedBy: myUid
    }).catch(e => logDiag("Failed to update room status: " + e.message));
  }
  
  stopAll();
  setStatus(dirCallStatus, "Call ended.");
  logDiag("Call hung up");
}


function showIncomingCallUI(callData) {
  // Don't show if we already have an incoming call
  if (window.currentIncomingCall || incomingOverlay.style.display === "flex") {
    logDiag("Already showing incoming call, skipping duplicate");
    return;
  }
  
  // Stop any existing ringback (if we were calling someone)
  stopRingback();
  
  // Start ringtone
  startRingtone();
  
  // Show the incoming call overlay
  incomingText.innerHTML = `
    <strong>Incoming call from:</strong><br>
    ${callData.fromName}<br>
    ${callData.note ? `<small>Note: ${callData.note}</small><br>` : ''}
    <small>Click Answer to join the call</small>
  `;
  
  incomingOverlay.style.display = "flex";
  
  // Store current call data
  window.currentIncomingCall = {
    callId: callData.callId,
    roomId: callData.roomId,
    fromUid: callData.fromUid,
    fromName: callData.fromName,
    data: callData
  };
  
  // Set up answer button
  answerBtn.onclick = async () => {
    stopRingtone();
    incomingOverlay.style.display = "none";
    
    // Update call status in Firestore if it exists
    if (callData.callId && !callData.callId.startsWith('room-')) {
      try {
        const callRef = doc(db, "users", myUid, "incomingCalls", callData.callId);
        await updateDoc(callRef, { 
          status: "answered", 
          answeredAt: serverTimestamp() 
        });
      } catch (e) {
        logDiag("Failed to update call status: " + e.message);
      }
    }
    
    // Also update room status if it's a room-based call
    if (callData.roomId) {
      try {
        const roomRef = doc(db, "rooms", callData.roomId);
        await updateDoc(roomRef, { 
          status: "answered", 
          answeredAt: serverTimestamp(),
          answeredBy: myUid,
          answeredByName: myDisplayName || "User"
        });
      } catch (e) {
        logDiag("Failed to update room status: " + e.message);
      }
    }
    
    // Join the room
    roomIdInput.value = callData.roomId;
    setStatus(callStatus, `Answering call from ${callData.fromName}...`);
    setStatus(dirCallStatus, "Connecting...");
    
    // Small delay to ensure UI updates
    setTimeout(async () => {
      await joinRoom();
      window.currentIncomingCall = null;
    }, 500);
  };
  
  // Set up decline button
  declineBtn.onclick = async () => {
    stopRingtone();
    incomingOverlay.style.display = "none";
    
    // Update call status in Firestore if it exists
    if (callData.callId && !callData.callId.startsWith('room-')) {
      try {
        const callRef = doc(db, "users", myUid, "incomingCalls", callData.callId);
        await updateDoc(callRef, { 
          status: "declined", 
          declinedAt: serverTimestamp() 
        });
      } catch (e) {
        logDiag("Failed to update call status: " + e.message);
      }
    }
    
    // Update room status
    if (callData.roomId) {
      try {
        const roomRef = doc(db, "rooms", callData.roomId);
        await updateDoc(roomRef, { 
          status: "declined", 
          declinedAt: serverTimestamp(),
          declinedBy: myUid
        });
      } catch (e) {
        logDiag("Failed to update room status: " + e.message);
      }
    }
    
    setStatus(dirCallStatus, "Call declined.");
    window.currentIncomingCall = null;
  };
  
  // Auto-decline after 60 seconds if not answered
  setTimeout(() => {
    if (incomingOverlay.style.display === "flex" && window.currentIncomingCall) {
      logDiag("Auto-declining call after timeout");
      declineBtn.click();
    }
  }, 60000);
}
// ==================== USER MANAGEMENT ====================
let myDisplayName = "";
let allUsersCache = [];

function defaultNameFromEmail(email){
  const e = String(email || "").trim();
  if(!e) return "";
  return e.split("@")[0].slice(0, 24);
}

async function ensureMyUserProfile(user){
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    const existing = snap.exists() ? (snap.data() || {}) : {};
    const name = existing.displayName || defaultNameFromEmail(user.email) || "User";

    await setDoc(ref, {
      uid: user.uid,
      displayName: name,
      updatedAt: serverTimestamp()
    }, { merge: true });

    myDisplayName = name;
    myNameInput.value = name;
    myNameStatus.textContent = `Name: ${name}`;
    
    logDiag("User profile ensured: " + name);
  } catch (e) {
    logDiag("ensureMyUserProfile error: " + e.message);
  }
}

async function saveMyName(){
  if(!requireAuthOrPrompt()) return;

  const name = String(myNameInput.value || "").trim();
  if(!name) {
    setStatus(myNameStatus, "Name cannot be empty");
    return;
  }

  try {
    await setDoc(doc(db, "users", myUid), {
      displayName: name,
      updatedAt: serverTimestamp()
    }, { merge:true });

    myDisplayName = name;
    myNameStatus.textContent = `Saved: ${name}`;
    logDiag("Name saved: " + name);
  } catch (e) {
    setStatus(myNameStatus, "Failed to save: " + e.message);
    logDiag("saveMyName error: " + e.message);
  }
}

async function loadAllAllowedUsers(){
  if(!requireAuthOrPrompt()) return;

  try {
    const alSnap = await getDocs(
      query(collection(db, "allowlistUids"), where("enabled", "==", true), limit(50))
    );
    
    const uids = alSnap.docs.map(d => d.id).filter(Boolean);
    const users = [];

    // Load user profiles in chunks
    for(let i = 0; i < uids.length; i += 10){
      const chunk = uids.slice(i, i + 10);
      const usSnap = await getDocs(query(
        collection(db, "users"), 
        where(documentId(), "in", chunk)
      ));
      
      usSnap.forEach(doc => {
        const data = doc.data() || {};
        users.push({ uid: doc.id, displayName: data.displayName || "" });
      });
    }

    allUsersCache = users;
    renderUsersList();
    logDiag("Loaded " + users.length + " users");
  } catch (e) {
    logDiag("loadAllAllowedUsers error: " + e.message);
  }
}

function renderUsersList(filterText = ""){
  if(!usersList) return;

  const query = String(filterText || "").trim().toLowerCase();
  const filtered = allUsersCache
    .filter(u => u.uid !== myUid)
    .filter(u => !query || String(u.displayName || "").toLowerCase().includes(query))
    .sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));

  usersList.innerHTML = "";

  if(filtered.length === 0){
    usersList.innerHTML = '<div class="small" style="color:#777">No users found</div>';
    return;
  }

  filtered.forEach(user => {
    const div = document.createElement("div");
    div.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid #eee;
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 8px;
    `;

    const left = document.createElement("div");
    left.innerHTML = `<b>${user.displayName || "(no name)"}</b>`;

    const btn = document.createElement("button");
    btn.textContent = "Call";
    btn.disabled = !isAuthed;
    btn.onclick = () => startCallToUid(user.uid, user.displayName).catch(showError);

    div.appendChild(left);
    div.appendChild(btn);
    usersList.appendChild(div);
  });
}

// ==================== PENDING DIRECT CALLS CHECK ====================
async function checkPendingDirectCalls() {
  if (!isAuthed || !myUid) return;
  
  try {
    // Check for pending calls in localStorage
    const pendingCall = localStorage.getItem('pendingDirectCall');
    if (pendingCall) {
      try {
        const pendingData = JSON.parse(pendingCall);
        if (Date.now() - pendingData.timestamp < 60000) {
          logDiag(`Processing pending direct call from ${pendingData.fromName}`);
          
          // Create call data
          const callData = {
            callId: pendingData.callId,
            roomId: pendingData.roomId,
            fromUid: pendingData.fromUid,
            fromName: pendingData.fromName || 'Unknown',
            toUid: myUid,
            toName: pendingData.toName || '',
            note: pendingData.note || '',
            createdAt: new Date(pendingData.timestamp)
          };
          
          // Show incoming call UI
          showIncomingCallUI(callData);
        }
        localStorage.removeItem('pendingDirectCall');
      } catch (e) {
        localStorage.removeItem('pendingDirectCall');
        logDiag("Error processing pending call: " + e.message);
      }
    }
    
  } catch (error) {
    logDiag("checkPendingDirectCalls error: " + error.message);
  }
}



async function startCallToUid(toUid, toName = ""){
  if(!requireAuthOrPrompt()) return;
  
  logDiag(`Starting call to: ${toUid} (${toName})`);
  setStatus(dirCallStatus, `Calling ${toName || "user"}...`);
  
  try {
    // Start media if not already started
    if (!localStream) {
      await startMedia();
    }
    
    // Close any existing connection
    closePeer();
    
    // Create a new room for this call
    const roomRef = doc(collection(db, "rooms"));
    const roomId = roomRef.id;
    
    logDiag(`Creating room ${roomId} for direct call to ${toUid}`);
    
    // Update UI
    roomIdInput.value = roomId;
    location.hash = roomId;
    setStatus(callStatus, `Calling ${toName || "user"}...`);
    refreshCopyInviteState();
    
    // Create collections
    const callerCandidates = collection(roomRef, "callerCandidates");
    const calleeCandidates = collection(roomRef, "calleeCandidates");
    
    // Create peer connection
    await ensurePeer();
    
    // Handle ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        addDoc(callerCandidates, { 
          session: 1, 
          ...e.candidate.toJSON() 
        })
        .then(() => logDiag("Caller ICE candidate written"))
        .catch(err => console.error("Failed to write caller candidate:", err));
      }
    };
    
    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Save room data with special metadata for direct call
    await setDoc(roomRef, {
      session: 1,
      offer: { type: offer.type, sdp: offer.sdp },
      answer: null,
      updatedAt: Date.now(),
      createdBy: myUid,
      createdByName: myDisplayName || "Unknown",
      calledToUid: toUid,
      calledToName: toName,
      status: "calling",
      callNote: callNoteInput.value.trim() || "",
      isDirectCall: true
    });
    
    setStatus(callStatus, `✅ Room created. Waiting for ${toName || "user"} to answer...`);
    logDiag("Created and saved offer for direct call");
    
    // Listen for answer
    const unsubscribe = onSnapshot(roomRef, async (snap) => {
      if (!snap.exists()) return;
      
      const data = snap.data();
      if (data.answer && pc.signalingState === "have-local-offer") {
        try {
          await pc.setRemoteDescription(data.answer);
          setStatus(callStatus, "✅ Connected!");
          setStatus(dirCallStatus, `In call with ${toName || "user"}...`);
          logDiag("Remote answer accepted for direct call");
          stopRingback();
        } catch (e) {
          logDiag("Failed to set remote description: " + e.message);
        }
      }
      
      // Check if call was declined
      if (data.status === "declined") {
        setStatus(dirCallStatus, `Call declined by ${toName || "user"}`);
        setStatus(callStatus, "Call ended");
        logDiag("Call was declined");
        stopRingback();
        hangup();
      }
    });
    
    // Listen for callee ICE candidates
    const unsubscribeCallee = onSnapshot(calleeCandidates, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type === "added" && pc) {
          try {
            pc.addIceCandidate(change.doc.data());
          } catch (e) {
            console.error("Failed to add ICE candidate:", e);
          }
        }
      });
    });
    
    // Store unsubscribe functions
    window._directCallUnsubscribers = {
      room: unsubscribe,
      callee: unsubscribeCallee
    };
    
    // Enable hangup button
    hangupBtn.disabled = false;
    
    // Send push notification to the called user
    await sendCallNotification(toUid, toName, roomId);
    
    // Start ringback tone
    startRingback();
    
    logDiag(`Direct call initiated to ${toUid} via room ${roomId}`);
    
  } catch (error) {
    setStatus(dirCallStatus, `❌ Failed to call ${toName || "user"}: ${error.message}`);
    logDiag("startCallToUid error: " + error.message);
    console.error("Direct call error details:", error);
  }
}


async function sendCallNotification(toUid, toName, roomId) {
  try {
    logDiag(`Sending call notification to ${toUid} for room ${roomId}`);
    
    // Create a call document in the user's incoming calls collection
    const callRef = doc(collection(db, "users", toUid, "incomingCalls"));
    const callId = callRef.id;
    
    await setDoc(callRef, {
      callId: callId,
      roomId: roomId,
      fromUid: myUid,
      fromName: myDisplayName || "Unknown",
      toUid: toUid,
      toName: toName || "",
      note: callNoteInput.value.trim() || "",
      createdAt: serverTimestamp(),
      status: "ringing"
    });
    
    logDiag(`Call notification ${callId} saved for user ${toUid}`);
    
    // Trigger push notification via your cloud function
    await fetch(NOTIFY_CALL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toUid: toUid,
        roomId: roomId,
        fromName: myDisplayName || "Unknown",
        toName: toName || "",
        note: callNoteInput.value.trim() || "",
        callId: callId
      })
    });
    
    logDiag("Push notification triggered");
    
  } catch (error) {
    logDiag("sendCallNotification error: " + error.message);
    console.error("Notification error details:", error);
  }
}

// ==================== INITIALIZE ====================
// Initialize UI
updateVideoQualityUi();

// Setup user search
if(userSearchInput){
  userSearchInput.addEventListener("input", () => renderUsersList(userSearchInput.value));
}

console.log("WebRTC functions restored");
