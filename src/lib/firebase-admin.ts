import { initializeApp, getApps, getApp, cert, applicationDefault, type Credential } from "firebase-admin/app";
import { resolveAdminProjectId } from "./firebase-config";
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

function parseServiceAccountKey(raw: string) {
  const trimmed = raw.trim();
  const unwrapped =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  const candidates = [
    raw,
    trimmed,
    unwrapped,
    raw.replace(/\r?\n/g, '\\n'),
    trimmed.replace(/\r?\n/g, '\\n'),
    unwrapped.replace(/\r?\n/g, '\\n'),
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * Devolve a credencial **e o projeto a que ela pertence**, quando conhecido.
 *
 * O projeto acompanha a credencial porque é ele que resolve o alvo quando a configuração é omissa.
 * As Credenciais Padrão da Aplicação não carregam essa informação aqui, e por isso devolvem
 * `projectId` indefinido — a configuração continua mandando nesse caso.
 */
function getCredential(): { credential: Credential; projectId?: string } | undefined {
  // 1. Try explicit service account key from environment
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = parseServiceAccountKey(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      console.log("[Firebase Admin] Using credentials from FIREBASE_SERVICE_ACCOUNT_KEY env var");
      return { credential: cert(serviceAccount), projectId: serviceAccount.project_id };
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
      return { credential: cert(serviceAccount), projectId: serviceAccount.project_id };
    } catch (e) {
      console.error("Failed to read service-account.json:", e);
    }
  }

  // 3. Fall back to Application Default Credentials
  try {
    console.log("[Firebase Admin] Using Application Default Credentials");
    return { credential: applicationDefault() };
  } catch (e) {
    console.error("Failed to get Application Default Credentials:", e);
    return undefined;
  }
}

let app;

if (getApps().length === 0) {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  // A credencial vem antes do projeto: quando a configuração é omissa, é o `project_id` dela que
  // decide o alvo. O padrão anterior era fixo em produção, então uma credencial de outro projeto
  // era usada contra o Firestore de produção sem que nada dissesse isso.
  const resolved = emulatorHost ? undefined : getCredential();
  const projectId = resolveAdminProjectId({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    credentialProjectId: resolved?.projectId,
  });
  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    `${projectId}.firebasestorage.app`;

  if (emulatorHost && (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost) || !projectId.startsWith('demo-'))) {
    throw new Error('Local Firestore tests require a loopback emulator and a demo- project.');
  }
  if (resolved) {
    app = initializeApp({
      credential: resolved.credential,
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
