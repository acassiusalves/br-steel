'use client';

import * as React from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  Loader2,
  RefreshCw,
  Send,
  Paperclip,
  AlertTriangle,
  CheckCheck,
  Check,
} from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import {
  ML_MESSAGE_MAX_LENGTH,
  ML_ATTACHMENT_ALLOWED_EXTS,
  ML_ATTACHMENT_MAX_BYTES,
  type MlChatConversationDoc,
  type MlChatMessageDoc,
} from '@/lib/ml-chat-types';
import { describeSubstatus } from '@/lib/ml-chat-substatus';
import { listMlAccounts, type MlAccountSummary } from '@/app/actions';

// ============================================================================
// Helpers
// ============================================================================

function formatTime(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(epoch?: number | null) {
  if (!epoch) return '';
  const d = new Date(epoch);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function validateAttachment(file: File): string | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ML_ATTACHMENT_ALLOWED_EXTS.includes(ext as any)) {
    return `Extensão .${ext} não é permitida (use JPG, PNG, PDF ou TXT).`;
  }
  if (file.size > ML_ATTACHMENT_MAX_BYTES) {
    return 'Arquivo maior que 25 MB.';
  }
  return null;
}

// ============================================================================
// Conversation list
// ============================================================================

function ConversationList(props: {
  accountId: string | null;
  selectedPackId: string | null;
  onSelect: (packId: string) => void;
}) {
  const [conversations, setConversations] = React.useState<MlChatConversationDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'blocked'>('all');

  React.useEffect(() => {
    if (!props.accountId) return;
    setLoading(true);
    const q = query(
      collection(db, 'mercadoLivreConversations'),
      where('accountId', '==', props.accountId),
      orderBy('lastMessageAt', 'desc'),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ ...(d.data() as MlChatConversationDoc), packId: d.id }));
        setConversations(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[chat] erro list conversations', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [props.accountId]);

  const filtered = React.useMemo(() => {
    return conversations.filter((c) => {
      if (filter === 'unread') return (c.unreadCount || 0) > 0;
      if (filter === 'blocked') return c.status === 'blocked';
      return true;
    });
  }, [conversations, filter]);

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold">Conversas</h2>
        <div className="flex gap-1">
          {(['all', 'unread', 'blocked'] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter === k ? 'default' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => setFilter(k)}
            >
              {k === 'all' ? 'Todas' : k === 'unread' ? 'Não lidas' : 'Bloqueadas'}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada.
          </div>
        )}
        {!loading &&
          filtered.map((c) => {
            const selected = c.packId === props.selectedPackId;
            return (
              <button
                key={c.packId}
                onClick={() => props.onSelect(c.packId)}
                className={cn(
                  'flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50',
                  selected && 'bg-muted'
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {(c.buyerName || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.buyerName || `Comprador ${c.buyerId || ''}`}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {c.lastMessageDirection === 'out' ? 'Você: ' : ''}
                      {c.lastMessagePreview || '—'}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {c.status === 'blocked' && (
                        <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                          bloq.
                        </Badge>
                      )}
                      {(c.unreadCount || 0) > 0 && (
                        <Badge className="h-4 min-w-4 px-1 text-[10px]">{c.unreadCount}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    pack {c.packId}
                  </div>
                </div>
              </button>
            );
          })}
      </ScrollArea>
    </Card>
  );
}

// ============================================================================
// Conversation panel
// ============================================================================

function ConversationPanel(props: { accountId: string; packId: string | null }) {
  const { toast } = useToast();
  const [conv, setConv] = React.useState<MlChatConversationDoc | null>(null);
  const [messages, setMessages] = React.useState<MlChatMessageDoc[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [text, setText] = React.useState('');
  const [attachments, setAttachments] = React.useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Subscribe à conversa selecionada
  React.useEffect(() => {
    setConv(null);
    setMessages([]);
    setText('');
    setAttachments([]);
    if (!props.packId) return;
    setLoading(true);
    const ref = doc(db, 'mercadoLivreConversations', props.packId);
    const unsubConv = onSnapshot(ref, (snap) => {
      const d = snap.data() as MlChatConversationDoc | undefined;
      if (d) setConv({ ...d, packId: snap.id });
    });
    const msgsQ = query(
      collection(db, 'mercadoLivreConversations', props.packId, 'messages'),
      orderBy('sortKey', 'asc')
    );
    const unsubMsgs = onSnapshot(
      msgsQ,
      (snap) => {
        setMessages(snap.docs.map((d) => d.data() as MlChatMessageDoc));
        setLoading(false);
        // scroll to bottom on first load / new message
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 60);
      },
      () => setLoading(false)
    );
    return () => {
      unsubConv();
      unsubMsgs();
    };
  }, [props.packId]);

  // Ao abrir, força refresh+mark-read no ML
  React.useEffect(() => {
    if (!props.packId || !props.accountId) return;
    fetch(
      `/api/ml/chat/conversations/${props.packId}?accountId=${props.accountId}&markRead=1`,
      { method: 'POST' }
    ).catch(() => undefined);
  }, [props.packId, props.accountId]);

  const handleRefresh = async () => {
    if (!props.packId) return;
    setRefreshing(true);
    try {
      const r = await fetch(
        `/api/ml/chat/conversations/${props.packId}?accountId=${props.accountId}`,
        { method: 'GET' }
      );
      if (!r.ok) throw new Error('Falha ao sincronizar');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e?.message || String(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const handlePickFile = async (file: File) => {
    const err = validateAttachment(file);
    if (err) {
      toast({ variant: 'destructive', title: 'Anexo inválido', description: err });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountId', props.accountId);
      form.append('siteId', conv?.siteId || 'MLB');
      const r = await fetch('/api/ml/chat/attachments', { method: 'POST', body: form });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Falha no upload');
      setAttachments((prev) => [...prev, { id: j.id, name: file.name }]);
      toast({ title: 'Anexo carregado', description: file.name });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro no upload', description: e?.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (!props.packId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > ML_MESSAGE_MAX_LENGTH) return;
    setSending(true);
    try {
      const r = await fetch(`/api/ml/chat/conversations/${props.packId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: props.accountId,
          text: trimmed,
          attachments: attachments.map((a) => a.id),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Falha ao enviar');
      setText('');
      setAttachments([]);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar', description: e?.message });
    } finally {
      setSending(false);
    }
  };

  if (!props.packId) {
    return (
      <Card className="flex h-full items-center justify-center">
        <div className="text-center text-sm text-muted-foreground">
          Selecione uma conversa à esquerda.
        </div>
      </Card>
    );
  }

  const blocked = conv?.status === 'blocked';
  const subInfo = blocked ? describeSubstatus(conv?.substatus) : null;
  const charsLeft = ML_MESSAGE_MAX_LENGTH - text.length;

  return (
    <Card className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {conv?.buyerName || `Comprador ${conv?.buyerId || ''}`}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            pack {props.packId}
            {conv?.shippingId ? ` · envio ${conv.shippingId}` : ''}
            {conv?.claimId ? ` · claim ${conv.claimId}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {blocked && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Bloqueada
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Banner de status bloqueado */}
      {blocked && subInfo && (
        <div className="border-b bg-destructive/10 p-2 text-xs text-destructive">
          <strong>{subInfo.label}.</strong> {subInfo.description}
        </div>
      )}

      {/* Mensagens */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!loading &&
          messages.map((m) => <MessageBubble key={m.id} m={m} />)}
      </div>

      {/* Composer */}
      <div className="border-t p-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <Badge key={a.id} variant="secondary" className="gap-1">
                <Paperclip className="h-3 w-3" />
                {a.name}
                <button
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.pdf,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePickFile(f);
            }}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={blocked || uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Anexar arquivo (JPG, PNG, PDF, TXT — máx. 25 MB)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, ML_MESSAGE_MAX_LENGTH))}
            placeholder={
              blocked
                ? 'Conversa bloqueada — envio desabilitado.'
                : 'Digite sua mensagem (até 350 caracteres)…'
            }
            disabled={blocked || sending}
            className="min-h-[44px] resize-none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                'text-[10px]',
                charsLeft < 30 ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {charsLeft}
            </span>
            <Button
              size="icon"
              onClick={handleSend}
              disabled={blocked || sending || !text.trim()}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MessageBubble({ m }: { m: MlChatMessageDoc }) {
  const isOut = m.direction === 'out';
  const moderation = m.moderation?.status;
  const wasRejected =
    moderation && ['rejected', 'REJECTED'].includes(String(moderation));
  return (
    <div className={cn('flex', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm',
          isOut ? 'bg-primary text-primary-foreground' : 'bg-muted',
          m.pendingClient && 'opacity-70'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{m.text}</div>
        {!!m.attachments?.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {m.attachments.map((a) => (
              <Badge
                key={a.filename}
                variant="secondary"
                className="gap-1 bg-background/60 text-xs"
              >
                <Paperclip className="h-3 w-3" />
                {a.original_filename || a.filename}
              </Badge>
            ))}
          </div>
        )}
        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            isOut ? 'text-primary-foreground/80' : 'text-muted-foreground'
          )}
        >
          {wasRejected && (
            <span className="rounded bg-destructive/30 px-1 text-[10px] uppercase">
              moderada
            </span>
          )}
          {formatTime(m.dates.created || m.dates.received)}
          {isOut && !m.pendingClient && (
            m.dates.read ? (
              <CheckCheck className="h-3 w-3" />
            ) : (
              <Check className="h-3 w-3" />
            )
          )}
          {m.pendingClient &&
            (m.sendError ? (
              <span className="text-destructive">erro</span>
            ) : (
              <Loader2 className="h-3 w-3 animate-spin" />
            ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

function AtendimentoChatClient() {
  const [accounts, setAccounts] = React.useState<MlAccountSummary[]>([]);
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    listMlAccounts()
      .then((list) => {
        setAccounts(list);
        const primary = list.find((a) => a.isPrimary) || list[0];
        if (primary) setAccountId(primary.accountId);
      })
      .catch((e) => console.error('Erro listMlAccounts', e));
  }, []);

  const handleSyncAll = async () => {
    if (!accountId) return;
    setSyncing(true);
    try {
      const r = await fetch(`/api/ml/chat/conversations?accountId=${accountId}&backfill=1`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Falha');
      toast({
        title: 'Sincronização concluída',
        description: `Verificadas ${j.scanned} conversas — ${j.synced} sincronizadas, ${j.errors} erros.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e?.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-120px)] flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Atendimento Mercado Livre</h1>
            <p className="text-xs text-muted-foreground">
              Chat pós-venda em tempo real. Limite de 350 caracteres por mensagem.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={accountId ?? ''} onValueChange={(v) => setAccountId(v || null)}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Conta ML" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.accountId} value={a.accountId}>
                    {a.accountName || a.nickname || a.accountId}
                    {a.isPrimary ? ' (primária)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSyncAll} disabled={!accountId || syncing} variant="outline">
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sincronizar não-lidas
            </Button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden">
          <div className="col-span-4 overflow-hidden">
            <ConversationList
              accountId={accountId}
              selectedPackId={selectedPackId}
              onSelect={setSelectedPackId}
            />
          </div>
          <div className="col-span-8 overflow-hidden">
            {accountId && (
              <ConversationPanel accountId={accountId} packId={selectedPackId} />
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function AtendimentoChatPage() {
  return (
    <React.Suspense fallback={<div className="p-4">Carregando…</div>}>
      <AtendimentoChatClient />
    </React.Suspense>
  );
}
