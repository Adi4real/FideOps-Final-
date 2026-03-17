// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// Import the specific Firestore caching functions
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth"; 

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDaNkbXNMUk7MXLAiubytONsx1La3vz3oU",
  authDomain: "fideops-2abc8.firebaseapp.com",
  projectId: "fideops-2abc8",
  storageBucket: "fideops-2abc8.firebasestorage.app",
  messagingSenderId: "792552638927",
  appId: "1:792552638927:web:d1d39882caff36ea86eaba"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with Multiple Tab Local Caching enabled
// This forces Firebase to read from the user's hard drive instead of charging you for server reads!
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const auth = getAuth(app);