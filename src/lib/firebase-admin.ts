import { initializeApp, getApps, getApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as fs from "fs";
import * as path from "path";

// Firebase Admin SDK initialization
// Priority order:
// 1. FIREBASE_SERVICE_ACCOUNT_KEY environment variable (JSON string)
// 2. service-account.json file in project root
// 3. Application Default Credentials

function getCredential() {
  // 1. Try explicit service account key from environment
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      console.log("[Firebase Admin] Using credentials from FIREBASE_SERVICE_ACCOUNT_KEY env var");
      return cert(serviceAccount);
    } catch (e) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", e);
    }
  }

  // 2. Try service-account.json file in project root
  const serviceAccountPath = path.join(process.cwd(), "service-account.json");
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
      console.log("[Firebase Admin] Using credentials from service-account.json");
      return cert(serviceAccount);
    } catch (e) {
      console.error("Failed to read service-account.json:", e);
    }
  }

  // 3. Fall back to Application Default Credentials
  try {
    console.log("[Firebase Admin] Using Application Default Credentials");
    return applicationDefault();
  } catch (e) {
    console.error("Failed to get Application Default Credentials:", e);
    return undefined;
  }
}

let app;

// Get project ID and storage bucket from environment
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;

if (getApps().length === 0) {
  const credential = getCredential();
  if (credential) {
    app = initializeApp({
      credential,
      projectId,
      storageBucket,
    });
    console.log("[Firebase Admin] Initialized with storageBucket:", storageBucket);
  } else if (projectId) {
    // Initialize with just projectId (useful for emulator or local dev with gcloud auth)
    console.warn("Firebase Admin: No credentials, but projectId found. Using project:", projectId);
    app = initializeApp({ projectId, storageBucket });
  } else {
    // Initialize without credentials (will fail on first use if auth is required)
    console.warn("Firebase Admin: No credentials available. Authentication will fail.");
    app = initializeApp();
  }
} else {
  app = getApp();
}

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const adminMessaging = getMessaging(app);
