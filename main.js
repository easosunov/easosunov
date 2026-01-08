// ==================== IMPORT MODULES ====================
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
console.log("APP VERSION:", "2026-01-03-sw-debug-ALWAYS-2");

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

async function ensureServiceWorkerInstalled() {
  if (!("serviceWorker" in navigator)) {
    console.log("[SW] not supported");
    return null;
  }

  if (navigator.serviceWorker.controller) {
    console.log("[SW] controller already active");
  }

  const swUrl = new URL("/easosunov/firebase-messaging-sw.js", location.origin);
  swUrl.searchParams.set("v", "2026-01-03-bootstrap-1");

  try {
    swBootstrapReg = await navigator.serviceWorker.register(swUrl.toString(), {
      scope: "/easosunov/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    console.log("[SW] bootstrap registered:", swBootstrapReg.scope);
    return swBootstrapReg;
  } catch (e) {
    console.error("[SW] bootstrap register failed:", e);
    return null;
  }
}

// RUN IT NOW (top-level)
await ensureServiceWorkerInstalled();

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
const createBtn= document.getElementById("createBtn");
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

const setStatus = (el,msg)=> el.textContent = msg;

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

window.addEventListener("error", (e)=> showError(e.error || e.message || e));
window.addEventListener("unhandledrejection", (e)=> showError(e.reason || e));
emailInput.addEventListener("input", () => { hideErrorBox(); loginStatus.textContent=""; });
passInput.addEventListener("input", () => { hideErrorBox(); loginStatus.textContent=""; });

// ==================== FIREBASE INITIALIZATION ====================
const app = initializeApp({
  apiKey:"AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain:"easosunov-webrtc.firebaseapp.com",
  projectId:"easosunov-webrtc",
  storageBucket:"easosunov-webrtc.firebasestorage.app",
  messagingSenderId:"100169991412",
  appId:"1:100169991412:web:27ef6820f9a59add6b4aa1"
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

(async function enforceSingleUserOnStartup(){
  const owner = getDeviceOwner();
  const currentUid = auth.currentUser?.uid || null;
  if(owner && currentUid && owner !== currentUid){
    await forceSignOutBecauseDifferentUser(owner);
  }
})();

await setPersistence(auth, inMemoryPersistence);

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
      loginStatus.textContent =
        "Allowlist check blocked by Firestore rules (permission-denied).";
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
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value);
    loginStatus.textContent = "Signed in. Checking allowlist…";

    const uid = auth.currentUser?.uid;
    if(uid){
      setDeviceOwner(uid);
      broadcastNewOwner(uid);
    }

  } catch (e) {
    loginStatus.textContent = `Login failed: ${e?.code || "unknown"}`;
    try { logDiag("LOGIN ERROR PROPS: " + JSON.stringify(e, Object.getOwnPropertyNames(e))); } catch {}
    showError(e);
  }
};

logoutBtn.onclick = async () => {
  try{
    stopAll();
    await revokePushForCurrentDevice();
    await signOut(auth);
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
      incomingText.textContent = `Call from ${fromName || "unknown"}…`;
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

// ==================== WEBRTC CONFIGURATION ====================
let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function loadIceServers() {
  logDiag("Fetching ICE servers …");
  const r = await fetch("https://turn-token.easosunov.workers.dev/ice");
  if (!r.ok) throw new Error("ICE fetch failed: " + r.status);
  const data = await r.json();
  rtcConfig = { iceServers: data.iceServers };
  logDiag("ICE servers detail (urls only): " + JSON.stringify(
    (data.iceServers || []).map(s => ({ urls: s.urls }))
  ));
  logDiag("ICE servers loaded: " + (data.iceServers?.length || 0));
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

updateVideoQualityUi();

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
      showError(e);
    }
  }
});

async function applyVideoQualityToCurrentStream(quality){
  const profile = VIDEO_PROFILES[quality] || VIDEO_PROFILES.medium;
  const vTrack = localStream?.getVideoTracks?.()[0];
  if(!vTrack) throw new Error("No video track to apply constraints to.");
  await vTrack.applyConstraints(profile.constraints);

  const s = vTrack.getSettings ? vTrack.getSettings() : {};
  logDiag("Video track settings now: " + JSON.stringify({
    width: s.width, height: s.height, frameRate: s.frameRate
  }));
}

// ==================== WEBRTC PEER CONNECTION MANAGEMENT ====================
let pinnedRoomId = null;

function closePeer(){
  if(pc){
    pc.onicecandidate=null;
    pc.ontrack=null;
    pc.onconnectionstatechange=null;
    pc.oniceconnectionstatechange=null;
    try{ pc.close(); }catch{}
    pc=null;
  }
  remoteVideo.srcObject = null;
}

async function ensurePeer() {
  closePeer();

  if (!rtcConfig || !rtcConfig.iceServers || rtcConfig.iceServers.length === 0) {
    await loadIceServers();
  }

  pc = new RTCPeerConnection(rtcConfig);
  logDiag("Created RTCPeerConnection with ICE servers");

  const rs = new MediaStream();
  remoteVideo.srcObject = rs;

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach(t => rs.addTrack(t));
    remoteVideo.muted = false;
    remoteVideo.play().catch(() => {});
    logDiag(`ontrack: ${e.streams[0].getTracks().map(t=>t.kind).join(",")}`);
  };

  pc.onconnectionstatechange = () => { if (pc) logDiag("pc.connectionState=" + pc.connectionState); };
  pc.oniceconnectionstatechange = () => { if (pc) logDiag("pc.iceConnectionState=" + pc.iceConnectionState); };

  if (!localStream) throw new Error("Local media not started.");
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
}

// ==================== FIRESTORE HELPER FUNCTIONS ====================
async function clearSub(col){
  const s = await getDocs(col);
  if(s.empty) return;
  const b = writeBatch(db);
  s.forEach(d=>b.delete(d.ref));
  await b.commit();
  logDiag(`Cleared subcollection ${col.path} docs=${s.size}`);
}

// ==================== UI STATE MANAGEMENT ====================
function refreshCopyInviteState(){
  const hasRoomId = !!roomIdInput.value.trim();
  copyLinkBtn.disabled = !(isAuthed && hasRoomId);
}

// ==================== MEDIA INITIALIZATION & AUTOJOIN ====================
let startingPromise = null;
let autoJoinDone = false;
let autoJoinScheduled = false;
let autoJoinTimer = null;

async function startMedia(opts={skipAutoJoin:false}){
  if(!requireAuthOrPrompt()) return;

  if(localStream){
    if(!opts.skipAutoJoin) scheduleAutoJoin();
    return;
  }
  if(startingPromise) return startingPromise;

  startingPromise = (async()=>{
    hideErrorBox();

    setStatus(mediaStatus,"Requesting camera/mic…");
    logDiag("Requesting getUserMedia…");

    const profile = VIDEO_PROFILES[selectedVideoQuality] || VIDEO_PROFILES.medium;

    localStream = await navigator.mediaDevices.getUserMedia({
      video: profile.constraints,
      audio: true
    });

    localVideo.srcObject = localStream;

    try{
      await applyVideoQualityToCurrentStream(selectedVideoQuality);
    }catch(e){
      logDiag("Initial applyConstraints failed (non-fatal): " + (e?.message || e));
    }

    setStatus(mediaStatus,"Camera/mic started.");
    logDiag("Camera/mic started (stream attached).");

    localVideo.onloadedmetadata = async () => {
      try { await localVideo.play(); } catch {}
      setStatus(mediaStatus,"Camera/mic started.");
      logDiag("Local video playing.");
    };

    await loadIceServers();

    startBtn.disabled = true;
    createBtn.disabled = false;
    joinBtn.disabled   = false;

  })();

  try{ await startingPromise; }
  finally{ startingPromise = null; }

  if(!opts.skipAutoJoin) scheduleAutoJoin();
}

function cancelPendingAutoJoin(){
  autoJoinScheduled = false;
  if (autoJoinTimer) { clearTimeout(autoJoinTimer); autoJoinTimer = null; }
}

function scheduleAutoJoin(){
  if (!openedFromInvite) return;
  if (suppressAutoJoin) return;
  if (autoJoinScheduled) return;

  cancelPendingAutoJoin();
  autoJoinScheduled = true;

  autoJoinTimer = setTimeout(async ()=>{
    autoJoinScheduled = false;
    autoJoinTimer = null;
    try{ await autoJoinIfNeeded(); }
    catch(e){
      setStatus(callStatus, `Auto-join failed: ${e?.message || e}`);
      showError(e);
    }
  }, 0);
}

async function autoJoinIfNeeded(){
  if(autoJoinDone) return;
  if(!roomIdInput.value.trim()) return;

  autoJoinDone = true;
  setStatus(callStatus,"Auto-joining room…");
  logDiag("Auto-joining triggered.");

  try{
    await joinRoom();
  }catch(e){
    autoJoinDone = false;
    throw e;
  }
}

// ==================== FIRESTORE LISTENER MANAGEMENT ====================
let unsubRoomA=null, unsubCalleeA=null;
let unsubRoomB=null, unsubCallerB=null;

function stopListeners(){
  if(unsubRoomA){ unsubRoomA(); unsubRoomA=null; }
  if(unsubCalleeA){ unsubCalleeA(); unsubCalleeA=null; }
  if(unsubRoomB){ unsubRoomB(); unsubRoomB=null; }
  if(unsubCallerB){ unsubCallerB(); unsubCallerB=null; }
}

// ==================== SYSTEM CLEANUP FUNCTIONS ====================
function stopAll(){
  stopListeners();
  closePeer();
  stopCallListeners();
  stopIncomingUI();
  stopRingback();

  if(localStream){
    localStream.getTracks().forEach(t=>t.stop());
    localStream=null;
  }
  localVideo.srcObject=null;

  startBtn.disabled = !isAuthed;
  createBtn.disabled = true;
  joinBtn.disabled = true;

  setStatus(mediaStatus,"Not started.");
  setStatus(callStatus,"No room yet.");

  autoJoinDone = false;
  suppressAutoJoin = false;
  cancelPendingAutoJoin();

  refreshCopyInviteState();

  hangupBtn.disabled = true;
  setStatus(dirCallStatus, "Idle.");

  pinnedRoomId = null;
}

// ==================== REJOIN SUPPORT ====================
let lastSeenJoinRequestA = 0;
let lastAnsweredSessionB = null;
let bRetryTimer = null;

function clearBRetry(){
  if(bRetryTimer){ clearTimeout(bRetryTimer); bRetryTimer=null; }
}

async function requestFreshOffer(roomRef){
  lastAnsweredSessionB = null;
  await setDoc(roomRef, { joinRequest: Date.now() }, { merge:true });
  logDiag("Requested fresh offer (joinRequest).");
}

// ==================== ROOM CREATION (CALLER SIDE) ====================
let createAttemptA = 0;

async function createRoom(options={updateHash:true, reuseRoomIdInput:true, fixedRoomId:null}){
  if(!requireAuthOrPrompt()) return null;

  suppressAutoJoin = true;
  autoJoinDone = true;
  cancelPendingAutoJoin();

  stopListeners();
  clearBRetry();

  await startMedia({ skipAutoJoin:true });

  const myAttempt = ++createAttemptA;

  const existing =
    (options.fixedRoomId ? String(options.fixedRoomId).trim() : "") ||
    (pinnedRoomId ? String(pinnedRoomId).trim() : "") ||
    (options.reuseRoomIdInput ? roomIdInput.value.trim() : "");

  const roomRef = existing ? doc(db, "rooms", existing) : doc(collection(db, "rooms"));

  roomIdInput.value = roomRef.id;
  if (options.updateHash) location.hash = roomRef.id;

  refreshCopyInviteState();
  logDiag("CreateRoom: roomId=" + roomRef.id);

  const caller = collection(roomRef,"callerCandidates");
  const callee = collection(roomRef,"calleeCandidates");
  const snap = await getDoc(roomRef);
  const prev = snap.exists() ? (snap.data().session || 0) : 0;
  const session = Number(prev) + 1;

  if(myAttempt !== createAttemptA) return null;

  await clearSub(caller);
  await clearSub(callee);

  if(myAttempt !== createAttemptA) return null;

  await ensurePeer();

  pc.onicecandidate = (e)=>{
    if(e.candidate){
      addDoc(caller, { session, ...e.candidate.toJSON() }).catch(()=>{});
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await setDoc(roomRef, {
    session,
    offer: { type: offer.type, sdp: offer.sdp },
    answer: null,
    updatedAt: Date.now()
  }, { merge:true });

  setStatus(callStatus, `Room active (session ${session}).`);
  logDiag(`Room written. session=${session}`);

  unsubRoomA = onSnapshot(roomRef, async (s)=>{
    if(myAttempt !== createAttemptA) return;
    const d = s.data();
    if(!d) return;

    if(d.joinRequest && d.joinRequest > lastSeenJoinRequestA){
      lastSeenJoinRequestA = d.joinRequest;
      setStatus(callStatus, "Join request received — restarting session…");
      logDiag("JoinRequest seen => restarting offer/session.");
      setTimeout(()=>createRoom({ ...options, fixedRoomId: roomRef.id, reuseRoomIdInput: true }).catch(()=>{}), 150);
      return;
    }

    if(d.answer && d.session === session && pc && pc.signalingState === "have-local-offer" && !pc.currentRemoteDescription){
      try{
        await pc.setRemoteDescription(d.answer);
        setStatus(callStatus, `Connected (session ${session}).`);
        logDiag("Applied remote answer.");
      }catch(e){
        logDiag("setRemoteDescription(answer) failed: " + (e?.message || e));
        setStatus(callStatus, "Answer failed — restarting session…");
        setTimeout(()=>createRoom({ ...options, fixedRoomId: roomRef.id, reuseRoomIdInput: true }).catch(()=>{}), 200);
      }
    }
  });

  unsubCalleeA = onSnapshot(callee, (ss)=>{
    ss.docChanges().forEach(ch=>{
      if(ch.type !== "added" || !pc) return;
      const c = ch.doc.data();
      if(c.session !== session) return;
      try{ pc.addIceCandidate(c); }catch{}
    });
  });

  return { roomId: roomRef.id, roomRef };
}

// ==================== ROOM JOINING (CALLEE SIDE) ====================
let joinAttemptB = 0;

async function joinRoom(){
  if(!requireAuthOrPrompt()) return;

  suppressAutoJoin = false;
  await startMedia({ skipAutoJoin:true });

  const myAttempt = ++joinAttemptB;
  stopListeners();
  clearBRetry();

  const roomId = roomIdInput.value.trim();
  if(!roomId) throw new Error("Room ID is empty.");
  location.hash = roomId;

  logDiag("JoinRoom: roomId=" + roomId);

  const roomRef = doc(db,"rooms", roomId);
  const snap = await getDoc(roomRef);
  if(!snap.exists()) throw new Error("Room not found");

  await requestFreshOffer(roomRef);
  if(myAttempt !== joinAttemptB) return;

  setStatus(callStatus, "Connecting… (requested fresh offer)");

  unsubRoomB = onSnapshot(roomRef, async (s)=>{
    if(myAttempt !== joinAttemptB) return;
    const d = s.data();
    if(!d?.offer || !d.session) return;

    if(lastAnsweredSessionB === d.session) return;

    const session = d.session;
    lastAnsweredSessionB = session;
    logDiag("New offer/session detected: " + session);

    try{
      await ensurePeer();

      const caller = collection(roomRef,"callerCandidates");
      const callee = collection(roomRef,"calleeCandidates");

      await clearSub(callee);
      if(myAttempt !== joinAttemptB) return;

      pc.onicecandidate = (e)=>{
        if(e.candidate){
          addDoc(callee, { session, ...e.candidate.toJSON() }).catch(()=>{});
        }
      };

      await pc.setRemoteDescription(d.offer);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);

      await updateDoc(roomRef, { answer: ans, session, answeredAt: Date.now() });
      setStatus(callStatus, `Joined room. Connecting… (session ${session})`);
      logDiag("Answer written to room doc.");

      unsubCallerB = onSnapshot(caller, (ss)=>{
        if(myAttempt !== joinAttemptB) return;
        ss.docChanges().forEach(ch=>{
          if(ch.type !== "added" || !pc) return;
          const c = ch.doc.data();
          if(c.session !== session) return;
          try{ pc.addIceCandidate(c); }catch{}
        });
      });

      clearBRetry();
      bRetryTimer = setTimeout(async ()=>{
        if(myAttempt !== joinAttemptB) return;
        if(!pc) return;
        if(pc.connectionState === "connected") return;

        setStatus(callStatus, "Still connecting… retrying (requesting new offer)…");
        logDiag("Watchdog: requesting fresh offer again.");
        try{
          lastAnsweredSessionB = null;
          await requestFreshOffer(roomRef);
        }catch(e){ showError(e); }
      }, 10000);

      pc.onconnectionstatechange = async ()=>{
        if(myAttempt !== joinAttemptB || !pc) return;
        setStatus(callStatus, `B: ${pc.connectionState} (session ${session})`);
        if(pc.connectionState === "connected"){ clearBRetry(); }
        if(pc.connectionState === "failed" || pc.connectionState === "disconnected"){
          setStatus(callStatus, "Connection lost — requesting new offer…");
          logDiag("Connection lost => requesting fresh offer.");
          try{
            lastAnsweredSessionB = null;
            await requestFreshOffer(roomRef);
          }catch(e){ showError(e); }
        }
      };

    }catch(e){
      lastAnsweredSessionB = null;
      logDiag("Join flow error: " + (e?.message || e));
      setStatus(callStatus, "Join failed — requesting new offer…");
      try{ await requestFreshOffer(roomRef); }catch(err){ showError(err); }
    }
  });
}

// ==================== INVITE LINK MANAGEMENT ====================
async function copyTextRobust(text){
  if(navigator.clipboard && window.isSecureContext){
    try{ await navigator.clipboard.writeText(text); return true; }catch{}
  }
  window.prompt("Copy this invite link:", text);
  return false;
}

copyLinkBtn.onclick = async ()=>{
  const roomId = roomIdInput.value.trim();
  if(!roomId) return;
  const invite = `${location.origin}${location.pathname}#${roomId}`;
  const ok = await copyTextRobust(invite);
  setStatus(callStatus, ok ? "Invite copied." : "Clipboard blocked — link shown for manual copy.");
  logDiag("Copy invite clicked.");
};

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
window.addEventListener("click", ()=>{ unlockAudio(); }, { once:false, passive:true });

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
    logDiag("Ringtone failed: " + (e?.message || e));
  }
}
function stopRingtone(){
  if(ringTimer){ clearInterval(ringTimer); ringTimer=null; }
  try{ if(ringOsc){ ringOsc.stop(); } }catch{}
  try{ if(ringOsc){ ringOsc.disconnect(); } }catch{}
  try{ if(ringGain){ ringGain.disconnect(); } }catch{}
  ringOsc = null;
  ringGain = null;
}

// ==================== RINGBACK TONE MANAGEMENT ====================
let ringbackTimer = null;

function stopRingback(){
  if(ringbackTimer){
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
}

function playRingbackBeepOnce(){
  try{
    const ctx = ensureAudio();
    if(ctx.state !== "running") ctx.resume().catch(()=>{});

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    gain.gain.value = 0.04;
    osc.type = "sine";
    osc.frequency.value = 440;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.18);

    osc.onended = ()=>{
      try{ osc.disconnect(); }catch{}
      try{ gain.disconnect(); }catch{}
    };
  }catch{}
}

function startRingback(){
  stopRingback();

  try{ unlockAudio(); }catch{}

  const cycleMs = 2500;

  playRingbackBeepOnce();
  setTimeout(()=> playRingbackBeepOnce(), 250);

  ringbackTimer = setInterval(()=>{
    playRingbackBeepOnce();
    setTimeout(()=> playRingbackBeepOnce(), 250);
  }, cycleMs);
}

// ==================== CALL MANAGEMENT (UID-BASED) ====================
let currentIncomingCall = null;
let activeCallId = null;
let lastDismissedIncomingCallId = null;

let unsubIncoming = null;
let unsubCallDoc = null;

function stopCallListeners(){
  if(unsubIncoming){ unsubIncoming(); unsubIncoming=null; }
  if(unsubCallDoc){ unsubCallDoc(); unsubCallDoc=null; }
  currentIncomingCall = null;
  activeCallId = null;
}

function showIncomingUI(callId, data){
  currentIncomingCall = { id: callId, data };
  incomingText.textContent = `Call from ${data.fromName || "unknown"} to ${data.toName || "you"}…`;

  if (!data?.deliveredAt) {
    updateDoc(doc(db,"calls", callId), {
      deliveredAt: serverTimestamp(),
      deliveredVia: "firestore",
      deliveredAtMs: Date.now()
    }).catch(()=>{});
  }

  webPageShowedNotification = true;
  console.log('Web page showing incoming call UI, marking as delivered');

  incomingOverlay.style.display = "flex";
  startRingtone();
}

function stopIncomingUI(){
  incomingOverlay.style.display = "none";
  stopRingtone();
  lastDismissedIncomingCallId = currentIncomingCall?.id || lastDismissedIncomingCallId;
  currentIncomingCall = null;
}

async function listenIncomingCalls(){
  if(!myUid) return;

  if(unsubIncoming){ unsubIncoming(); unsubIncoming=null; }

  const qy = query(
    collection(db, "calls"),
    where("toUid", "==", myUid),
    where("status", "==", "ringing"),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  unsubIncoming = onSnapshot(qy, (snap)=>{
    if(snap.empty) return;
    const d = snap.docs[0];
    const data = d.data();

    if (d.id === lastDismissedIncomingCallId) return;
    if(currentIncomingCall?.id === d.id) return;

    logDiag("Incoming call (Firestore): " + d.id);
    showIncomingUI(d.id, data);
  }, (err)=>{
    logDiag("Incoming call listener error: " + (err?.message || err));
  });
}

async function catchUpMissedRingingCall() {
  try {
    if (!myUid) return;

    const qy = query(
      collection(db, "calls"),
      where("toUid", "==", myUid),
      where("status", "==", "ringing"),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    const snap = await getDocs(qy);
    if (snap.empty) return;

    const d = snap.docs[0];
    const callId = d.id;
    const call = d.data() || {};
    if (pendingIncomingCallWhileLoggedOut?.id === callId) return;
    if (currentIncomingCall?.id === callId) return;

    const createdMs =
      (call.createdAt && typeof call.createdAt.toMillis === "function")
        ? call.createdAt.toMillis()
        : Date.now();

    roomIdInput.value = call.roomId || "";
    currentIncomingCall = { id: callId, data: call };
    incomingText.textContent = `Call from ${call.fromName || "unknown"}…`;
    incomingOverlay.style.display = "flex";
    startRingtone();

    if ("Notification" in window && Notification.permission === "granted") {
      const reg = await navigator.serviceWorker.getRegistration("/easosunov/");
      if (reg) {
        const fromName = call.fromName || "Unknown";
        const note = String(call.note || "").trim();
        const tsLocal = new Date(createdMs).toLocaleString();

        const body =  `Call from ${fromName} to ${toName}` + (note ? ` — ${note}` : "") + ` — ${tsLocal}`;

        await reg.showNotification("Incoming call", {
          body,
          tag: `webrtc-call-${myUid}`,
          renotify: true,
          requireInteraction: true,
          data: { callId, roomId: call.roomId || "", fromName, note }
        });
      }
    }

    logDiag("Catch-up: showed ringing call " + callId);
  } catch (e) {
    logDiag("catchUpMissedRingingCall failed: " + (e?.message || e));
  }
}

async function catchUpMissedCallNotification() {
  try {
    if (!myUid) return;

    const LS_LAST_MISSED = "webrtc_last_missed_call_id";
    const lastId = String(localStorage.getItem(LS_LAST_MISSED) || "");

    async function showMissed(callId, call, whenMs) {
      const fromName = call.fromName || "Unknown";
      const note = String(call.note || "").trim();
      const tsLocal = new Date(whenMs).toLocaleString();

      setStatus(dirCallStatus, `Missed call from ${fromName}.`);
      logDiag(`Catch-up: MISSED/ENDED call found ${callId} from=${fromName}`);

      if ("Notification" in window && Notification.permission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration("/easosunov/");
        if (reg) {
          const body =
            `Missed call from ${fromName} to ${toName}` + (note ? ` — ${note}` : "") + ` — ${tsLocal}`;

          await reg.showNotification("Missed call", {
            body,
            tag: `webrtc-missed-${myUid}`,
            renotify: true,
            requireInteraction: true,
            data: { callId, roomId: call.roomId || "", fromName, note }
          });
        }
      }

      localStorage.setItem(LS_LAST_MISSED, callId);
    }

    {
      const q1 = query(
        collection(db, "calls"),
        where("toUid", "==", myUid),
        where("status", "==", "missed"),
        orderBy("missedAt", "desc"),
        limit(1)
      );

      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0];
        const callId = d.id;
        const call = d.data() || {};

        if (callId && callId !== lastId &&
            pendingIncomingCallWhileLoggedOut?.id !== callId &&
            currentIncomingCall?.id !== callId) {

          const missedMs =
            (call.missedAt && typeof call.missedAt.toMillis === "function")
              ? call.missedAt.toMillis()
              : Date.now();

          await showMissed(callId, call, missedMs);
          return;
        }
      }
    }

    {
      const q2 = query(
        collection(db, "calls"),
        where("toUid", "==", myUid),
        where("status", "==", "ended"),
        orderBy("endedAt", "desc"),
        limit(5)
      );

      const s2 = await getDocs(q2);
      if (s2.empty) return;

      for (const docSnap of s2.docs) {
        const callId = docSnap.id;
        const call = docSnap.data() || {};

        const hadAccept = !!call.acceptedAt;
        const hadDecline = !!call.declinedAt;
        if (hadAccept || hadDecline) continue;

        if (callId && callId !== lastId &&
            pendingIncomingCallWhileLoggedOut?.id !== callId &&
            currentIncomingCall?.id !== callId) {

          const endedMs =
            (call.endedAt && typeof call.endedAt.toMillis === "function")
              ? call.endedAt.toMillis()
              : Date.now();

          await showMissed(callId, call, endedMs);
          return;
        }
      }
    }

  } catch (e) {
    logDiag("catchUpMissedCallNotification failed: " + (e?.message || e));
  }
}

function cleanupCallUI(){
  hangupBtn.disabled = true;
  activeCallId = null;
  if(unsubCallDoc){ unsubCallDoc(); unsubCallDoc=null; }
  pinnedRoomId = null;
}

function listenActiveCall(callId){
  if(unsubCallDoc){ unsubCallDoc(); unsubCallDoc=null; }

  unsubCallDoc = onSnapshot(doc(db,"calls", callId), (s)=>{
    if(!s.exists()) return;
    const d = s.data();
    if(!d) return;

    if(d.status === "ended"){
      stopRingback();
      setStatus(dirCallStatus, "Ended.");
      logDiag("Call ended (remote).");
      cleanupCallUI();
      stopAll();
      return;
    }

    if(d.status === "accepted"){
      stopRingback();
      setStatus(dirCallStatus, "Answered. Connecting…");
      return;
    }
    if(d.status === "declined"){
      stopRingback();
      setStatus(dirCallStatus, "Declined.");
      logDiag("Call declined.");
      cleanupCallUI();
      return;
    }
    if(d.status === "missed"){
      stopRingback();
      setStatus(dirCallStatus, "Missed.");
      logDiag("Call missed.");
      cleanupCallUI();
      return;
    }

    if (d.deliveredAt) {
      setStatus(dirCallStatus, "Delivered (callee page open).");
      return;
    }

    const stage = d.push?.stage || "";
    if (stage === "sent") { setStatus(dirCallStatus, "Push sent (waiting for answer)..."); return; }
    if (stage === "no_tokens") { setStatus(dirCallStatus, "No push tokens for callee (tab must be open)."); return; }
    if (stage === "error") { setStatus(dirCallStatus, "Push error (see call doc push.error)."); return; }

    setStatus(dirCallStatus, "Ringing…");
  });
}

async function hangup(){
  stopRingback();
  if (activeCallId) {
    try{
      const callRef = doc(db, "calls", activeCallId);
      const snap = await getDoc(callRef);

      if (snap.exists()) {
        const call = snap.data() || {};
        if (call.status === "ringing") {
          await updateDoc(callRef, {
            status: "missed",
            missedAt: serverTimestamp(),
            endedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(callRef, {
            status: "ended",
            endedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }catch(e){
      showError(e);
    }
  }

  stopAll();
  cleanupCallUI();
  setStatus(dirCallStatus, "Ended.");
}

answerBtn.onclick = async ()=>{
  try{
    const call = currentIncomingCall;
    stopIncomingUI();

    if(!call){
      setStatus(dirCallStatus, "No call context. Please wait for the caller again.");
      return;
    }

    const { id, data } = call;

    await updateDoc(doc(db,"calls", id), {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    webPageShowedNotification = false;
    localStorage.removeItem('pendingNotificationCall');

    activeCallId = id;
    hangupBtn.disabled = false;
    listenActiveCall(id);

    roomIdInput.value = data.roomId;

    setStatus(dirCallStatus, `Answered ${data.fromName || ""}. Joining room…`);

    await joinRoom();

    try { await listenIncomingCalls(); } catch {}
  }catch(e){
    showError(e);
  }
};

declineBtn.onclick = async ()=>{
  try{
    const call = currentIncomingCall;
    stopIncomingUI();

    if(!call) return;

    const { id } = call;
    await updateDoc(doc(db,"calls", id), {
      status: "declined",
      declinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    webPageShowedNotification = false;
    localStorage.removeItem('pendingNotificationCall');

    setStatus(dirCallStatus, "Declined incoming call.");
    try { await listenIncomingCalls(); } catch {}
  }catch(e){
    showError(e);
  }
};

// ==================== USER DIRECTORY MANAGEMENT ====================
let myDisplayName = "";
let allUsersCache = [];

function defaultNameFromEmail(email){
  const e = String(email || "").trim();
  if(!e) return "";
  return e.split("@")[0].slice(0, 24);
}

async function ensureMyUserProfile(user){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  const existing = snap.exists() ? (snap.data() || {}) : {};
  const name = existing.displayName || defaultNameFromEmail(user.email);

  await setDoc(ref, {
    uid: user.uid,
    displayName: name,
    updatedAt: serverTimestamp()
  }, { merge: true });

  myDisplayName = name;
  myNameInput.value = name || "";
  myNameStatus.textContent = name ? `Saved: ${name}` : "Not set.";
}

async function saveMyName(){
  if(!requireAuthOrPrompt()) return;

  const name = String(myNameInput.value || "").trim();
  if(!name) throw new Error("Name cannot be empty.");
  if(name.length > 40) throw new Error("Name is too long (max 40).");

  await setDoc(doc(db, "users", myUid), {
    displayName: name,
    updatedAt: serverTimestamp()
  }, { merge:true });

  myDisplayName = name;
  myNameStatus.textContent = `Saved: ${name}`;
  logDiag("Saved displayName=" + name);
}

function chunk(arr, n){
  const out = [];
  for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i, i+n));
  return out;
}

function renderUsersList(filterText=""){
  const q = String(filterText || "").trim().toLowerCase();
  const rows = allUsersCache
    .filter(u => u.uid !== myUid)
    .filter(u => !q || String(u.displayName||"").toLowerCase().includes(q))
    .sort((a,b)=> String(a.displayName||"").localeCompare(String(b.displayName||"")));

  usersList.innerHTML = "";

  if(rows.length === 0){
    usersList.innerHTML = `<div class="small" style="color:#777">No users found.</div>`;
    return;
  }

  for(const u of rows){
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "space-between";
    div.style.gap = "10px";
    div.style.border = "1px solid #eee";
    div.style.borderRadius = "10px";
    div.style.padding = "10px";

    const left = document.createElement("div");
    left.innerHTML = `<b>${u.displayName || "(no name)"}</b>`;

    const btn = document.createElement("button");
    btn.textContent = "Call";
    btn.disabled = !isAuthed;
    btn.onclick = ()=> startCallToUid(u.uid, u.displayName).catch(showError);

    div.appendChild(left);
    div.appendChild(btn);
    usersList.appendChild(div);
  }
}

async function loadAllAllowedUsers(){
  if(!requireAuthOrPrompt()) return;

  const alSnap = await getDocs(
    query(collection(db,"allowlistUids"), where("enabled","==",true), limit(200))
  );
  const uids = alSnap.docs.map(d => d.id).filter(Boolean);

  const users = [];
  for(const group of chunk(uids, 10)){
    const usSnap = await getDocs(query(collection(db,"users"), where(documentId(), "in", group)));
    usSnap.forEach(docu => {
      const d = docu.data() || {};
      users.push({ uid: docu.id, displayName: d.displayName || "" });
    });
  }

  allUsersCache = users;
  renderUsersList(userSearchInput.value);
  logDiag("Loaded users directory: " + users.length);
}

async function startCallToUid(toUid, toName=""){
  logDiag("startCallToUid(): ENTER toUid=" + toUid);

  if(!requireAuthOrPrompt()) return;
  if(!toUid) throw new Error("Missing toUid.");
  if(toUid === myUid) throw new Error("You can't call yourself.");

  setStatus(dirCallStatus, "Creating room…");
  const created = await createRoom({ updateHash:false, reuseRoomIdInput:false, fixedRoomId:null });
  if(!created?.roomId) throw new Error("Room creation failed.");

  pinnedRoomId = created.roomId;

  const note = String(callNoteInput?.value || "").trim().slice(0, 140);

  const callRef = await addDoc(collection(db,"calls"), {
    fromUid: myUid,
    toUid,
    fromName: myDisplayName || defaultNameFromEmail(emailInput.value) || "(unknown)",
    toName: toName || "",
    roomId: created.roomId,
    note,
    status: "ringing",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    acceptedAt: null,
    declinedAt: null,
    endedAt: null
  });

  activeCallId = callRef.id;
  try {
    const messagePayload = {
      toUid,
      callId: callRef.id,
      fromName: myDisplayName || defaultNameFromEmail(emailInput.value),
      note: note,
      timestamp: new Date().toLocaleString(),
      sentAtMs: Date.now(),
    };
    await sendIncomingCallNotification(messagePayload);
  } catch (e) {
    console.error("Error sending incoming call push notification:", e);
  }

  hangupBtn.disabled = false;
  listenActiveCall(activeCallId);
  setStatus(dirCallStatus, `Calling ${toName || "user"}…`);
  startRingback();
  logDiag(`Outgoing call created: ${callRef.id} roomId=${created.roomId}`);
  sendIncomingCallNotification({
    callId: callRef.id,
    fromName: myDisplayName,
    toUid: toUid,
    note: note,
    roomId: created.roomId,
  });

  async function sendIncomingCallNotification(message) {
    try {
      const response = await fetch("/easosunov/sendIncomingPush", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error("Failed to send incoming call push notification");
      }

      const data = await response.json();
      console.log("Incoming call push notification sent:", data);
    } catch (error) {
      console.error("Error sending incoming call notification:", error);
    }
  }
}

// ==================== PUSH NOTIFICATION MANAGEMENT ====================
let messaging = null;
let swReg = null;
let lastPushUid = null;

async function rotateFcmTokenIfUserChanged(){
  try{
    if(!("Notification" in window)) return;
    if(!("serviceWorker" in navigator)) return;
    if(Notification.permission !== "granted") return;

    if(lastPushUid && myUid && lastPushUid !== myUid){
      logDiag(`Push: user changed ${lastPushUid} -> ${myUid}. Deleting old FCM token`);

      if(!messaging){
        messaging = getMessaging(app);
      }

      await deleteToken(messaging);
      logDiag("Push: deleteToken() success");
    }

    lastPushUid = myUid || null;
  }catch(e){
    logDiag("rotateFcmTokenIfUserChanged failed: " + (e?.message || e));
  }
}

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

async function enablePush(){
  logDiag("enablePush(): ENTER");
  if(!requireAuthOrPrompt()) return;

  const prev = getSavedPushBinding();
  if(prev.uid && prev.uid !== myUid){
    await revokePushForCurrentDevice();
  }
  
  if (!("Notification" in window)) { setStatus(pushStatus, "Push: not supported in this browser."); return; }
  if (!("serviceWorker" in navigator)) { setStatus(pushStatus, "Push: service worker not supported."); return; }
  if(!PUBLIC_VAPID_KEY || PUBLIC_VAPID_KEY.includes("PASTE_")) { setStatus(pushStatus, "Push: set PUBLIC_VAPID_KEY in HTML first."); return; }

  try {
    const swUrl = new URL("/easosunov/firebase-messaging-sw.js", location.origin);
    swUrl.searchParams.set("v", "2026-01-03-sw-note-ts-1");

    const resp = await fetch(swUrl.toString(), { cache: "no-store" });
    const ct = resp.headers.get("content-type") || "";
    const txt = await resp.text();
    logDiag("SW prefetch url=" + swUrl.toString());
    logDiag("SW prefetch status=" + resp.status + " content-type=" + ct);
    logDiag("SW prefetch first200=" + txt.slice(0, 200).replace(/\s+/g, " "));
    if (!resp.ok) throw new Error("SW fetch failed: " + resp.status);

    swReg = swBootstrapReg || await navigator.serviceWorker.getRegistration("/easosunov/");
    if (!swReg) throw new Error("Service worker not installed (bootstrap failed).");

    await navigator.serviceWorker.ready;
    try { await swReg.update(); } catch {}

    messaging = getMessaging(app);

    const perm = await Notification.requestPermission();
    if (perm !== "granted"){ setStatus(pushStatus, "Push: permission not granted."); return; }

    const check = validateVapid(VAPID);
    logDiag("VAPID check: " + check.ok + " - " + check.why);
    if (!check.ok) throw new Error("Invalid VAPID: " + check.why);

    const token = await getToken(messaging, {
      vapidKey: VAPID,
      serviceWorkerRegistration: swReg
    });

    if(!token){ setStatus(pushStatus, "Push: no token returned."); return; }

    const tokenId = token.slice(0, 32);

    await setDoc(doc(db, "users", myUid, "fcmTokens", tokenId), {
      token,
      createdAt: Date.now(),
      ua: navigator.userAgent,
      enabled: true
    }, { merge:true });
    
    savePushBinding(myUid, tokenId);

    setStatus(pushStatus, "Push: enabled.");
    logDiag("FCM token stored (users/{uid}/fcmTokens).");

    onMessage(messaging, async (payload)=>{
      try{
        logDiag("FCM foreground message: " + JSON.stringify(payload));
        const data = payload?.data || {};

        if(!isAuthed || !myUid) {
          logDiag("Ignoring FCM: not authed");
          return;
        }

        if (data.callId) {
          const callRef = doc(db, "calls", data.callId);
          const callSnap = await getDoc(callRef);
          if(!callSnap.exists()){
            logDiag("Ignoring FCM: call doc missing");
            return;
          }
          const call = callSnap.data() || {};

          if(call.toUid !== myUid){
            logDiag(`Ignoring FCM: call toUid=${call.toUid} does not match myUid=${myUid}`);
            return;
          }

          if (call.roomId) roomIdInput.value = call.roomId;
          currentIncomingCall = { id: data.callId, data: call };

          incomingText.textContent =
            payload?.notification?.body ||
            (call.fromName ? `Call from ${call.fromName}` : "Incoming call…");

          incomingOverlay.style.display = "flex";
          startRingtone();
          return;
        }

        logDiag("Ignoring FCM: not a callId payload");
      }catch(e){
        logDiag("onMessage handler error: " + (e?.message || e));
      }
    });

  } catch (e) {
    setStatus(pushStatus, "Push: failed (see diagnostics).");
    try { logDiag("Push error props: " + JSON.stringify(e, Object.getOwnPropertyNames(e))); } catch {}
    logDiag("Push enable failed: " + (e?.message || e));
    showError(e);
  }
}

let autoPushClickArmed = false;

function autoEnablePushOnLogin(){
  if (!("Notification" in window)) { setStatus(pushStatus, "Push: not supported in this browser."); return; }
  if (!("serviceWorker" in navigator)) { setStatus(pushStatus, "Push: service worker not supported."); return; }

  const perm = Notification.permission;

  if (perm === "granted") {
    logDiag("Auto-push: permission granted -> enabling push now");
    enablePush().catch((e)=> logDiag("Auto-push enable failed: " + (e?.message || e)));
    return;
  }

  if (perm === "denied") {
    setStatus(pushStatus, "Push: blocked in browser settings (Notifications = Block).");
    logDiag("Auto-push: permission denied");
    return;
  }

  setStatus(pushStatus, "Push: click anywhere once to enable notifications.");
  if (autoPushClickArmed) return;
  autoPushClickArmed = true;

  const handler = () => {
    autoPushClickArmed = false;
    logDiag("Auto-push: user click detected -> enabling push");
    enablePush().catch((e)=>{ logDiag("Auto-push enable failed: " + (e?.message || e)); showError(e); });
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
refreshCopyInviteState();

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

downloadBgLink.onclick = (e) => {
  console.log('Downloading background app...');
};

// ==================== AUTH STATE LISTENER ====================
onAuthStateChanged(auth, async (user)=>{
  isAuthed = !!user;
  myUid = user?.uid || null;
  logDiag(isAuthed ? "Auth: signed in" : "Auth: signed out");

  if (isAuthed){
    try{ await enforceAllowlist(user); }
    catch(e){
      showError(e);
      loginOverlay.style.display = "flex";
      appRoot.classList.add("locked");
      logoutBtn.style.display = "none";
      startBtn.disabled = true;
      return;
    }

    setDeviceOwner(user.uid);
    broadcastNewOwner(user.uid);

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

    await rotateFcmTokenIfUserChanged();
    autoEnablePushOnLogin();

    saveNameBtn.disabled = !String(myNameInput.value||"").trim();
    refreshUsersBtn.disabled = false;

    hangupBtn.disabled = true;

    refreshCopyInviteState();

    try{ await listenIncomingCalls(); } catch(e){ logDiag("Incoming listener failed: " + (e?.message || e)); }
    await catchUpMissedRingingCall();
    await catchUpMissedCallNotification();
    try{ await ensureMyUserProfile(user); } catch(e){ logDiag("ensureMyUserProfile failed: " + (e?.message || e)); }
    try{ await loadAllAllowedUsers(); } catch(e){ logDiag("loadAllAllowedUsers failed: " + (e?.message || e)); }

    await processPendingNotifications();

    if (pendingIncomingCallWhileLoggedOut?.id) {
      const callId = pendingIncomingCallWhileLoggedOut.id;
      updateDoc(doc(db,"calls", callId), {
        deliveredAt: serverTimestamp(),
        deliveredVia: "push_open"
      }).catch(()=>{});
    }

    updateServiceStatus();
    setInterval(updateServiceStatus, 30000);

    window.addEventListener("click", () => startMedia().catch(()=>{}), { once:true });

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
