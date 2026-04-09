import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

/**
 * Wait for Firebase auth to be ready and return the current user
 */
function waitForAuth(): Promise<typeof auth.currentUser> {
  return new Promise((resolve) => {
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * Fetch wrapper that automatically adds Firebase authentication token
 * Use this for all internal API calls that require authentication
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const user = await waitForAuth();
  const token = await user?.getIdToken();

  if (!token) {
    throw new Error('Usuário não autenticado');
  }

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    },
  });
}

/**
 * Authenticated fetch for JSON requests
 * Automatically sets Content-Type and parses response
 */
export async function authenticatedFetchJson<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP ${response.status}`);
  }

  return response.json();
}
