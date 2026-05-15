import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
  collection,
  doc as firestoreDoc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { pagePermissions } from '@/lib/permissions';

export const AUTH_COOKIE_NAME = 'brsteel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_LEGACY_PASSWORD = '123456';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface SessionPayload {
  user: SessionUser;
  exp: number;
}

interface StoredUser extends SessionUser {
  passwordHash?: string | null;
  passwordSalt?: string | null;
  mustChangePassword?: boolean;
}

function getSecret() {
  return (
    process.env.AUTH_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.BR_STEEL_WEBHOOK_SECRET ||
    'brsteel-dev-session-secret'
  );
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function parseCookies(cookieHeader?: string | null) {
  const cookies: Record<string, string> = {};
  for (const part of (cookieHeader || '').split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join('=') || '');
  }
  return cookies;
}

export function createSessionToken(user: SessionUser) {
  const payload = base64url(
    JSON.stringify({
      user,
      exp: Date.now() + SESSION_TTL_MS,
    } satisfies SessionPayload)
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed?.user?.email || !parsed?.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: Request) {
  const token = parseCookies(request.headers.get('cookie'))[AUTH_COOKIE_NAME];
  return verifySessionToken(token);
}

export function sessionCookieHeader(token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_TTL_MS / 1000
  }${secure}`;
}

export function clearSessionCookieHeader() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return { hash, salt };
}

export function verifyPassword(password: string, hash?: string | null, salt?: string | null) {
  if (!hash || !salt) return password === DEFAULT_LEGACY_PASSWORD;
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'base64url');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const direct = await getDoc(firestoreDoc(db, 'users', normalized));
  if (direct.exists()) {
    const data = direct.data() as any;
    return {
      id: direct.id,
      name: data.name,
      email: data.email || normalized,
      role: data.role,
      passwordHash: data.passwordHash,
      passwordSalt: data.passwordSalt,
      mustChangePassword: data.mustChangePassword,
    };
  }

  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', normalized), limit(1)));
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as any;
  return {
    id: doc.id,
    name: data.name,
    email: data.email || normalized,
    role: data.role,
    passwordHash: data.passwordHash,
    passwordSalt: data.passwordSalt,
    mustChangePassword: data.mustChangePassword,
  };
}

export async function loadAppAccessSettings() {
  const snap = await getDoc(firestoreDoc(db, 'appSettings', 'general'));
  const data = snap.exists() ? (snap.data() as any) : {};
  return {
    permissions: { ...pagePermissions, ...(data.permissions || {}) },
    inactivePages: Array.isArray(data.inactivePages) ? data.inactivePages : [],
  };
}

export async function requirePagePermission(request: Request, pagePath: string) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }),
    };
  }

  const { permissions, inactivePages } = await loadAppAccessSettings();
  const role = session.user.role;
  const allowed = role === 'Administrador' || permissions[pagePath]?.includes(role);
  const active = !inactivePages.includes(pagePath);
  if (!allowed || !active) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }),
    };
  }

  return { ok: true as const, user: session.user };
}
