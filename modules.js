// ==================== FIREBASE IMPORTS ====================
export { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
export {
  getFirestore, doc, collection, addDoc, setDoc, getDoc, updateDoc,
  onSnapshot, getDocs, writeBatch, query, where, limit, orderBy, serverTimestamp,
  documentId, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export { getMessaging, getToken, onMessage, deleteToken }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

export {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
