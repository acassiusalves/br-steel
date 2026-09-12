import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { User } from '@/types/user';
import { availableRoles } from '@/lib/permissions';
import { needsPasswordChange } from './passwords';

export interface StoredUser extends User {
  normalizedEmail?: string;
  passwordHash?: string;
  passwordSalt?: string;
  authVersion: number;
}
export const normalizeUserEmail = (email: string) => email.trim().toLowerCase();
export const isKnownRole = (role: unknown): role is string => availableRoles.some(r => r.key === role);
export function validDocumentId(value: string) {
  return !!value && value !== '.' && value !== '..' && !value.includes('/') && Buffer.byteLength(value) <= 1500;
}
function iso(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
}
export function storedUserFromDoc(id: string, data: FirebaseFirestore.DocumentData): StoredUser {
  return {
    id, name: typeof data.name === 'string' ? data.name : '',
    email: normalizeUserEmail(String(data.email || data.normalizedEmail || id)),
    role: typeof data.role === 'string' ? data.role : '',
    active: data.active !== false,
    createdAt: iso(data.createdAt), lastLogin: iso(data.lastLogin),
    mustChangePassword: data.mustChangePassword === true,
    passwordHash: typeof data.passwordHash === 'string' ? data.passwordHash : undefined,
    passwordSalt: typeof data.passwordSalt === 'string' ? data.passwordSalt : undefined,
    authVersion: Number.isSafeInteger(data.authVersion) && data.authVersion >= 0 ? data.authVersion : 0,
  };
}
export function publicUser(user: StoredUser): User {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    active: user.active !== false, mustChangePassword: needsPasswordChange(user),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.lastLogin ? { lastLogin: user.lastLogin } : {}),
  };
}
export async function findUserById(id: string): Promise<StoredUser | null> {
  if (!validDocumentId(id)) return null;
  const doc = await adminDb.collection('users').doc(id).get();
  return doc.exists ? storedUserFromDoc(doc.id, doc.data()!) : null;
}
export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = normalizeUserEmail(email);
  if (!normalized || !validDocumentId(normalized)) return null;
  const users = adminDb.collection('users');
  const direct = await users.doc(normalized).get();
  if (direct.exists) {
    const user = storedUserFromDoc(direct.id, direct.data()!);
    if (user.email === normalized) return user;
  }
  for (const field of ['normalizedEmail', 'email']) {
    const matches = await users.where(field, '==', normalized).limit(1).get();
    if (!matches.empty) return storedUserFromDoc(matches.docs[0].id, matches.docs[0].data());
  }
  // Legacy mixed-case emails with random document IDs still work.
  const all = await users.get();
  const match = all.docs.find(doc => normalizeUserEmail(String(doc.data().email || doc.data().normalizedEmail || doc.id)) === normalized);
  return match ? storedUserFromDoc(match.id, match.data()) : null;
}
