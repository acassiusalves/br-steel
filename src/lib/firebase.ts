// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, initializeFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  "projectId": "marketflow-9h4tg",
  "appId": "1:679366570902:web:fb3de53fc9bb508514a3b7",
  "storageBucket": "marketflow-9h4tg.firebasestorage.app",
  "apiKey": "AIzaSyC_mnz6n_XQ7f4fdbGCaS3zwT26wKTumaI",
  "authDomain": "marketflow-9h4tg.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "679366570902"
};

// Initialize Firebase
const emulatorHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
const emulatorProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (emulatorHost && (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost) || !emulatorProject?.startsWith('demo-'))) {
  throw new Error('Local Firestore tests require a loopback emulator and a demo- project.');
}
const config = emulatorHost ? { projectId: emulatorProject, apiKey: 'demo-key', appId: 'demo-brsteel' } : firebaseConfig;
const app = !getApps().length ? initializeApp(config) : getApp();
const db = emulatorHost ? initializeFirestore(app, { host: emulatorHost, ssl: false }) : getFirestore(app);

export { app, db };
