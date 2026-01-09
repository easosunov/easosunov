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
console.log("APP VERSION:", "2026-01-08-restored");

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

// ==================== SIMPLE LOGGING ====================
const diagLog = [];
let diagVisible = false;

function logDiag(msg){
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  diagLog.push(line);
  console.log(line);
  
  if (diagVisible && diagBox) {
    diagBox.textContent = diagLog.join("\n");
    diagBox.scrollTop = diagBox.scrollHeight;
  }
}

// ==================== DOM ELEMENT REFERENCES ====================
let errorBox, loginOverlay, loginBtn, logoutBtn, loginStatus, emailInput, passInput, appRoot;
let localVideo, remoteVideo, startBtn, createBtn, joinBtn, copyLinkBtn, roomIdInput, mediaStatus, callStatus;
let diagBtn, diagBox, copyDiagBtn, clearDiagBtn;
let incomingOverlay, incomingText, answerBtn, declineBtn;
let myNameInput, saveNameBtn, refreshUsersBtn, myNameStatus, userSearchInput, usersList, dirCallStatus;
let pushStatus, testSoundBtn, hangupBtn, resetPushBtn, callNoteInput;
let videoQualitySelect, videoQualityStatus;

// ==================== VIDEO QUALITY PROFILES ====================
const VIDEO_PROFILES = {
  low:    { label: "Low (360p)",    constraints: { width:{ideal:640},  height:{ideal:360},  frameRate:{ideal:15, max:15} } },
  medium: { label: "Medium (720p)", constraints: { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30, max:30} } },
  high:   { label: "High (1080p)",  constraints: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30, max:30} } },
};

let selectedVideoQuality = "medium";

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

    // Load ICE servers
    await loadIceServers();

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

async function loadIceServers() {
  logDiag("Fetching ICE servers …");
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
  if (videoQualitySelect) {
    videoQualitySelect.value = selectedVideoQuality;
  }
  const label = VIDEO_PROFILES[selectedVideoQuality]?.label || "Medium (720p)";
  if (videoQualityStatus) {
    videoQualityStatus.textContent = `Video: ${label}.`;
  }
}

// ==================== WEBRTC PEER CONNECTION FUNCTIONS ====================
function closePeer(){
  if(pc){
    pc.onicecandidate=null;
    pc.ontrack=null;
    pc.onconnectionstatechange=null;
    pc.oniceconnectionstatechange=null;
    try{ pc.close(); }catch{}
    pc=null;
  }
  if (remoteVideo) remoteVideo.srcObject = null;
}

async function ensurePeer() {
  closePeer();

  if (!rtcConfig || !rtcConfig.iceServers || rtcConfig.iceServers.length === 0) {
    await loadIceServers();
  }

  pc = new RTCPeerConnection(rtcConfig);
  logDiag("Created RTCPeerConnection with ICE servers");

  const rs = new MediaStream();
  if (remoteVideo) {
    remoteVideo.srcObject = rs;
  }

  pc.ontrack = (e) => {
    if (e.streams[0]) {
      e.streams[0].getTracks().forEach(t => rs.addTrack(t));
      if (remoteVideo) {
        remoteVideo.muted = false;
        remoteVideo.play().catch(() => {});
      }
      logDiag(`ontrack: ${e.streams[0].getTracks().map(t=>t.kind).join(",")}`);
    }
  };

  pc.onconnectionstatechange = () => { 
    if (pc) {
      logDiag("pc.connectionState=" + pc.connectionState);
      if (callStatus) {
        setStatus(callStatus, `Connection: ${pc.connectionState}`);
      }
    }
  };
  
  pc.oniceconnectionstatechange = () => { 
    if (pc) {
      logDiag("pc.iceConnectionState=" + pc.iceConnectionState);
    }
  };

  if (!localStream) throw new Error("Local media not started.");
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
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

// ==================== ROOM CREATION (CALLER SIDE) ====================
async function createRoom(){
  if(!requireAuthOrPrompt()) return null;

  stopListeners();
  await startMedia();

  const roomRef = doc(collection(db, "rooms"));
  if (roomIdInput) roomIdInput.value = roomRef.id;
  
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

  setStatus(callStatus, `Room created (session ${session}).`);
  logDiag(`Room written. session=${session}`);

  // Listen for answer
  unsubRoomA = onSnapshot(roomRef, async (s)=>{
    const d = s.data();
    if(!d) return;

    if(d.answer && d.session === session && pc && pc.signalingState === "have-local-offer" && !pc.currentRemoteDescription){
      try{
        await pc.setRemoteDescription(d.answer);
        setStatus(callStatus, `Connected (session ${session}).`);
        logDiag("Applied remote answer.");
      }catch(e){
        logDiag("setRemoteDescription(answer) failed: " + (e?.message || e));
        setStatus(callStatus, "Answer failed — restarting session…");
      }
    }
  });

  // Listen for callee ICE candidates
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
async function joinRoom(){
  if(!requireAuthOrPrompt()) return;

  await startMedia();

  const roomId = roomIdInput ? roomIdInput.value.trim() : "";
  if(!roomId) throw new Error("Room ID is empty.");
  
  // Update URL hash
  location.hash = roomId;
  logDiag("JoinRoom: roomId=" + roomId);

  const roomRef = doc(db,"rooms", roomId);
  const snap = await getDoc(roomRef);
  if(!snap.exists()) throw new Error("Room not found");

  stopListeners();

  setStatus(callStatus, "Connecting…");

  unsubRoomB = onSnapshot(roomRef, async (s)=>{
    const d = s.data();
    if(!d?.offer || !d.session) return;

    const session = d.session;
    logDiag("New offer/session detected: " + session);

    try{
      await ensurePeer();

      const caller = collection(roomRef,"callerCandidates");
      const callee = collection(roomRef,"calleeCandidates");

      await clearSub(callee);

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

      // Listen for caller ICE candidates
      unsubCallerB = onSnapshot(caller, (ss)=>{
        ss.docChanges().forEach(ch=>{
          if(ch.type !== "added" || !pc) return;
          const c = ch.doc.data();
          if(c.session !== session) return;
          try{ pc.addIceCandidate(c); }catch{}
        });
      });

    }catch(e){
      logDiag("Join flow error: " + (e?.message || e));
      setStatus(callStatus, "Join failed.");
      showError(e);
    }
  });
}

// ==================== CALL MANAGEMENT ====================
function showIncomingUI(callId, data){
  currentIncomingCall = { id: callId, data };
  if (incomingText) {
    incomingText.textContent = `Call from ${data.fromName || "unknown"} to ${data.toName || "you"}…`;
  }

  if (incomingOverlay) {
    incomingOverlay.style.display = "flex";
  }
  startRingtone();
  
  logDiag(`Showing incoming call UI for ${callId}`);
}

function stopIncomingUI(){
  if (incomingOverlay) {
    incomingOverlay.style.display = "none";
  }
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

    setStatus(dirCallStatus, "Ringing…");
  });
}

function cleanupCallUI(){
  if (hangupBtn) hangupBtn.disabled = true;
  activeCallId = null;
  if(unsubCallDoc){ unsubCallDoc(); unsubCallDoc=null; }
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
    updatedAt: serverTimestamp()
  }, { merge: true });

  myDisplayName = name;
  if (myNameInput) myNameInput.value = name || "";
  if (myNameStatus) myNameStatus.textContent = name ? `Saved: ${name}` : "Not set.";
}

async function saveMyName(){
  if(!requireAuthOrPrompt()) return;

  const name = String(myNameInput?.value || "").trim();
  if(!name) throw new Error("Name cannot be empty.");
  if(name.length > 40) throw new Error("Name is too long (max 40).");

  await setDoc(doc(db, "users", myUid), {
    displayName: name,
    updatedAt: serverTimestamp()
  }, { merge:true });

  myDisplayName = name;
  if (myNameStatus) myNameStatus.textContent = `Saved: ${name}`;
  logDiag("Saved displayName=" + name);
}

function chunk(arr, n){
  const out = [];
  for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i, i+n));
  return out;
}

function renderUsersList(filterText=""){
  if (!usersList) return;
  
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
  if (userSearchInput) {
    renderUsersList(userSearchInput.value);
  } else {
    renderUsersList("");
  }
  logDiag("Loaded users directory: " + users.length);
}

async function startCallToUid(toUid, toName=""){
  logDiag("startCallToUid(): ENTER toUid=" + toUid);

  if(!requireAuthOrPrompt()) return;
  if(!toUid) throw new Error("Missing toUid.");
  if(toUid === myUid) throw new Error("You can't call yourself.");

  setStatus(dirCallStatus, "Creating room…");
  const created = await createRoom();
  if(!created?.roomId) throw new Error("Room creation failed.");

  const note = String(callNoteInput?.value || "").trim().slice(0, 140);

  const callRef = await addDoc(collection(db,"calls"), {
    fromUid: myUid,
    toUid,
    fromName: myDisplayName || defaultNameFromEmail(emailInput?.value) || "(unknown)",
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
  
  if (hangupBtn) hangupBtn.disabled = false;
  listenActiveCall(activeCallId);
  setStatus(dirCallStatus, `Calling ${toName || "user"}…`);
  startRingback();
  logDiag(`Outgoing call created: ${callRef.id} roomId=${created.roomId}`);
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
  if (localVideo) localVideo.srcObject=null;

  if (startBtn) startBtn.disabled = !isAuthed;
  if (createBtn) createBtn.disabled = true;
  if (joinBtn) joinBtn.disabled = true;

  setStatus(mediaStatus, "Not started.");
  setStatus(callStatus, "No room yet.");

  refreshCopyInviteState();

  if (hangupBtn) hangupBtn.disabled = true;
  setStatus(dirCallStatus, "Idle.");

  logDiag("All stopped");
}

// ==================== BUTTON HANDLERS ====================
async function copyTextRobust(text){
  if(navigator.clipboard && window.isSecureContext){
    try{ 
      await navigator.clipboard.writeText(text); 
      return true; 
    }catch(e){
      logDiag("Clipboard write failed: " + e.message);
    }
  }
  window.prompt("Copy this invite link:", text);
  return false;
}

function refreshCopyInviteState(){
  if (!copyLinkBtn || !roomIdInput) return;
  
  const hasRoomId = !!roomIdInput.value.trim();
  const canCopy = isAuthed && hasRoomId;
  
  copyLinkBtn.disabled = !canCopy;
  
  logDiag(`refreshCopyInviteState: auth=${isAuthed}, hasRoomId=${hasRoomId}, disabled=${copyLinkBtn.disabled}`);
}

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

// ==================== INITIALIZE DOM ELEMENTS ====================
function initializeDomElements() {
  // Get all DOM elements
  errorBox = document.getElementById("errorBox");
  loginOverlay = document.getElementById("loginOverlay");
  loginBtn = document.getElementById("loginBtn");
  logoutBtn = document.getElementById("logoutBtn");
  loginStatus = document.getElementById("loginStatus");
  emailInput = document.getElementById("emailInput");
  passInput = document.getElementById("passInput");
  appRoot = document.getElementById("app");

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

  setupEventListeners();
}

function setupEventListeners() {
  // Login/Logout
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
        
        await signInWithEmailAndPassword(auth, email, password);
        
      } catch (e) {
        if (loginStatus) loginStatus.textContent = `Login failed: ${e?.code || "unknown"}`;
        logDiag(`Login error: ${e?.code} - ${e?.message}`);
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

  // Media and WebRTC
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
  
  // Invite link
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
    } else {
      setStatus(callStatus, "⚠️ Could not copy automatically");
    }
  };
  
  // Room ID input
  if (roomIdInput) {
    roomIdInput.addEventListener("input", () => refreshCopyInviteState());
  }
  
  // Audio test
  if (testSoundBtn) {
    testSoundBtn.onclick = async () => {
      await unlockAudio();
      startRingtone();
      setTimeout(() => stopRingtone(), 1800);
    };
  }
  
  // Video quality
  if (videoQualitySelect) {
    videoQualitySelect.addEventListener("change", () => {
      const v = String(videoQualitySelect.value || "medium");
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
  if (hangupBtn) hangupBtn.onclick = () => hangup().catch(showError);
  
  // User directory
  if (saveNameBtn) saveNameBtn.onclick = () => saveMyName().catch(showError);
  if (refreshUsersBtn) refreshUsersBtn.onclick = () => loadAllAllowedUsers().catch(showError);
  
  if (myNameInput) myNameInput.addEventListener("input", () => {
    if (saveNameBtn) saveNameBtn.disabled = !isAuthed || !String(myNameInput.value||"").trim();
  });
  
  if (userSearchInput) {
    userSearchInput.addEventListener("input", () => renderUsersList(userSearchInput.value));
  }
  
  // Incoming call buttons
  if (answerBtn) {
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

        activeCallId = id;
        if (hangupBtn) hangupBtn.disabled = false;
        listenActiveCall(id);

        if (roomIdInput && data.roomId) {
          roomIdInput.value = data.roomId;
        }

        setStatus(dirCallStatus, `Answered ${data.fromName || ""}. Joining room…`);

        await joinRoom();

        try { await listenIncomingCalls(); } catch {}
      }catch(e){
        showError(e);
      }
    };
  }

  if (declineBtn) {
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

        setStatus(dirCallStatus, "Declined incoming call.");
        try { await listenIncomingCalls(); } catch {}
      }catch(e){
        showError(e);
      }
    };
  }

  // Initialize diagnostics
  initializeDiagnostics();
}

// ==================== DIAGNOSTICS ====================
function initializeDiagnostics(){
  if (diagBtn && diagBox && copyDiagBtn && clearDiagBtn) {
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
    
    copyDiagBtn.disabled = diagLog.length === 0;
    clearDiagBtn.disabled = diagLog.length === 0;
  }
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
    try{ await listenIncomingCalls(); } catch(e){ logDiag("Incoming listener failed: " + (e?.message || e)); }

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

// Handle beforeunload
window.addEventListener("beforeunload", ()=>{
  try{ closePeer(); }catch{}
  try{ stopRingtone(); }catch{}
  try{ stopRingback(); }catch{}
});

console.log("WebRTC app initialization complete");
console.log("Firebase app:", app.name);
console.log("Ready for login...");
