import 'server-only';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { pagePermissions } from '@/lib/permissions';
import { findUserById, isKnownRole, publicUser, validDocumentId } from '@/server/access/users';
import { canAccessPage } from '@/server/access/policy';
import type { User } from '@/types/user';
export { findUserByEmail, normalizeUserEmail } from '@/server/access/users';
export { DEFAULT_INITIAL_PASSWORD, hashPassword, verifyPassword } from '@/server/access/passwords';

export const AUTH_COOKIE_NAME = 'brsteel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export interface SessionUser { id: string; name: string; email: string; role: string; }
export interface SessionPayload { user: SessionUser; exp: number; authVersion: number; }

function getSecret() {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SESSION_SECRET must be configured in production');
  return 'brsteel-dev-session-secret';
}
function sign(value: string) { return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url'); }
export function createSessionToken(user: SessionUser, authVersion = 0) {
  const payload = Buffer.from(JSON.stringify({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    exp: Date.now() + SESSION_TTL_MS, authVersion,
  } satisfies SessionPayload)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
/** Verifies the signature only. Authorization must use getSessionFromToken. */
export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [payload, signature] = parts;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || !Number.isSafeInteger(parsed.exp) || parsed.exp <= Date.now()
      || typeof parsed.user?.id !== 'string' || !validDocumentId(parsed.user.id)
      || typeof parsed.user.email !== 'string' || !parsed.user.email
      || typeof parsed.user.name !== 'string' || !isKnownRole(parsed.user.role)
      || (parsed.authVersion !== undefined && (!Number.isSafeInteger(parsed.authVersion) || parsed.authVersion < 0))) return null;
    return { user: parsed.user, exp: parsed.exp, authVersion: parsed.authVersion ?? 0 };
  } catch { return null; }
}
export async function getSessionFromToken(token?: string | null): Promise<(SessionPayload & { user: User }) | null> {
  const session = verifySessionToken(token);
  if (!session) return null;
  const stored = await findUserById(session.user.id);
  if (!stored || stored.active === false || !isKnownRole(stored.role) || stored.authVersion !== session.authVersion) return null;
  return { ...session, user: publicUser(stored) };
}
export async function getSessionFromRequest(request: Request) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(p => p.trim())
    .find(p => p.startsWith(`${AUTH_COOKIE_NAME}=`));
  if (!cookie) return null;
  let token: string;
  try { token = decodeURIComponent(cookie.slice(AUTH_COOKIE_NAME.length + 1)); } catch { return null; }
  return getSessionFromToken(token);
}
export function sessionCookieHeader(token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}
export function clearSessionCookieHeader() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export async function loadAppAccessSettings() {
  const snap = await adminDb.collection('appSettings').doc('general').get();
  const data = snap.data() || {};
  const permissions: Record<string, string[]> = { ...pagePermissions };
  for (const [page, roles] of Object.entries(data.permissions || {})) {
    if (Object.hasOwn(pagePermissions, page)) permissions[page] = Array.isArray(roles) ? roles.filter(isKnownRole) : [];
  }
  return { permissions, inactivePages: Array.isArray(data.inactivePages)
    ? data.inactivePages.filter((p: unknown): p is string => typeof p === 'string') : [] };
}
export async function requirePagePermission(request: Request, pagePath: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) };
  const settings = await loadAppAccessSettings();
  if (!canAccessPage(session.user, settings, pagePath)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, user: session.user };
}
