'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Details = {
  user: { name: string; email: string };
  authorization: { client: { name: string }; redirect_uri: string; scope: string };
  capabilities: { key: string; label: string; description: string; write: boolean }[];
};
type Connection = { id: string; clientName: string; status: string };
class RequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api/mcp-auth/${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new RequestError(
    typeof data?.error === 'string' ? data.error : 'Não foi possível concluir a solicitação. Inicie novamente a conexão no Claude.',
    typeof data?.code === 'string' ? data.code : 'UNAVAILABLE', response.status,
  );
  return data as T;
}
const errorMessage = (error: unknown) => error instanceof RequestError ? error.message : 'Não foi possível conectar ao serviço. Inicie novamente a conexão no Claude.';

export default function ConsentClient({ authorizationId }: { authorizationId: string }) {
  const initialization = useRef<Promise<Details> | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reconsent, setReconsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const decisionStarted = useRef(false);

  useEffect(() => {
    let active = true;
    // Reuse the same operation during Strict Mode effect replay; never retry provisioning automatically.
    initialization.current ??= request('session', 'POST', { authorization_id: authorizationId })
      .then(() => request<Details>(`authorization?authorization_id=${encodeURIComponent(authorizationId)}`));
    initialization.current.then(data => {
      if (!active) return;
      setDetails(data);
      setSelected(data.capabilities.filter(item => !item.write).map(item => item.key));
    }).catch(reason => {
      if (!active) return;
      setError(errorMessage(reason));
      setReconsent(reason instanceof RequestError && reason.status === 409 && reason.code === 'RECONSENT_REQUIRED');
    });
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(decision: 'approve' | 'deny') {
    if (decisionStarted.current) return;
    decisionStarted.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ redirectUrl: string }>('decision', 'POST', {
        authorization_id: authorizationId, decision, capabilities: decision === 'approve' ? selected : [],
      });
      // The server validates this destination against the provider's registered callback.
      window.location.assign(result.redirectUrl);
    } catch (reason) {
      setError(`${errorMessage(reason)} Inicie uma nova conexão no Claude para tentar novamente.`);
      setBusy(false);
      // The decision may already have reached the provider; do not repeat it from this page.
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-muted p-4">
    <Card className="w-full max-w-2xl">
      <CardHeader><CardTitle>Conectar ao BR Steel</CardTitle><CardDescription>Revise a conta e as permissões antes de autorizar o aplicativo.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{error}</p>}
        {!details && !error && <p role="status">Preparando autorização…</p>}
        {reconsent && <Connections />}
        {details && <>
          <dl className="space-y-3 text-sm">
            <div><dt className="font-medium">Conta conectada</dt><dd>{details.user.name} — {details.user.email}</dd></div>
            <div><dt className="font-medium">Aplicativo</dt><dd>{details.authorization.client.name}</dd></div>
            <div><dt className="font-medium">Endereço de retorno</dt><dd className="break-all">{details.authorization.redirect_uri}</dd></div>
            <div><dt className="font-medium">Escopos OAuth solicitados</dt><dd className="break-words">{details.authorization.scope || 'Nenhum escopo adicional'}</dd></div>
          </dl>
          <fieldset disabled={busy || decisionStarted.current} className="space-y-3">
            <legend className="mb-3 font-medium">Permissões no BR Steel</legend>
            {details.capabilities.length === 0 && <p className="text-sm">Sua conta não tem operações disponíveis para este conector.</p>}
            {details.capabilities.map(item => <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={selected.includes(item.key)} onChange={event => setSelected(values => event.target.checked ? [...values, item.key] : values.filter(key => key !== item.key))} />
              <span><span className="font-medium">{item.label}{item.write ? ' (altera dados)' : ''}</span><span className="block text-sm text-muted-foreground">{item.description}</span></span>
            </label>)}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || decisionStarted.current || !selected.length} onClick={() => void decide('approve')}>{busy ? 'Processando…' : 'Autorizar permissões selecionadas'}</Button>
            <Button variant="outline" disabled={busy || decisionStarted.current} onClick={() => void decide('deny')}>Negar</Button>
          </div>
        </>}
      </CardContent>
    </Card>
  </main>;
}

function Connections() {
  const initial = useRef<Promise<{ connections: Connection[] }> | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const revoking = useRef(false);
  useEffect(() => {
    let active = true;
    initial.current ??= request<{ connections: Connection[] }>('connections');
    initial.current.then(data => { if (active) setConnections(data.connections); })
      .catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, []);
  async function revoke(id: string) {
    if (revoking.current) return;
    revoking.current = true;
    setBusy(id); setError(''); setNotice('');
    try {
      await request('connections', 'DELETE', { connection_id: id });
      setConnections(values => values?.map(item => item.id === id ? { ...item, status: 'revoked' } : item) ?? null);
      setNotice('Conexão revogada. Reinicie a conexão no Claude para escolher as permissões novamente.');
    } catch (reason) {
      setError(errorMessage(reason));
      if (reason instanceof RequestError && reason.status === 503) {
        setNotice('Se a revogação ficou pendente, o acesso permanece bloqueado localmente. Use “Revogar conexão” novamente para concluir antes de reconectar.');
      }
    } finally { revoking.current = false; setBusy(null); }
  }
  return <section className="space-y-3" aria-label="Minhas conexões">
    <h2 className="font-medium">Minhas conexões</h2>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!connections && !error && <p role="status">Carregando conexões…</p>}
    {connections?.length === 0 && <p className="text-sm">Nenhuma conexão encontrada. Reinicie a conexão no Claude.</p>}
    {connections?.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span>{item.clientName}{item.status === 'revoked' ? ' — revogada' : item.status === 'revocation_pending' ? ' — revogação pendente' : ''}</span>
      <Button variant="outline" disabled={busy !== null || item.status === 'revoked'} onClick={() => void revoke(item.id)}>{busy === item.id ? 'Revogando…' : 'Revogar conexão'}</Button>
    </div>)}
  </section>;
}
