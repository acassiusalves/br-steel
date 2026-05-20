import { adminDb } from '@/lib/firebase-admin';

const GEMINI_CONFIG_DOC = adminDb.collection('appConfig').doc('geminiCredentials');

export type GeminiConfigSource = 'firestore' | 'env' | 'none';

export type GeminiCredentialsPublic = {
  apiKey: string;
  configured: boolean;
  source: GeminiConfigSource;
  updatedAt?: number;
};

function envGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    ''
  ).trim();
}

export async function getGeminiApiKeyAdmin(): Promise<string> {
  const snap = await GEMINI_CONFIG_DOC.get();
  const data = snap.exists ? (snap.data() as { apiKey?: string }) : {};
  const saved = String(data?.apiKey || '').trim();
  return saved || envGeminiApiKey();
}

export async function getGeminiCredentialsAdmin(): Promise<GeminiCredentialsPublic> {
  const snap = await GEMINI_CONFIG_DOC.get();
  const data = snap.exists
    ? (snap.data() as { apiKey?: string; updatedAt?: number })
    : {};
  const hasSavedKey = !!String(data?.apiKey || '').trim();
  const hasEnvKey = !!envGeminiApiKey();

  return {
    apiKey: hasSavedKey || hasEnvKey ? '********' : '',
    configured: hasSavedKey || hasEnvKey,
    source: hasSavedKey ? 'firestore' : hasEnvKey ? 'env' : 'none',
    updatedAt: data?.updatedAt,
  };
}

export async function saveGeminiCredentialsAdmin(partial: {
  apiKey?: string;
}): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: Date.now() };
  if (partial.apiKey !== undefined) {
    const apiKey = String(partial.apiKey || '').trim();
    if (!apiKey) throw new Error('Chave Gemini vazia.');
    update.apiKey = apiKey;
  }
  await GEMINI_CONFIG_DOC.set(update, { merge: true });
}
