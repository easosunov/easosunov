// ==================== IMPORT MODULES ====================
console.log('=== WEBRTC APP STARTING ===');

import { 
  initializeApp,
  getFirestore, doc, getDoc,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, inMemoryPersistence
} from './modules.js';

// ==================== GLOBAL DECLARATIONS ====================
console.log("APP VERSION:", "2026-01-08-minimal-fix");

// ==================== DOM ELEMENT REFERENCES ====================
const errorBox = document.getElementById("errorBox");
const loginOverlay = document.getElementById("loginOverlay");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");
const emailInput = document.getElementById("emailInput");
const passInput = document.getElementById("passInput");
const appRoot = document.getElementById("app");

// ==================== STATE VARIABLES ====================
let isAuthed = false;
let myUid = null;

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
    console.log("Auth persistence set to inMemory");
  } catch (error) {
    console.log("Auth initialization error:", error.message);
  }
})();

// ==================== ALLOWLIST ENFORCEMENT ====================
async function enforceAllowlist(user){
  const uid = user.uid;
  console.log("Allowlist check uid=" + uid);

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
  errorBox.style.display = "none";
  errorBox.textContent = "";
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
    console.log(`User signed in: ${user.email}, UID: ${user.uid}`);

  } catch (e) {
    loginStatus.textContent = `Login failed: ${e?.code || "unknown"}`;
    console.log(`Login error: ${e?.code} - ${e?.message}`);
    errorBox.style.display = "block";
    errorBox.textContent = e.message || String(e);
  }
};

logoutBtn.onclick = async () => {
  try{
    await signOut(auth);
  }catch(e){
    console.error("Logout error:", e);
  }
};

// ==================== AUTH STATE LISTENER ====================
onAuthStateChanged(auth, async (user)=>{
  isAuthed = !!user;
  myUid = user?.uid || null;
  console.log(isAuthed ? "Auth: signed in" : "Auth: signed out");

  if (isAuthed){
    try{ 
      await enforceAllowlist(user); 
    } catch(e){
      errorBox.style.display = "block";
      errorBox.textContent = e.message;
      loginOverlay.style.display = "flex";
      appRoot.classList.add("locked");
      logoutBtn.style.display = "none";
      return;
    }

    loginOverlay.style.display = "none";
    appRoot.classList.remove("locked");
    logoutBtn.style.display = "inline-block";
    loginStatus.textContent = "Signed in successfully!";

  } else {
    loginOverlay.style.display = "flex";
    appRoot.classList.add("locked");
    logoutBtn.style.display = "none";
    loginStatus.textContent = "Please sign in";
  }
});

// ==================== INITIALIZATION ====================
console.log("WebRTC app initialization complete");
console.log("Firebase app:", app.name);
console.log("Ready for login...");
