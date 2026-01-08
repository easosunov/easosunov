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
console.log("APP VERSION:", "2026-01-08-stable");

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

// ==================== CONFIGURATION ====================
const NOTIFY_CALL_URL = "https://us-central1-easosunov-webrtc.cloudfunctions.net/sendTestPush";
const PUBLIC_VAPID_KEY = "BCR4B8uf0WzUuzHKlBCJO22NNnnupe88j8wkjrTwwQALDpWUeJ3umtIkNJTrLb0I_LeIeu2HyBNbogHc6Y7jNzM";

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
const joinBtn = document.getElementById("joinBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const roomIdInput = document.getElementById("roomId");
const mediaStatus = document.getElementById("mediaStatus");
const callStatus = document.getElementById("callStatus");
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

// ==================== UTILITY FUNCTIONS ====================
const setStatus = (el, msg) => el.textContent = msg;

function logDiag(msg){
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
}

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
  }catch(e){
    showError(e);
  }
};

// ==================== WEBRTC FUNCTIONS ====================
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

// ==================== MEDIA FUNCTIONS ====================
const VIDEO_PROFILES = {
  low:    { label: "Low (360p)",    constraints: { width:{ideal:640},  height:{ideal:360},  frameRate:{ideal:15, max:15} } },
  medium: { label: "Medium (720p)", constraints: { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30, max:30} } },
  high:   { label: "High (1080p)",  constraints: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30, max:30} } },
};

let selectedVideoQuality = "medium";

function updateVideoQualityUi(){
  if(videoQualitySelect){
    videoQualitySelect.value = selectedVideoQuality;
  }
  const label = VIDEO_PROFILES[selectedVideoQuality]?.label || "Medium (720p)";
  if(videoQualityStatus) videoQualityStatus.textContent = `Video: ${label}.`;
}

async function startMedia(){
  if(!requireAuthOrPrompt()) return;

  if(localStream){
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
}

// ==================== ROOM FUNCTIONS ====================
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
    
    // Update UI
    roomIdInput.value = roomId;
    location.hash = roomId;
    setStatus(callStatus, `Creating room: ${roomId}`);
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
    
    logDiag(`Room ${roomId} created successfully`);
    return { roomId, roomRef };
    
  } catch (error) {
    setStatus(callStatus, "❌ Failed to create room");
    logDiag("createRoom error: " + error.message);
    console.error("Create room error details:", error);
    return null;
  }
}

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
    
    logDiag(`Successfully joined room ${roomId}`);
    
  } catch (error) {
    setStatus(callStatus, "❌ Failed to join room: " + error.message);
    logDiag("joinRoom error: " + error.message);
    console.error("Join room error details:", error);
  }
}

// ==================== COPY INVITE FUNCTION ====================
function refreshCopyInviteState(){
  if (!copyLinkBtn || !roomIdInput) return;
  
  const hasRoomId = !!roomIdInput.value.trim();
  const canCopy = isAuthed && hasRoomId;
  
  copyLinkBtn.disabled = !canCopy;
  
  logDiag(`refreshCopyInviteState: auth=${isAuthed}, hasRoomId=${hasRoomId}, disabled=${copyLinkBtn.disabled}`);
}

async function copyTextRobust(text){
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn("Clipboard write failed:", e);
    }
  }
  
  // Fallback
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
  
  window.prompt("Copy this invite link:", text);
  return false;
}

// ==================== AUDIO FUNCTIONS ====================
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

function startRingback(){
  stopRingback();
  logDiag("Ringback started");
}

function stopRingback(){
  if(ringbackTimer){
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
}

// ==================== USER MANAGEMENT ====================
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

  const queryText = String(filterText || "").trim().toLowerCase();
  const filtered = allUsersCache
    .filter(u => u.uid !== myUid)
    .filter(u => !queryText || String(u.displayName || "").toLowerCase().includes(queryText))
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

// ==================== CALL FUNCTIONS ====================
function hangup(){
  stopRingtone();
  stopRingback();
  stopAll();
  setStatus(dirCallStatus, "Call ended.");
  logDiag("Call hung up");
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
    
    // Create peer connection
    await ensurePeer();
    
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
    
    // Start ringback tone
    startRingback();
    
    // Send notification
    await sendCallNotification(toUid, toName, roomId);
    
    // Enable hangup button
    hangupBtn.disabled = false;
    
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
    
  } catch (error) {
    logDiag("sendCallNotification error: " + error.message);
  }
}

// ==================== INCOMING CALL LISTENERS ====================
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
      query(incomingCallsRef, where("status", "==", "ringing")),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const callData = change.doc.data();
            logDiag(`Incoming call detected: ${callData.callId} from ${callData.fromName}`);
            
            // Show incoming call UI
            showIncomingCallUI(callData);
          }
        });
      }
    );
    
    logDiag("Listening for incoming direct calls");
  } catch (error) {
    logDiag("listenForIncomingCalls error: " + error.message);
  }
}

function showIncomingCallUI(callData) {
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
  window.currentIncomingCall = callData;
  
  // Set up answer button
  answerBtn.onclick = async () => {
    stopRingtone();
    incomingOverlay.style.display = "none";
    
    // Update call status
    if (callData.callId) {
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
    
    // Join the room
    roomIdInput.value = callData.roomId;
    setStatus(callStatus, `Answering call from ${callData.fromName}...`);
    
    setTimeout(async () => {
      await joinRoom();
      window.currentIncomingCall = null;
    }, 500);
  };
  
  // Set up decline button
  declineBtn.onclick = async () => {
    stopRingtone();
    incomingOverlay.style.display = "none";
    
    // Update call status
    if (callData.callId) {
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
    
    setStatus(dirCallStatus, "Call declined.");
    window.currentIncomingCall = null;
  };
}

// ==================== CLEANUP FUNCTIONS ====================
function cleanupRoom() {
  if (window.currentRoomUnsubscribe) {
    window.currentRoomUnsubscribe();
    window.currentRoomUnsubscribe = null;
  }
  closePeer();
}

function stopAll(){
  // Clean up room listeners
  cleanupRoom();
  
  // Clean up call listeners
  if (incomingCallsUnsubscribe) {
    try {
      incomingCallsUnsubscribe();
    } catch (e) {}
    incomingCallsUnsubscribe = null;
  }
  
  if (roomCallsUnsubscribe) {
    try {
      roomCallsUnsubscribe();
    } catch (e) {}
    roomCallsUnsubscribe = null;
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

// ==================== BUTTON EVENT HANDLERS ====================
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

if (testSoundBtn) testSoundBtn.onclick = async () => {
  await unlockAudio();
  startRingtone();
  setTimeout(() => stopRingtone(), 1800);
};

if (hangupBtn) hangupBtn.onclick = () => hangup().catch(showError);
if (saveNameBtn) saveNameBtn.onclick = () => saveMyName().catch(showError);
if (refreshUsersBtn) refreshUsersBtn.onclick = () => loadAllAllowedUsers().catch(showError);
if (myNameInput) myNameInput.addEventListener("input", () => {
  saveNameBtn.disabled = !isAuthed || !String(myNameInput.value||"").trim();
});

if (roomIdInput) {
  roomIdInput.addEventListener("input", () => refreshCopyInviteState());
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

    if(videoQualitySelect) videoQualitySelect.disabled = false;
    updateVideoQualityUi();

    if(testSoundBtn) testSoundBtn.disabled = false;
    if(saveNameBtn) saveNameBtn.disabled = !String(myNameInput.value||"").trim();
    if(refreshUsersBtn) refreshUsersBtn.disabled = false;
    if(hangupBtn) hangupBtn.disabled = true;

    refreshCopyInviteState();

    try{ await ensureMyUserProfile(user); } catch(e){ logDiag("ensureMyUserProfile failed: " + (e?.message || e)); }
    try{ await loadAllAllowedUsers(); } catch(e){ logDiag("loadAllAllowedUsers failed: " + (e?.message || e)); }
    
    // Start listening for incoming calls
    try{ listenForIncomingCalls(); } catch(e){ logDiag("listenForIncomingCalls failed: " + (e?.message || e)); }

  } else {
    loginOverlay.style.display = "flex";
    appRoot.classList.add("locked");
    logoutBtn.style.display = "none";
    stopAll();

    if(videoQualitySelect) videoQualitySelect.disabled = true;
    if(testSoundBtn) testSoundBtn.disabled = true;
    if(saveNameBtn) saveNameBtn.disabled = true;
    if(refreshUsersBtn) refreshUsersBtn.disabled = true;

    setStatus(dirCallStatus, "Idle.");
    if(myNameStatus) myNameStatus.textContent = "Not set.";

    usersList.innerHTML = "";
    allUsersCache = [];
    myDisplayName = "";
  }
});

// ==================== INITIALIZATION ====================
// Initialize UI
updateVideoQualityUi();

// Setup user search
if(userSearchInput){
  userSearchInput.addEventListener("input", () => renderUsersList(userSearchInput.value));
}

// Unlock audio on first click
window.addEventListener("click", unlockAudio, { once: true });

// Window event listeners
window.addEventListener("beforeunload", () => {
  try{ closePeer(); }catch{}
  try{ stopRingtone(); }catch{}
});

console.log("WebRTC app initialization complete");
console.log("Firebase app:", app.name);
console.log("Ready for login...");
