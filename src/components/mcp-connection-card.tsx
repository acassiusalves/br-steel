'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Check, Copy, Loader2, Plug } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import type { Capability } from '@/server/access/types';

type Connection = {
  id: string;
  clientName: string;
  capabilities: Capability[];
  status: 'pending' | 'active' | 'revocation_pending' | 'revoked';
  approvedAt: number | null;
  revokedAt: number | null;
  lastSeenAt: number | null;
};

// Same definitions the consent screen uses. Duplicating the labels here is how the catalogue and the
// consent text drift apart, which is exactly what went wrong in Calculaqui.
const label = (key: Capability) => mcpCapabilities.find(item => item.key === key)?.label ?? key;

const moment = (value: number | null) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : null;

const STATUS: Record<Connection['status'], { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { text: 'Autorizada', variant: 'default' },
  pending: { text: 'Autorização em andamento', variant: 'secondary' },
  revocation_pending: { text: 'Revogação em andamento', variant: 'destructive' },
  revoked: { text: 'Revogada', variant: 'outline' },
};

export function McpConnectionCard() {
  const { toast } = useToast();
  const [connections, setConnections] = React.useState<Connection[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [endpoint, setEndpoint] = React.useState('');

  React.useEffect(() => { setEndpoint(`${window.location.origin}/api/mcp`); }, []);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/mcp-auth/connections', { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json();
      setConnections(body.connections ?? []);
      setFailed(false);
    } catch {
      // An empty list would claim "no connections", which is a different thing from "we could not check".
      setConnections(null);
      setFailed(true);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Não foi possível copiar', description: 'Selecione o endereço e copie manualmente.' });
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      const response = await fetch('/api/mcp-auth/connections', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connection_id: id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error_description || 'Não foi possível revogar agora.');
      toast({ title: 'Conexão revogada', description: 'O Claude perde o acesso imediatamente.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Revogação não concluída', description: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setRevoking(null);
      await load();
    }
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Plug className="h-5 w-5" /> Claude conectado</CardTitle>
        <CardDescription>
          Cadastre o endereço abaixo no seu Claude pessoal para consultar vendas, estoque, insumos e produção.
          O Claude vê somente o que você já pode ver no sistema, e não altera nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Endereço do conector</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">{endpoint || '…'}</code>
            <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!endpoint}>
              {copied ? <><Check className="mr-1 h-4 w-4" /> Copiado</> : <><Copy className="mr-1 h-4 w-4" /> Copiar</>}
            </Button>
          </div>
        </div>

        <Separator />

        {failed && (
          <p className="text-sm text-muted-foreground">
            Não foi possível consultar suas conexões agora. Recarregue a página — isto não significa que não há conexões.
          </p>
        )}
        {!failed && connections === null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        )}
        {!failed && connections?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma conexão autorizada. Use o endereço acima no seu Claude para criar uma.</p>
        )}

        {connections?.map(connection => {
          const status = STATUS[connection.status] ?? STATUS.pending;
          const approved = moment(connection.approvedAt);
          const lastSeen = moment(connection.lastSeenAt);
          const revoked = moment(connection.revokedAt);
          return (
            <div key={connection.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{connection.clientName}</p>
                <Badge variant={status.variant}>{status.text}</Badge>
              </div>

              <div className="flex flex-wrap gap-1">
                {connection.capabilities.map(capability => (
                  <Badge key={capability} variant="secondary" className="font-normal">{label(capability)}</Badge>
                ))}
              </div>

              <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                {approved && <div><dt className="inline">Autorizada em </dt><dd className="inline">{approved}</dd></div>}
                <div>
                  <dt className="inline">Último uso: </dt>
                  {/* Never used is not the same as unknown, and both differ from revoked. */}
                  <dd className="inline">{lastSeen ?? 'nunca utilizada'}</dd>
                </div>
                {revoked && <div><dt className="inline">Revogada em </dt><dd className="inline">{revoked}</dd></div>}
              </dl>

              {connection.status !== 'revoked' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" size="sm" disabled={revoking === connection.id}>
                      {revoking === connection.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      Revogar acesso
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revogar o acesso de {connection.clientName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        O Claude perde o acesso imediatamente. Para reconectar depois, cadastre o endereço do
                        conector novamente e autorize outra vez — nada do que já foi consultado é apagado.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void revoke(connection.id)}>Revogar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
