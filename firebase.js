// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDHCerO4kSlT4xftQFSTFmNWqlVXrP7ytQ",
  authDomain: "asian-club-48f5f.firebaseapp.com",
  projectId: "asian-club-48f5f",
  storageBucket: "asian-club-48f5f.firebasestorage.app",
  messagingSenderId: "1091116739869",
  appId: "1:1091116739869:web:d5a43aa9be8dc8a8e205f4",
  measurementId: "G-CRPZLCWTYH"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp };