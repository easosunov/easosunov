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
console.log("APP VERSION:", "2026-01-08-status-fix");
const MISSED_CALL_TIMEOUT_MS = 60000;
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
  swUrl.searchParams.set("v", "2026-01-08-bootstrap");

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

// ==================== CONFIGURATION ====================
const PUBLIC_VAPID_KEY = "BCR4B8uf0WzUuzHKlBCJO22NNnnupe88j8wkjrTwwQALDpWUeJ3umtIkNJTrLb0I_LeIeu2HyBNbogHc6Y7jNzM";

function cleanVapidKey(k){
  return String(k || "").trim().replace(/[\r\n\s]/g, "");
}
const VAPID = cleanVapidKey(PUBLIC_VAPID_KEY);

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

// WebRTC states
let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let currentIncomingCall = null;
let activeCallId = null;
let lastDismissedIncomingCallId = null;

// Connection tracking
let connectionEstablished = false;
let currentCallType = null; // 'incoming' or 'outgoing'

// Firestore listeners
let unsubRoomA = null, unsubCalleeA = null;
let unsubRoomB = null, unsubCallerB = null;
let unsubIncoming = null;
let unsubCallDoc = null;

// Push notification states
let messaging = null;
let swReg = null;
let lastPushUid = null;

// ==================== ENHANCED LOGGING SYSTEM ====================
const diagLog = [];
let diagVisible = false;

function logDiag(msg){
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  diagLog.push(line);
  console.log(line);
  
  // Update diagnostics box if visible
  if (diagVisible && window.diagBox) {
    window.diagBox.textContent = diagLog.join("\n");
    window.diagBox.scrollTop = window.diagBox.scrollHeight;
  }
  
  // Update button states
  if (window.copyDiagBtn) window.copyDiagBtn.disabled = diagLog.length === 0;
  if (window.clearDiagBtn) window.clearDiagBtn.disabled = diagLog.length === 0;
}

// ==================== DOM ELEMENT REFERENCES ====================
function initializeDomElements() {
  window.errorBox = document.getElementById("errorBox");
  window.loginOverlay = document.getElementById("loginOverlay");
  window.loginBtn = document.getElementById("loginBtn");
  window.logoutBtn = document.getElementById("logoutBtn");
  window.loginStatus = document.getElementById("loginStatus");
  window.emailInput = document.getElementById("emailInput");
  window.passInput = document.getElementById("passInput");
  window.appRoot = document.getElementById("app");

  window.localVideo = document.getElementById("localVideo");
  window.remoteVideo = document.getElementById("remoteVideo");
  window.startBtn = document.getElementById("startBtn");
  window.createBtn = document.getElementById("createBtn");
  window.joinBtn = document.getElementById("joinBtn");
  window.copyLinkBtn = document.getElementById("copyLinkBtn");
  window.roomIdInput = document.getElementById("roomId");
  window.mediaStatus = document.getElementById("mediaStatus");
  window.callStatus = document.getElementById("callStatus");
  
  window.diagBtn = document.getElementById("diagBtn");
  window.diagBox = document.getElementById("diagBox");
  window.copyDiagBtn = document.getElementById("copyDiagBtn");
  window.clearDiagBtn = document.getElementById("clearDiagBtn");
  
  window.incomingOverlay = document.getElementById("incomingOverlay");
  window.incomingText = document.getElementById("incomingText");
  window.answerBtn = document.getElementById("answerBtn");
  window.declineBtn = document.getElementById("declineBtn");
  
  window.myNameInput = document.getElementById("myNameInput");
  window.saveNameBtn = document.getElementById("saveNameBtn");
  window.refreshUsersBtn = document.getElementById("refreshUsersBtn");
  window.myNameStatus = document.getElementById("myNameStatus");
  window.userSearchInput = document.getElementById("userSearchInput");
  window.usersList = document.getElementById("usersList");
  window.dirCallStatus = document.getElementById("dirCallStatus");
  
  window.pushStatus = document.getElementById("pushStatus");
  window.testSoundBtn = document.getElementById("testSoundBtn");
  window.hangupBtn = document.getElementById("hangupBtn");
  window.resetPushBtn = document.getElementById("resetPushBtn");
  window.callNoteInput = document.getElementById("callNoteInput");
  
  window.videoQualitySelect = document.getElementById("videoQualitySelect");
  window.videoQualityStatus = document.getElementById("videoQualityStatus");
  
  window.startBgBtn = document.getElementById('startBgBtn');
  window.stopBgBtn = document.getElementById('stopBgBtn');
  window.bgStatus = document.getElementById('bgStatus');
  
  setupEventListeners();
  initializeDiagnostics();
}

// ==================== UTILITY FUNCTIONS ====================
function setStatus(el, msg) {
  if (el && el.textContent !== undefined) {
    el.textContent = msg;
  }
}

function showError(e){
  const code = e?.code ? `\ncode: ${e.code}` : "";
  const msg  = e?.message ? `\nmessage: ${e.message}` : "";
  const errorMsg = `${String(e?.stack || "")}${code}${msg}`.trim() || String(e);
  
  if (window.errorBox) {
    window.errorBox.style.display = "block";
    window.errorBox.textContent = errorMsg;
  }
  
  logDiag("ERROR: " + String(e?.code || "") + " :: " + String(e?.message || e));
  
  // Also show in call status if available
  if (window.callStatus) {
    setStatus(window.callStatus, "Error: " + (e?.message || "Unknown error"));
  }
}

function hideErrorBox(){
  if (window.errorBox) {
    window.errorBox.style.display = "none";
    window.errorBox.textContent = "";
  }
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

// ==================== PUSH NOTIFICATION MANAGEMENT ====================
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
  
  if (!("Notification" in window)) { 
    setStatus(window.pushStatus, "Push: not supported in this browser."); 
    return; 
  }
  
  if (!("serviceWorker" in navigator)) { 
    setStatus(window.pushStatus, "Push: service worker not supported."); 
    return; 
  }
  
  if(!PUBLIC_VAPID_KEY || PUBLIC_VAPID_KEY.includes("PASTE_")) { 
    setStatus(window.pushStatus, "Push: VAPID key not configured."); 
    return; 
  }

  try {
    // Ensure service worker is registered
    await ensureServiceWorkerInstalled();
    
    swReg = swBootstrapReg || await navigator.serviceWorker.getRegistration("/easosunov/");
    if (!swReg) throw new Error("Service worker not installed");

    messaging = getMessaging(app);

    const perm = await Notification.requestPermission();
    if (perm !== "granted"){ 
      setStatus(window.pushStatus, "Push: permission not granted."); 
      return; 
    }

    const check = validateVapid(VAPID);
    logDiag("VAPID check: " + check.ok + " - " + check.why);
    if (!check.ok) throw new Error("Invalid VAPID: " + check.why);

    const token = await getToken(messaging, {
      vapidKey: VAPID,
      serviceWorkerRegistration: swReg
    });

    if(!token){ 
      setStatus(window.pushStatus, "Push: no token returned."); 
      return; 
    }

    const tokenId = token.slice(0, 32);

    await setDoc(doc(db, "users", myUid, "fcmTokens", tokenId), {
      token,
      createdAt: Date.now(),
      ua: navigator.userAgent,
      enabled: true,
      platform: navigator.platform
    }, { merge:true });
    
    savePushBinding(myUid, tokenId);

    setStatus(window.pushStatus, "✅ Push: enabled.");
    logDiag("FCM token stored (users/{uid}/fcmTokens).");

    // Listen for foreground messages
    onMessage(messaging, async (payload)=>{
      try{
        logDiag("FCM foreground message received: " + JSON.stringify(payload));
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

          if (call.roomId) window.roomIdInput.value = call.roomId;
          currentIncomingCall = { id: data.callId, data: call };

          // Fix: Format notification text properly
          const fromName = call.fromName || "Unknown";
          const toName = call.toName || "you";
          window.incomingText.textContent = `Call from ${fromName} to ${toName}…`;

          window.incomingOverlay.style.display = "flex";
          startRingtone();
          return;
        }

        logDiag("Ignoring FCM: not a callId payload");
      }catch(e){
        logDiag("onMessage handler error: " + (e?.message || e));
      }
    });

  } catch (e) {
    setStatus(window.pushStatus, "❌ Push: failed (see diagnostics).");
    try { logDiag("Push error props: " + JSON.stringify(e, Object.getOwnPropertyNames(e))); } catch {}
    logDiag("Push enable failed: " + (e?.message || e));
    showError(e);
  }
}

let autoPushClickArmed = false;

function autoEnablePushOnLogin(){
  if (!("Notification" in window)) { 
    setStatus(window.pushStatus, "Push: not supported in this browser."); 
    return; 
  }
  
  if (!("serviceWorker" in navigator)) { 
    setStatus(window.pushStatus, "Push: service worker not supported."); 
    return; 
  }

  const perm = Notification.permission;

  if (perm === "granted") {
    logDiag("Auto-push: permission granted -> enabling push now");
    enablePush().catch((e)=> logDiag("Auto-push enable failed: " + (e?.message || e)));
    return;
  }

  if (perm === "denied") {
    setStatus(window.pushStatus, "Push: blocked in browser settings (Notifications = Block).");
    logDiag("Auto-push: permission denied");
    return;
  }

  setStatus(window.pushStatus, "Push: click anywhere once to enable notifications.");
  if (autoPushClickArmed) return;
  autoPushClickArmed = true;

  const handler = () => {
    autoPushClickArmed = false;
    logDiag("Auto-push: user click detected -> enabling push");
    enablePush().catch((e)=>{ logDiag("Auto-push enable failed: " + (e?.message || e)); showError(e); });
  };

  window.addEventListener("click", handler, { once:true, capture:true });
}

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
    window.bgStatus.textContent = 'Connecting to background service...';
    
    const response = await fetch('http://localhost:3000/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: myUid
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      window.bgStatus.textContent = '✅ Background service active';
      window.startBgBtn.disabled = true;
      window.stopBgBtn.disabled = false;
      logDiag('Background service started for UID: ' + myUid);
    } else {
      throw new Error(data.error || 'Failed to start');
    }
  } catch (error) {
    window.bgStatus.textContent = '❌ Failed to connect';
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
      window.bgStatus.textContent = 'Background service stopped';
      window.startBgBtn.disabled = false;
      window.stopBgBtn.disabled = true;
      logDiag('Background service stopped');
    }
  } catch (error) {
    logDiag('Error stopping background service: ' + error.message);
  }
}

async function updateServiceStatus() {
  if (isAuthed) {
    window.startBgBtn.disabled = false;
    
    try {
      const status = await checkBackgroundService();
      if (status.isRunning && status.uid === myUid) {
        window.bgStatus.textContent = '✅ Background service active';
        window.startBgBtn.disabled = true;
        window.stopBgBtn.disabled = false;
      } else {
        window.bgStatus.textContent = 'Background service ready';
        window.stopBgBtn.disabled = true;
      }
    } catch (error) {
      window.bgStatus.textContent = 'Background app not detected';
      window.stopBgBtn.disabled = true;
    }
  } else {
    window.startBgBtn.disabled = true;
    window.stopBgBtn.disabled = true;
    window.bgStatus.textContent = 'Sign in required';
  }
}

// ==================== MEDIA FUNCTIONS ====================
const VIDEO_PROFILES = {
  low:    { label: "Low (360p)",    constraints: { width:{ideal:640},  height:{ideal:360},  frameRate:{ideal:15, max:15} } },
  medium: { label: "Medium (720p)", constraints: { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30, max:30} } },
  high:   { label: "High (1080p)",  constraints: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30, max:30} } },
};

let selectedVideoQuality = "medium";

async function startMedia() {
  if (!requireAuthOrPrompt()) {
    logDiag("Cannot start media: not authenticated");
    return;
  }

  if (localStream) {
    logDiag("Media already started");
    return;
  }

  hideErrorBox();
  setStatus(window.mediaStatus, "Requesting camera/mic…");
  logDiag("Starting media with getUserMedia...");

  const profile = VIDEO_PROFILES[selectedVideoQuality] || VIDEO_PROFILES.medium;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: profile.constraints,
      audio: true
    });

    if (window.localVideo) {
      window.localVideo.srcObject = localStream;
      
      window.localVideo.onloadedmetadata = async () => {
        try {
          await window.localVideo.play();
          setStatus(window.mediaStatus, "✅ Camera/mic started.");
          logDiag("Local video playing successfully");
        } catch (e) {
          logDiag("Video play error: " + e.message);
          setStatus(window.mediaStatus, "Camera/mic started (playback issue).");
        }
      };
    }

    // Enable WebRTC buttons
    if (window.startBtn) window.startBtn.disabled = true;
    if (window.createBtn) window.createBtn.disabled = false;
    if (window.joinBtn) window.joinBtn.disabled = false;

    // Load ICE servers
    await loadIceServers();

    logDiag("Media started successfully with " + selectedVideoQuality + " quality");

  } catch (e) {
    const errorMsg = "Failed to start media: " + e.name + " - " + e.message;
    setStatus(window.mediaStatus, errorMsg);
    logDiag("getUserMedia error: " + e.message);
    
    // Reset state on error
    localStream = null;
    if (window.startBtn) window.startBtn.disabled = false;
    if (window.createBtn) window.createBtn.disabled = true;
    if (window.joinBtn) window.joinBtn.disabled = true;
    
    throw e;
  }
}

async function loadIceServers() {
  logDiag("Fetching ICE servers…");
  try {
    const r = await fetch("https://turn-token.easosunov.workers.dev/ice");
    if (!r.ok) throw new Error("ICE fetch failed: " + r.status);
    const data = await r.json();
    rtcConfig = { iceServers: data.iceServers };
    logDiag("ICE servers loaded: " + (data.iceServers?.length || 0));
  } catch (e) {
    logDiag("ICE server load failed, using fallback: " + e.message);
    rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  }
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

function updateVideoQualityUi(){
  if (window.videoQualitySelect) {
    window.videoQualitySelect.value = selectedVideoQuality;
  }
  const label = VIDEO_PROFILES[selectedVideoQuality]?.label || "Medium (720p)";
  if (window.videoQualityStatus) {
    window.videoQualityStatus.textContent = `Video: ${label}.`;
  }
}

// ==================== WEBRTC PEER CONNECTION FUNCTIONS ====================
function closePeer(){
  if(pc){
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try{ pc.close(); }catch{}
    pc = null;
  }
  if (window.remoteVideo) window.remoteVideo.srcObject = null;
  connectionEstablished = false;
  currentCallType = null;
}

async function ensurePeer() {
  closePeer();

  if (!rtcConfig || !rtcConfig.iceServers || rtcConfig.iceServers.length === 0) {
    await loadIceServers();
  }

  pc = new RTCPeerConnection(rtcConfig);
  logDiag("Created RTCPeerConnection with ICE servers");

  const rs = new MediaStream();
  if (window.remoteVideo) {
    window.remoteVideo.srcObject = rs;
  }

  pc.ontrack = (e) => {
    if (e.streams[0]) {
      e.streams[0].getTracks().forEach(t => rs.addTrack(t));
      if (window.remoteVideo) {
        window.remoteVideo.muted = false;
        window.remoteVideo.play().catch(e => {
          logDiag("Remote video play error: " + e.message);
        });
      }
      logDiag(`Received remote track: ${e.streams[0].getTracks().map(t=>t.kind).join(",")}`);
    }
  };

  pc.onconnectionstatechange = () => { 
    if (pc) {
      const state = pc.connectionState;
      logDiag("Peer connection state: " + state);
      
      // Update status based on connection state
      if (state === "connected") {
        connectionEstablished = true;
        if (currentCallType === 'incoming') {
          setStatus(window.dirCallStatus, "✅ Connected (incoming call)");
        } else if (currentCallType === 'outgoing') {
          setStatus(window.dirCallStatus, "✅ Connected (outgoing call)");
        } else {
          setStatus(window.dirCallStatus, "✅ Connected");
        }
        setStatus(window.callStatus, "✅ Connected");
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        connectionEstablished = false;
        if (window.callStatus) {
          setStatus(window.callStatus, `Connection: ${state}`);
        }
      } else {
        if (window.callStatus) {
          setStatus(window.callStatus, `Connection: ${state}`);
        }
      }
    }
  };
  
  pc.oniceconnectionstatechange = () => { 
    if (pc) {
      logDiag("ICE connection state: " + pc.iceConnectionState);
    }
  };

  if (!localStream) throw new Error("Local media not started.");
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  
  logDiag("Local tracks added to peer connection");
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
    logDiag("Audio context unlocked");
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

function startRingback() {
  stopRingback();

  try {
    unlockAudio();
    
    // Play more frequent ringback tones
    playRingbackBeepOnce();
    
    ringbackTimer = setInterval(() => {
      playRingbackBeepOnce();
      setTimeout(() => playRingbackBeepOnce(), 250);
      setTimeout(() => playRingbackBeepOnce(), 500);
    }, 2000); // Repeat every 2 seconds
    
  } catch (e) {
    console.warn("Could not start ringback:", e);
  }
}

function stopRingback(){
  if(ringbackTimer){
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
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

function stopListeners(){
  if(unsubRoomA){ unsubRoomA(); unsubRoomA=null; }
  if(unsubCalleeA){ unsubCalleeA(); unsubCalleeA=null; }
  if(unsubRoomB){ unsubRoomB(); unsubRoomB=null; }
  if(unsubCallerB){ unsubCallerB(); unsubCallerB=null; }
}

function stopCallListeners(){
  if(unsubIncoming){ unsubIncoming(); unsubIncoming=null; }
  if(unsubCallDoc){ unsubCallDoc(); unsubCallDoc=null; }
  currentIncomingCall = null;
  activeCallId = null;
}

// ==================== CALL MANAGEMENT ====================
function showIncomingUI(callId, data){
  currentIncomingCall = { id: callId, data };
  
  // FIX: Properly format the notification text
  const fromName = data.fromName || "unknown";
  const toName = data.toName || "you";
  const callText = `Call from ${fromName} to ${toName}…`;
  
  if (window.incomingText) {
    window.incomingText.textContent = callText;
  }

  if (window.incomingOverlay) {
    window.incomingOverlay.style.display = "flex";
  }
  startRingtone();
  
  logDiag(`Showing incoming call UI: ${callText}`);
  
  // Mark as delivered
  updateDoc(doc(db,"calls", callId), {
    deliveredAt: serverTimestamp(),
    deliveredVia: "web_page",
    deliveredAtMs: Date.now()
  }).catch(()=>{
    logDiag("Failed to update delivered status");
  });
}

function stopIncomingUI(){
  if (window.incomingOverlay) {
    window.incomingOverlay.style.display = "none";
  }
  stopRingtone();
  lastDismissedIncomingCallId = currentIncomingCall?.id || lastDismissedIncomingCallId;
  currentIncomingCall = null;
}

async function listenIncomingCalls(){
  if(!myUid) return;

  if(unsubIncoming){ 
    unsubIncoming(); 
    unsubIncoming = null;
  }

  logDiag("Setting up incoming call listener for UID: " + myUid);

  const qy = query(
    collection(db, "calls"),
    where("toUid", "==", myUid),
    where("status", "==", "ringing"),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  unsubIncoming = onSnapshot(qy, (snap)=>{
    if(snap.empty) {
      logDiag("No incoming calls found");
      return;
    }
    
    const doc = snap.docs[0];
    const data = doc.data();
    const callId = doc.id;

    if (callId === lastDismissedIncomingCallId) {
      logDiag(`Ignoring dismissed call: ${callId}`);
      return;
    }
    
    if(currentIncomingCall?.id === callId) {
      logDiag(`Already showing this call: ${callId}`);
      return;
    }

    logDiag("Incoming call detected: " + callId + " from " + data.fromName);
    showIncomingUI(callId, data);
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
    
    if (currentIncomingCall?.id === callId) return;

    if (call.roomId) window.roomIdInput.value = call.roomId;
    currentIncomingCall = { id: callId, data: call };
    
    // FIX: Properly format the text
    const fromName = call.fromName || "unknown";
    const toName = call.toName || "you";
    window.incomingText.textContent = `Call from ${fromName} to ${toName}…`;
    
    window.incomingOverlay.style.display = "flex";
    startRingtone();

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
      const toName = call.toName || "you";
      const note = String(call.note || "").trim();
      const tsLocal = new Date(whenMs).toLocaleString();

      setStatus(window.dirCallStatus, `Missed call from ${fromName}.`);
      logDiag(`Catch-up: MISSED/ENDED call found ${callId} from=${fromName}`);

      if ("Notification" in window && Notification.permission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration("/easosunov/");
        if (reg) {
          const body = `Missed call from ${fromName} to ${toName}` + (note ? ` — ${note}` : "") + ` — ${tsLocal}`;
          await reg.showNotification("Missed call", {
            body,
            tag: `webrtc-missed-${myUid}`,
            renotify: true,
            requireInteraction: false,
            data: { callId, roomId: call.roomId || "", fromName, note }
          });
        }
      }

      localStorage.setItem(LS_LAST_MISSED, callId);
    }

    // Check for missed calls
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
          currentIncomingCall?.id !== callId) {

        const missedMs =
          (call.missedAt && typeof call.missedAt.toMillis === "function")
            ? call.missedAt.toMillis()
            : Date.now();

        await showMissed(callId, call, missedMs);
        return;
      }
    }

  } catch (e) {
    logDiag("catchUpMissedCallNotification failed: " + (e?.message || e));
  }
}

function listenActiveCall(callId){
  if(unsubCallDoc){ 
    unsubCallDoc(); 
    unsubCallDoc = null;
  }

  logDiag("Listening to active call: " + callId);

  unsubCallDoc = onSnapshot(doc(db,"calls", callId), (snapshot)=>{
    if(!snapshot.exists()) {
      logDiag("Call document no longer exists");
      return;
    }
    
    const data = snapshot.data();
    if(!data) return;

    logDiag(`Call ${callId} status update: ${data.status}`);

    if(data.status === "ended"){
      stopRingback();
      setStatus(window.dirCallStatus, "Call ended.");
      logDiag("Call ended (remote).");
      cleanupCallUI();
      stopAll();
      return;
    }

    if(data.status === "accepted"){
      stopRingback();
      setStatus(window.dirCallStatus, "✅ Call answered. Connecting…");
      logDiag("Call accepted by remote party");
      return;
    }
    
    if(data.status === "declined"){
      stopRingback();
      setStatus(window.dirCallStatus, "❌ Call declined.");
      logDiag("Call declined by remote party.");
      cleanupCallUI();
      return;
    }
    
    if(data.status === "missed"){
      stopRingback();
      setStatus(window.dirCallStatus, "Missed call.");
      logDiag("Call missed.");
      cleanupCallUI();
      return;
    }

    setStatus(window.dirCallStatus, "Ringing…");
  }, (error) => {
    logDiag("Active call listener error: " + error.message);
  });
}

function cleanupCallUI(){
  if (window.hangupBtn) window.hangupBtn.disabled = true;
  activeCallId = null;
  if(unsubCallDoc){ 
    unsubCallDoc(); 
    unsubCallDoc = null;
  }
}

async function hangup(){
  logDiag("Hanging up call");
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
          logDiag("Marked call as missed");
        } else {
          await updateDoc(callRef, {
            status: "ended",
            endedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          logDiag("Marked call as ended");
        }
      }
    }catch(e){
      logDiag("Error updating call status: " + e.message);
      showError(e);
    }
  }

  stopAll();
  cleanupCallUI();
  setStatus(window.dirCallStatus, "Call ended.");
}

// ==================== USER DIRECTORY MANAGEMENT ====================
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
    email: user.email,
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  myDisplayName = name;
  if (window.myNameInput) window.myNameInput.value = name || "";
  if (window.myNameStatus) window.myNameStatus.textContent = name ? `✅ Saved: ${name}` : "Not set.";
  
  logDiag("User profile ensured: " + name);
}

async function saveMyName(){
  if(!requireAuthOrPrompt()) return;

  const name = String(window.myNameInput?.value || "").trim();
  if(!name) throw new Error("Name cannot be empty.");
  if(name.length > 40) throw new Error("Name is too long (max 40).");

  await setDoc(doc(db, "users", myUid), {
    displayName: name,
    updatedAt: serverTimestamp()
  }, { merge:true });

  myDisplayName = name;
  if (window.myNameStatus) window.myNameStatus.textContent = `✅ Saved: ${name}`;
  logDiag("Display name saved: " + name);
}

function chunk(arr, n){
  const out = [];
  for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i, i+n));
  return out;
}

async function loadAllAllowedUsers(){
  if(!requireAuthOrPrompt()) {
    logDiag("Cannot load users: not authenticated");
    return;
  }

  logDiag("Loading allowed users...");

  try {
    const alSnap = await getDocs(
      query(collection(db,"allowlistUids"), where("enabled","==",true), limit(200))
    );
    const uids = alSnap.docs.map(d => d.id).filter(Boolean);
    
    logDiag(`Found ${uids.length} allowed users`);

    const users = [];
    for(const group of chunk(uids, 10)){
      const usSnap = await getDocs(query(collection(db,"users"), where(documentId(), "in", group)));
      usSnap.forEach(docu => {
        const data = docu.data() || {};
        users.push({ 
          uid: docu.id, 
          displayName: data.displayName || data.email || "(no name)",
          email: data.email || ""
        });
      });
    }

    allUsersCache = users;
    renderUsersList(window.userSearchInput ? window.userSearchInput.value : "");
    logDiag(`Loaded ${users.length} users into directory`);
  } catch (e) {
    logDiag("Error loading users: " + e.message);
    showError(e);
  }
}

function renderUsersList(filterText=""){
  if (!window.usersList) return;
  
  const queryText = String(filterText || "").trim().toLowerCase();
  const rows = allUsersCache
    .filter(u => u.uid !== myUid)
    .filter(u => !queryText || 
      String(u.displayName||"").toLowerCase().includes(queryText) ||
      String(u.email||"").toLowerCase().includes(queryText))
    .sort((a,b)=> String(a.displayName||"").localeCompare(String(b.displayName||"")));

  window.usersList.innerHTML = "";

  if(rows.length === 0){
    window.usersList.innerHTML = `<div class="small" style="color:#777; padding: 10px;">
      ${allUsersCache.length === 0 ? "No users found" : "No matching users found"}
    </div>`;
    return;
  }

  rows.forEach(user => {
    const div = document.createElement("div");
    div.className = "user-item";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "space-between";
    div.style.gap = "10px";
    div.style.border = "1px solid #e0e0e0";
    div.style.borderRadius = "8px";
    div.style.padding = "12px";
    div.style.marginBottom = "8px";
    div.style.backgroundColor = "#f9f9f9";

    const left = document.createElement("div");
    left.innerHTML = `<b>${user.displayName || "(no name)"}</b>`;

    const btn = document.createElement("button");
    btn.textContent = "Call";
    btn.className = "call-btn";
    btn.disabled = !isAuthed;
    btn.onclick = () => startCallToUid(user.uid, user.displayName).catch(showError);

    div.appendChild(left);
    div.appendChild(btn);
    window.usersList.appendChild(div);
  });
}

async function sendIncomingCallNotification(message) {
  try {
    logDiag("Attempting to send push notification via Firebase");
    
    // Instead of calling a non-existent endpoint, rely on Firebase Cloud Functions
    // which should be triggered by the Firestore document creation
    logDiag("Push notification should be triggered by Cloud Function on call creation");
    
    // The notification will be sent by the Cloud Function when a call document is created
    // with status: "ringing" and toUid field set
    
    return true;
  } catch (error) {
    logDiag("Error in notification handling: " + error.message);
    return false;
  }
}

async function startCallToUid(toUid, toName=""){
  logDiag("Starting call to UID: " + toUid);

  if(!requireAuthOrPrompt()) return;
  if(!toUid) throw new Error("Missing toUid.");
  if(toUid === myUid) throw new Error("You can't call yourself.");
  
// Play ringback tone immediately
  startRingback();
  
  // Set call type for status tracking
  currentCallType = 'outgoing';
  
  setStatus(window.dirCallStatus, "Creating room…");
  const created = await createRoom();
  if(!created?.roomId) throw new Error("Room creation failed.");

  const note = String(window.callNoteInput?.value || "").trim().slice(0, 140);

  // FIX: Ensure toName is properly set
  const callToName = toName || "user";
  
  const callRef = await addDoc(collection(db,"calls"), {
    fromUid: myUid,
    toUid,
    fromName: myDisplayName || defaultNameFromEmail(window.emailInput?.value) || "(unknown)",
    toName: callToName, // Use properly formatted toName
    roomId: created.roomId,
    note,
    status: "ringing",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    acceptedAt: null,
    declinedAt: null,
    endedAt: null,
    // Add push notification tracking
    push: {
      sentAt: null,
      stage: "pending"
    }
  });

  activeCallId = callRef.id;
  
  // Send push notification with properly formatted message
    // Push notification will be sent by Firebase Cloud Function
  // when it detects a new call document with status: "ringing"
  await updateDoc(doc(db, "calls", callRef.id), {
    "push.sentAt": serverTimestamp(),
    "push.stage": "pending",
    "push.attemptedAt": Date.now()
  });
  
  logDiag("Call created. Push notification will be sent via Cloud Function.");

  if (window.hangupBtn) window.hangupBtn.disabled = false;
  listenActiveCall(activeCallId);
  setStatus(window.dirCallStatus, `📞 Calling ${callToName}…`);
  startRingback();
  logDiag(`Outgoing call created: ${callRef.id} roomId=${created.roomId}`);
}

// ==================== SYSTEM CLEANUP FUNCTIONS ====================
function stopAll(){
  logDiag("Stopping all...");
  
  stopListeners();
  closePeer();
  stopCallListeners();
  stopIncomingUI();
  stopRingback();

  if(localStream){
    localStream.getTracks().forEach(t=>t.stop());
    localStream = null;
  }
  
  if (window.localVideo) window.localVideo.srcObject = null;

  if (window.startBtn) window.startBtn.disabled = !isAuthed;
  if (window.createBtn) window.createBtn.disabled = true;
  if (window.joinBtn) window.joinBtn.disabled = true;

  setStatus(window.mediaStatus, "Not started.");
  setStatus(window.callStatus, "No room yet.");

  refreshCopyInviteState();

  if (window.hangupBtn) window.hangupBtn.disabled = true;
  
  // Only set to "Idle" if not connected
  if (!connectionEstablished) {
    setStatus(window.dirCallStatus, "Idle.");
  }

  logDiag("All stopped and cleaned up");
}

// ==================== BUTTON HANDLERS ====================
async function copyTextRobust(text){
  if(navigator.clipboard && window.isSecureContext){
    try{ 
      await navigator.clipboard.writeText(text); 
      logDiag("Copied to clipboard: " + text.substring(0, 50) + "...");
      return true; 
    }catch(e){
      logDiag("Clipboard write failed: " + e.message);
    }
  }
  
  // Fallback
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    logDiag("Copied using execCommand");
    return true;
  } catch (e) {
    logDiag("execCommand failed: " + e.message);
    window.prompt("Copy this invite link:", text);
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function refreshCopyInviteState(){
  if (!window.copyLinkBtn || !window.roomIdInput) return;
  
  const hasRoomId = !!window.roomIdInput.value.trim();
  const canCopy = isAuthed && hasRoomId;
  
  window.copyLinkBtn.disabled = !canCopy;
  
  logDiag(`Copy invite state: auth=${isAuthed}, roomId=${hasRoomId}, disabled=${window.copyLinkBtn.disabled}`);
}

// ==================== ROOM CREATION AND JOINING ====================
async function createRoom(){
  if(!requireAuthOrPrompt()) {
    logDiag("Cannot create room: not authenticated");
    return null;
  }

  stopListeners();
  await startMedia();

  const roomRef = doc(collection(db, "rooms"));
  if (window.roomIdInput) window.roomIdInput.value = roomRef.id;
  
  // Update URL hash
  location.hash = roomRef.id;
  refreshCopyInviteState();
  logDiag("CreateRoom: roomId=" + roomRef.id);

  const caller = collection(roomRef,"callerCandidates");
  const callee = collection(roomRef,"calleeCandidates");
  
  await clearSub(caller);
  await clearSub(callee);

  await ensurePeer();

  const session = 1;

  pc.onicecandidate = (e)=>{
    if(e.candidate){
      addDoc(caller, { session, ...e.candidate.toJSON() }).catch(()=>{
        logDiag("Failed to add ICE candidate to Firestore");
      });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  logDiag("Created local offer, setting up Firestore");

  await setDoc(roomRef, {
    session,
    offer: { type: offer.type, sdp: offer.sdp },
    answer: null,
    updatedAt: Date.now(),
    createdBy: myUid,
    createdByName: myDisplayName || "Unknown"
  }, { merge:true });

  setStatus(window.callStatus, `✅ Room created (session ${session}). Waiting for peer...`);
  logDiag(`Room written to Firestore. session=${session}`);

  // Listen for answer
  unsubRoomA = onSnapshot(roomRef, async (snapshot)=>{
    const data = snapshot.data();
    if(!data) return;

    logDiag("Room snapshot update: " + JSON.stringify(data).substring(0, 200));

    if(data.answer && data.session === session && pc && pc.signalingState === "have-local-offer" && !pc.currentRemoteDescription){
      try{
        logDiag("Received answer from peer, setting remote description");
        await pc.setRemoteDescription(data.answer);
        setStatus(window.callStatus, `✅ Connected (session ${session}).`);
        logDiag("Successfully applied remote answer.");
      }catch(e){
        logDiag("setRemoteDescription(answer) failed: " + (e?.message || e));
        setStatus(window.callStatus, "Answer failed — restarting session…");
        showError(e);
      }
    }
  }, (error) => {
    logDiag("Room listener error: " + error.message);
  });

  // Listen for callee ICE candidates
  unsubCalleeA = onSnapshot(callee, (snapshot)=>{
    snapshot.docChanges().forEach(change=>{
      if(change.type !== "added" || !pc) return;
      const candidate = change.doc.data();
      if(candidate.session !== session) return;
      try{ 
        pc.addIceCandidate(candidate);
        logDiag("Added callee ICE candidate");
      }catch(e){
        logDiag("Failed to add callee ICE candidate: " + e.message);
      }
    });
  }, (error) => {
    logDiag("Callee candidate listener error: " + error.message);
  });

  return { roomId: roomRef.id, roomRef };
}

async function joinRoom(){
  if(!requireAuthOrPrompt()) {
    logDiag("Cannot join room: not authenticated");
    return;
  }

  const roomId = window.roomIdInput ? window.roomIdInput.value.trim() : "";
  if(!roomId) {
    setStatus(window.callStatus, "Please enter a Room ID");
    throw new Error("Room ID is empty.");
  }
  
  logDiag("Attempting to join room: " + roomId);

  await startMedia();
  
  // Update URL hash
  location.hash = roomId;

  const roomRef = doc(db,"rooms", roomId);
  const snap = await getDoc(roomRef);
  if(!snap.exists()) {
    setStatus(window.callStatus, "Room not found");
    throw new Error("Room not found");
  }

  stopListeners();

  // Set call type for status tracking
  currentCallType = 'incoming';
  
  setStatus(window.callStatus, "Connecting to room…");
  logDiag("Found room, setting up listeners");

  let lastProcessedSession = 0;

  unsubRoomB = onSnapshot(roomRef, async (snapshot)=>{
    const data = snapshot.data();
    if(!data?.offer || !data.session) {
      logDiag("No offer found in room data");
      return;
    }

    const session = data.session;
    if(session <= lastProcessedSession) {
      logDiag(`Ignoring old session ${session}, already processed ${lastProcessedSession}`);
      return;
    }
    
    lastProcessedSession = session;
    logDiag("New offer/session detected: " + session);

    try{
      await ensurePeer();

      const caller = collection(roomRef,"callerCandidates");
      const callee = collection(roomRef,"calleeCandidates");

      await clearSub(callee);

      pc.onicecandidate = (e)=>{
        if(e.candidate){
          addDoc(callee, { session, ...e.candidate.toJSON() }).catch(()=>{
            logDiag("Failed to add ICE candidate");
          });
        }
      };

      logDiag("Setting remote description from offer");
      await pc.setRemoteDescription(data.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      logDiag("Created answer, writing to Firestore");

      await updateDoc(roomRef, { 
        answer: answer, 
        session, 
        answeredAt: Date.now(),
        answeredBy: myUid,
        answeredByName: myDisplayName || "Unknown"
      });
      
      setStatus(window.callStatus, `✅ Joined room. Waiting for connection... (session ${session})`);
      logDiag("Answer written to room doc.");

      // Listen for caller ICE candidates
      unsubCallerB = onSnapshot(caller, (candidateSnapshot)=>{
        candidateSnapshot.docChanges().forEach(change=>{
          if(change.type !== "added" || !pc) return;
          const candidate = change.doc.data();
          if(candidate.session !== session) return;
          try{ 
            pc.addIceCandidate(candidate);
            logDiag("Added caller ICE candidate");
          }catch(e){
            logDiag("Failed to add caller ICE candidate: " + e.message);
          }
        });
      }, (error) => {
        logDiag("Caller candidate listener error: " + error.message);
      });

    }catch(e){
      logDiag("Join flow error: " + (e?.message || e));
      setStatus(window.callStatus, "Join failed: " + e.message);
      showError(e);
    }
  }, (error) => {
    logDiag("Room join listener error: " + error.message);
    setStatus(window.callStatus, "Connection error");
  });
}

// ==================== ALLOWLIST ENFORCEMENT ====================
async function enforceAllowlist(user){
  const uid = user.uid;
  logDiag("Checking allowlist for UID: " + uid);

  try{
    const ref = doc(db, "allowlistUids", uid);
    const snap = await getDoc(ref);

    if(!snap.exists()){
      if (window.loginStatus) window.loginStatus.textContent = "❌ Not approved yet. Your UID: " + uid;
      try{ await signOut(auth); }catch{}
      throw new Error("Allowlist missing for UID: " + uid);
    }

    const enabled = snap.data()?.enabled === true;
    if(!enabled){
      if (window.loginStatus) window.loginStatus.textContent = "❌ Not approved yet (enabled=false). Your UID: " + uid;
      try{ await signOut(auth); }catch{}
      throw new Error("Allowlist disabled for UID: " + uid);
    }

    logDiag("Allowlist check passed");
    return true;
  }catch(e){
    if(String(e?.code || "").includes("permission-denied")){
      if (window.loginStatus) window.loginStatus.textContent = "Allowlist check blocked by Firestore rules (permission-denied).";
    }
    throw e;
  }
}

// ==================== AUTHENTICATION FUNCTIONS ====================
function requireAuthOrPrompt(){
  if (isAuthed) return true;
  
  if (window.loginOverlay) window.loginOverlay.style.display = "flex";
  if (window.appRoot) window.appRoot.classList.add("locked");
  if (window.loginStatus) window.loginStatus.textContent = "Please sign in first.";
  
  logDiag("Authentication required");
  return false;
}

// ==================== SETUP EVENT LISTENERS ====================
function setupEventListeners() {
  // Login/Logout
  if (window.loginBtn) {
    window.loginBtn.onclick = async () => {
      hideErrorBox();
      if (window.loginStatus) window.loginStatus.textContent = "Signing in…";
      
      try {
        const email = window.emailInput.value.trim();
        const password = window.passInput.value;
        
        if (!email || !password) {
          throw new Error("Please enter email and password");
        }
        
        logDiag("Attempting login with email: " + email);
        await signInWithEmailAndPassword(auth, email, password);
        
      } catch (e) {
        const errorMsg = `Login failed: ${e?.code || "unknown"} - ${e?.message || ""}`;
        if (window.loginStatus) window.loginStatus.textContent = errorMsg;
        logDiag(`Login error: ${e?.code} - ${e?.message}`);
        showError(e);
      }
    };
  }

  if (window.logoutBtn) {
    window.logoutBtn.onclick = async () => {
      try{
        logDiag("Logging out...");
        stopAll();
        await revokePushForCurrentDevice();
        await signOut(auth);
      }catch(e){
        showError(e);
      }
    };
  }

  // Media and WebRTC
  if (window.startBtn) window.startBtn.onclick = async () => {
    try{
      hideErrorBox();
      await startMedia();
    }catch(e){
      showError(e);
    }
  };
  
  if (window.createBtn) window.createBtn.onclick = () => createRoom().catch(showError);
  if (window.joinBtn) window.joinBtn.onclick = () => joinRoom().catch(showError);
  
  // Invite link
  if (window.copyLinkBtn) window.copyLinkBtn.onclick = async () => {
    const roomId = window.roomIdInput?.value.trim();
    if (!roomId) {
      setStatus(window.callStatus, "No room ID to copy");
      return;
    }
    
    const inviteUrl = `${window.location.origin}${window.location.pathname}#${roomId}`;
    const success = await copyTextRobust(inviteUrl);
    
    if (success) {
      setStatus(window.callStatus, "✅ Invite link copied!");
      setTimeout(() => {
        setStatus(window.callStatus, `Room: ${roomId}`);
      }, 2000);
    } else {
      setStatus(window.callStatus, "⚠️ Could not copy automatically");
    }
  };
  
  // Room ID input
  if (window.roomIdInput) {
    window.roomIdInput.addEventListener("input", () => refreshCopyInviteState());
  }
  
  // Audio test
  if (window.testSoundBtn) {
    window.testSoundBtn.onclick = async () => {
      await unlockAudio();
      startRingtone();
      setTimeout(() => stopRingtone(), 1800);
    };
  }
  
  // Video quality
  if (window.videoQualitySelect) {
    window.videoQualitySelect.addEventListener("change", () => {
      const v = String(window.videoQualitySelect.value || "medium");
      selectedVideoQuality = VIDEO_PROFILES[v] ? v : "medium";
      updateVideoQualityUi();
      
      if (localStream) {
        applyVideoQualityToCurrentStream(selectedVideoQuality).catch(e => {
          logDiag("Failed to apply video quality: " + e.message);
        });
      }
    });
  }
  
  // Hangup
  if (window.hangupBtn) window.hangupBtn.onclick = () => hangup().catch(showError);
  
  // User directory
  if (window.saveNameBtn) window.saveNameBtn.onclick = () => saveMyName().catch(showError);
  if (window.refreshUsersBtn) window.refreshUsersBtn.onclick = () => loadAllAllowedUsers().catch(showError);
  
  if (window.myNameInput) window.myNameInput.addEventListener("input", () => {
    if (window.saveNameBtn) window.saveNameBtn.disabled = !isAuthed || !String(window.myNameInput.value||"").trim();
  });
  
  if (window.userSearchInput) {
    window.userSearchInput.addEventListener("input", () => renderUsersList(window.userSearchInput.value));
  }
  
  // Incoming call buttons
  if (window.answerBtn) {
    window.answerBtn.onclick = async ()=>{
      try{
        const call = currentIncomingCall;
        stopIncomingUI();

        if(!call){
          setStatus(window.dirCallStatus, "No call context. Please wait for the caller again.");
          return;
        }

        const { id, data } = call;

        await updateDoc(doc(db,"calls", id), {
          status: "accepted",
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          deliveredAt: serverTimestamp(),
          deliveredVia: "web_page"
        });

        activeCallId = id;
        if (window.hangupBtn) window.hangupBtn.disabled = false;
        listenActiveCall(id);

        if (window.roomIdInput && data.roomId) {
          window.roomIdInput.value = data.roomId;
        }

        setStatus(window.dirCallStatus, `✅ Answered ${data.fromName || ""}. Joining room…`);

        await joinRoom();

        try { await listenIncomingCalls(); } catch {}
      }catch(e){
        showError(e);
      }
    };
  }

  if (window.declineBtn) {
    window.declineBtn.onclick = async ()=>{
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

        setStatus(window.dirCallStatus, "❌ Declined incoming call.");
        try { await listenIncomingCalls(); } catch {}
      }catch(e){
        showError(e);
      }
    };
  }
  
  // Push notification buttons
  if (window.resetPushBtn) {
    window.resetPushBtn.onclick = async ()=>{
      try{
        setStatus(window.pushStatus, "Push: resetting…");
        await revokePushForCurrentDevice();
        await enablePush();
        setStatus(window.pushStatus, "Push: enabled (reset).");
      }catch(e){
        showError(e);
      }
    };
  }
  
  // Background service buttons
  if (window.startBgBtn) {
    window.startBgBtn.onclick = startBackgroundService;
  }
  
  if (window.stopBgBtn) {
    window.stopBgBtn.onclick = stopBackgroundService;
  }
}

// ==================== DIAGNOSTICS ====================
function initializeDiagnostics(){
  if (window.diagBtn && window.diagBox && window.copyDiagBtn && window.clearDiagBtn) {
    window.diagBtn.onclick = () => {
      diagVisible = !diagVisible;
      window.diagBox.style.display = diagVisible ? "block" : "none";
      window.diagBtn.textContent = diagVisible ? "Hide diagnostics" : "Diagnostics";
      if (diagVisible) {
        window.diagBox.textContent = diagLog.join("\n");
        window.diagBox.scrollTop = window.diagBox.scrollHeight;
      }
    };
    
    window.clearDiagBtn.onclick = () => {
      diagLog.length = 0;
      if (diagVisible) window.diagBox.textContent = "";
      window.copyDiagBtn.disabled = true;
      window.clearDiagBtn.disabled = true;
      logDiag("Diagnostics cleared.");
    };
    
    window.copyDiagBtn.onclick = async () => {
      const text = diagLog.join("\n");
      if (!text) return;
      try{
        await navigator.clipboard.writeText(text);
        logDiag("Copied diagnostics to clipboard.");
      }catch{
        window.prompt("Copy diagnostics:", text);
      }
    };
    
    window.copyDiagBtn.disabled = diagLog.length === 0;
    window.clearDiagBtn.disabled = diagLog.length === 0;
  }
}

// ==================== AUTH STATE LISTENER ====================
onAuthStateChanged(auth, async (user)=>{
  isAuthed = !!user;
  myUid = user?.uid || null;
  logDiag(isAuthed ? "✅ Auth: signed in as " + user.email : "Auth: signed out");

  if (isAuthed){
    try{ 
      await enforceAllowlist(user); 
    } catch(e){
      showError(e);
      if (window.loginOverlay) window.loginOverlay.style.display = "flex";
      if (window.appRoot) window.appRoot.classList.add("locked");
      if (window.logoutBtn) window.logoutBtn.style.display = "none";
      if (window.startBtn) window.startBtn.disabled = true;
      return;
    }

    if (window.loginOverlay) window.loginOverlay.style.display = "none";
    if (window.appRoot) window.appRoot.classList.remove("locked");
    if (window.logoutBtn) window.logoutBtn.style.display = "inline-block";
    if (window.loginStatus) window.loginStatus.textContent = "✅ Signed in.";

    if (window.startBtn) window.startBtn.disabled = false;
    setStatus(window.mediaStatus, "Ready. Click Start to enable camera/mic.");

    if (window.videoQualitySelect) window.videoQualitySelect.disabled = false;
    updateVideoQualityUi();

    if (window.testSoundBtn) window.testSoundBtn.disabled = false;
    if (window.saveNameBtn) window.saveNameBtn.disabled = !String(window.myNameInput?.value||"").trim();
    if (window.refreshUsersBtn) window.refreshUsersBtn.disabled = false;
    if (window.hangupBtn) window.hangupBtn.disabled = true;
    if (window.resetPushBtn) window.resetPushBtn.disabled = false;

    refreshCopyInviteState();

    // Process push notifications
    await rotateFcmTokenIfUserChanged();
    autoEnablePushOnLogin();
    
    // Process any pending notifications from URL
    await processPendingNotifications();

    try{ 
      await ensureMyUserProfile(user); 
    } catch(e){ 
      logDiag("ensureMyUserProfile failed: " + (e?.message || e)); 
    }
    
    try{ 
      await loadAllAllowedUsers(); 
    } catch(e){ 
      logDiag("loadAllAllowedUsers failed: " + (e?.message || e)); 
    }
    
    try{ 
      await listenIncomingCalls(); 
    } catch(e){ 
      logDiag("Incoming listener failed: " + (e?.message || e)); 
    }
    
    try {
      await catchUpMissedRingingCall();
      await catchUpMissedCallNotification();
    } catch (e) {
      logDiag("Catch-up failed: " + e.message);
    }

    // Update background service status
    updateServiceStatus();
    // Check status every 30 seconds
    setInterval(updateServiceStatus, 30000);

  } else {
    if (window.loginOverlay) window.loginOverlay.style.display = "flex";
    if (window.appRoot) window.appRoot.classList.add("locked");
    if (window.logoutBtn) window.logoutBtn.style.display = "none";
    stopAll();

    if (window.videoQualitySelect) window.videoQualitySelect.disabled = true;
    if (window.testSoundBtn) window.testSoundBtn.disabled = true;
    if (window.saveNameBtn) window.saveNameBtn.disabled = true;
    if (window.refreshUsersBtn) window.refreshUsersBtn.disabled = true;
    if (window.resetPushBtn) window.resetPushBtn.disabled = true;

    setStatus(window.dirCallStatus, "Idle.");
    if (window.myNameStatus) window.myNameStatus.textContent = "Not set.";
    if (window.pushStatus) window.pushStatus.textContent = "Push: not enabled.";

    window.bgStatus.textContent = 'Sign in required';
    window.startBgBtn.disabled = true;
    window.stopBgBtn.disabled = true;

    if (window.usersList) window.usersList.innerHTML = "";
    allUsersCache = [];
    myDisplayName = "";
  }
});

// ==================== INITIALIZATION ====================
// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    logDiag("DOM loaded, initializing...");
    initializeDomElements();
    updateVideoQualityUi();
    
    // Register service worker early
    ensureServiceWorkerInstalled().then(() => {
      logDiag("Service worker registration attempted");
    });

// Send UID to Service Worker after registration
if (navigator.serviceWorker.controller) {
  navigator.serviceWorker.controller.postMessage({
    type: 'SET_UID',
    uid: myUid
  });
}
    
  });
} else {
  logDiag("DOM already loaded, initializing...");
  initializeDomElements();
  updateVideoQualityUi();
  
  // Register service worker early
  ensureServiceWorkerInstalled().then(() => {
    logDiag("Service worker registration attempted");
  });
}

// Unlock audio on first click
window.addEventListener("click", () => {
  unlockAudio().catch(() => {});
  logDiag("Page clicked, audio unlocked");
}, { once: true });

// Handle beforeunload
window.addEventListener("beforeunload", ()=>{
  try{ closePeer(); }catch{}
  try{ stopRingtone(); }catch{}
  try{ stopRingback(); }catch{}
  logDiag("Page unloading...");
});

console.log("WebRTC app initialization complete");
console.log("Firebase app:", app.name);
console.log("Ready for login...");
