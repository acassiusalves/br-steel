import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE_NAME, getSessionFromToken } from '@/lib/server-auth';
import { consentReturnPath } from '@/lib/oauth-return-path';
import { oauthEnabled } from '@/server/oauth/config';
import { consentDestination } from '@/server/oauth/consent-routing';
import ConsentClient from './ConsentClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ConsentPage({ searchParams }: {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
  if (!oauthEnabled()) return <Message text="O conector ainda não está habilitado neste ambiente." />;
  const { authorization_id: id } = await searchParams;
  let next: string;
  try {
    if (typeof id !== 'string') throw new Error('invalid');
    next = consentReturnPath(id);
  } catch {
    return <Message text="Solicitação de autorização inválida. Inicie novamente a conexão no Claude." />;
  }
  let destination: string | null;
  try { destination = await consentDestination(id as string); }
  catch { return <Message text="Não foi possível validar esta solicitação. Inicie novamente a conexão no Claude." />; }
  if (destination) redirect(destination);
  const session = await getSessionFromToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (session.user.mustChangePassword) redirect(`/perfil?next=${encodeURIComponent(next)}`);
  return <ConsentClient key={id} authorizationId={id as string} />;
}

function Message({ text }: { text: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-muted p-4"><p role="status" className="max-w-lg rounded-lg border bg-card p-6">{text}</p></main>;
}
