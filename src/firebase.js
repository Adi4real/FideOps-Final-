// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth"; // Add this
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

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
export const db = getFirestore(app);
export const auth = getAuth(app); // Add this export