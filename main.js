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
console.log("APP VERSION:", "2026-01-08-fixed-complete");

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

// Firestore listeners
let unsubRoomA = null, unsubCalleeA = null;
let unsubRoomB = null, unsubCallerB = null;
let unsubIncoming = null;
let unsubCallDoc = null;

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
// We'll use window object to make elements globally accessible
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
      if (window.callStatus) {
        setStatus(window.callStatus, `Connection: ${state}`);
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

// ==================== ROOM CREATION (CALLER SIDE) ====================
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

// ==================== ROOM JOINING (CALLEE SIDE) ====================
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

// ==================== CALL MANAGEMENT ====================
function showIncomingUI(callId, data){
  currentIncomingCall = { id: callId, data };
  if (window.incomingText) {
    window.incomingText.textContent = `Call from ${data.fromName || "unknown"} to ${data.toName || "you"}…`;
  }

  if (window.incomingOverlay) {
    window.incomingOverlay.style.display = "flex";
  }
  startRingtone();
  
  logDiag(`Showing incoming call UI for ${callId} from ${data.fromName}`);
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
        users.push({ uid: docu.id, displayName: data.displayName || data.email || "(no name)" });
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

async function startCallToUid(toUid, toName=""){
  logDiag("Starting call to UID: " + toUid);

  if(!requireAuthOrPrompt()) return;
  if(!toUid) throw new Error("Missing toUid.");
  if(toUid === myUid) throw new Error("You can't call yourself.");

  setStatus(window.dirCallStatus, "Creating room…");
  const created = await createRoom();
  if(!created?.roomId) throw new Error("Room creation failed.");

  const note = String(window.callNoteInput?.value || "").trim().slice(0, 140);

  const callRef = await addDoc(collection(db,"calls"), {
    fromUid: myUid,
    toUid,
    fromName: myDisplayName || defaultNameFromEmail(window.emailInput?.value) || "(unknown)",
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
  
  if (window.hangupBtn) window.hangupBtn.disabled = false;
  listenActiveCall(activeCallId);
  setStatus(window.dirCallStatus, `📞 Calling ${toName || "user"}…`);
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
  setStatus(window.dirCallStatus, "Idle.");

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
          updatedAt: serverTimestamp()
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

    refreshCopyInviteState();

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

  } else {
    if (window.loginOverlay) window.loginOverlay.style.display = "flex";
    if (window.appRoot) window.appRoot.classList.add("locked");
    if (window.logoutBtn) window.logoutBtn.style.display = "none";
    stopAll();

    if (window.videoQualitySelect) window.videoQualitySelect.disabled = true;
    if (window.testSoundBtn) window.testSoundBtn.disabled = true;
    if (window.saveNameBtn) window.saveNameBtn.disabled = true;
    if (window.refreshUsersBtn) window.refreshUsersBtn.disabled = true;

    setStatus(window.dirCallStatus, "Idle.");
    if (window.myNameStatus) window.myNameStatus.textContent = "Not set.";

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
  });
} else {
  logDiag("DOM already loaded, initializing...");
  initializeDomElements();
  updateVideoQualityUi();
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
