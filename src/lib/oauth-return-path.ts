// GoTrue authorization IDs are opaque, unlike user/client UUIDs.
export const authorizationIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
export function consentReturnPath(id: string) {
  if (!authorizationIdPattern.test(id)) throw new Error('Solicitação de autorização inválida.');
  return `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
}
export function safeOAuthReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/oauth/consent?') || value.includes('\\')) return null;
  try {
    const url = new URL(value, 'https://local.invalid');
    const ids = url.searchParams.getAll('authorization_id');
    if (url.origin !== 'https://local.invalid' || url.pathname !== '/oauth/consent' || url.hash
      || [...url.searchParams.keys()].some(k => k !== 'authorization_id') || ids.length !== 1) return null;
    return consentReturnPath(ids[0]);
  } catch { return null; }
}
