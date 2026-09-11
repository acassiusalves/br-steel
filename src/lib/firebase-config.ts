export const legacyFirebaseConfig = {
  "projectId": "marketflow-9h4tg",
  "appId": "1:679366570902:web:fb3de53fc9bb508514a3b7",
  "storageBucket": "marketflow-9h4tg.firebasestorage.app",
  "apiKey": "AIzaSyC_mnz6n_XQ7f4fdbGCaS3zwT26wKTumaI",
  "authDomain": "marketflow-9h4tg.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "679366570902"
};

export type FirebaseClientEnvironment = Partial<Record<'projectId' | 'apiKey' | 'appId' | 'authDomain' | 'storageBucket' | 'messagingSenderId' | 'measurementId' | 'emulatorHost', string>>;

export function resolveFirebaseConfig(env: FirebaseClientEnvironment) {
  if (env.emulatorHost && (!/^(127\.0\.0\.1|localhost):\d+$/.test(env.emulatorHost) || !env.projectId?.startsWith('demo-'))) {
    throw new Error('Local Firestore tests require a loopback emulator and a demo- project.');
  }
  if (env.emulatorHost) return { projectId: env.projectId, apiKey: 'demo-key', appId: 'demo-brsteel' };

  // Preserve deployments that have not opted into a different Firebase project.
  if (!env.projectId || env.projectId === legacyFirebaseConfig.projectId) return { ...legacyFirebaseConfig };

  const requiredFields = ['apiKey', 'appId', 'authDomain', 'storageBucket', 'messagingSenderId'] as const;
  for (const field of requiredFields) {
    if (!env[field]?.trim()) throw new Error(`Firebase configuration requires ${field} for a project override.`);
    if (env[field] === legacyFirebaseConfig[field]) {
      throw new Error(`Firebase configuration ${field} must not reference the legacy project.`);
    }
  }
  if (env.authDomain !== `${env.projectId}.firebaseapp.com`) {
    throw new Error('Firebase configuration authDomain must match projectId.');
  }
  if (![`${env.projectId}.firebasestorage.app`, `${env.projectId}.appspot.com`].includes(env.storageBucket!)) {
    throw new Error('Firebase configuration storageBucket must match projectId.');
  }
  if (!env.appId!.startsWith(`1:${env.messagingSenderId}:web:`)) {
    throw new Error('Firebase configuration appId must match messagingSenderId.');
  }
  return {
    projectId: env.projectId,
    apiKey: env.apiKey!, appId: env.appId!, authDomain: env.authDomain!,
    storageBucket: env.storageBucket!, messagingSenderId: env.messagingSenderId!,
    measurementId: env.measurementId ?? '',
  };
}
