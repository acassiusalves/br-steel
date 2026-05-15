'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserCheck,
} from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  type MlSupportPriority,
  type MlSupportQueueStatus,
} from '@/lib/ml-chat-types';
import { describeSubstatus } from '@/lib/ml-chat-substatus';
import { listMlAccounts, type MlAccountSummary } from '@/app/actions';
import { useAuth } from '@/contexts/AuthContext';

type QueueFilter = 'all' | 'unread' | 'unassigned' | 'mine' | 'blocked' | 'resolved';

type ConversationListResponse = {
  ok?: boolean;
  error?: string;
  conversations?: MlChatConversationDoc[];
  scanned?: number;
  synced?: number;
  errors?: number;
};

type ConversationDetailResponse = {
  ok?: boolean;
  error?: string;
  conversation?: MlChatConversationDoc;
  messages?: MlChatMessageDoc[];
};

async function readApiJson<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || (json as { ok?: boolean }).ok === false) {
    throw new Error(json.error || 'Falha na requisição');
  }
  return json;
}

const QUEUE_STATUS_LABELS: Record<MlSupportQueueStatus, string> = {
  new: 'Novo',
  open: 'Em atendimento',
  waiting_customer: 'Aguardando cliente',
  resolved: 'Resolvido',
  ignored: 'Ignorado',
};

const PRIORITY_LABELS: Record<MlSupportPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

const QUEUE_STATUS_OPTIONS = Object.entries(QUEUE_STATUS_LABELS) as Array<
  [MlSupportQueueStatus, string]
>;
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as Array<[MlSupportPriority, string]>;

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

function formatDateTime(epoch?: number | null) {
  if (!epoch) return 'N/A';
  const d = new Date(epoch);
  if (!Number.isFinite(d.getTime())) return 'N/A';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

function getQueueStatus(c?: MlChatConversationDoc | null): MlSupportQueueStatus {
  if (c?.queueStatus) return c.queueStatus;
  return (c?.unreadCount || 0) > 0 ? 'new' : 'open';
}

function getPriority(c?: MlChatConversationDoc | null): MlSupportPriority {
  return c?.priority || 'normal';
}

function priorityClass(priority: MlSupportPriority) {
  if (priority === 'urgent') return 'border-red-500 bg-red-50 text-red-700';
  if (priority === 'high') return 'border-amber-500 bg-amber-50 text-amber-700';
  if (priority === 'low') return 'border-slate-300 bg-slate-50 text-slate-600';
  return 'border-blue-300 bg-blue-50 text-blue-700';
}

function queueStatusVariant(status: MlSupportQueueStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'new') return 'default';
  if (status === 'resolved' || status === 'ignored') return 'outline';
  return 'secondary';
}

function getSlaInfo(conv?: MlChatConversationDoc | null) {
  if (!conv?.slaDueAt) return null;
  const diff = conv.slaDueAt - Date.now();
  if (diff <= 0) {
    return { label: 'SLA vencido', className: 'text-destructive' };
  }
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return { label: `${minutes} min`, className: 'text-amber-700' };
  return { label: `${Math.ceil(minutes / 60)} h`, className: 'text-muted-foreground' };
}

function matchesSearch(conv: MlChatConversationDoc, search: string) {
  if (!search) return true;
  const haystack = [
    conv.buyerName,
    conv.buyerId,
    conv.packId,
    conv.shippingId,
    conv.claimId,
    conv.lastMessagePreview,
    ...(conv.tags || []),
  ]
    .filter((v) => v != null)
    .join(' ')
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function ConversationList(props: {
  accountId: string | null;
  selectedPackId: string | null;
  currentUserEmail?: string | null;
  refreshKey: number;
  onSelect: (packId: string) => void;
}) {
  const [conversations, setConversations] = React.useState<MlChatConversationDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<QueueFilter>('all');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    if (!props.accountId) {
      setConversations([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const params = new URLSearchParams({
          accountId: props.accountId as string,
          limit: '250',
        });
        const response = await fetch(`/api/ml/chat/conversations?${params.toString()}`, {
          cache: 'no-store',
        });
        const json = await readApiJson<ConversationListResponse>(response);
        if (cancelled) return;
        setConversations(json.conversations || []);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || String(e));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    };

    load(true);
    const timer = window.setInterval(() => load(false), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [props.accountId, props.refreshKey]);

  const filtered = React.useMemo(() => {
    return conversations.filter((c) => {
      const queueStatus = getQueueStatus(c);
      if (!matchesSearch(c, search.trim())) return false;
      if (filter === 'unread') return (c.unreadCount || 0) > 0;
      if (filter === 'unassigned') return !c.assignedTo?.email && queueStatus !== 'resolved';
      if (filter === 'mine') return !!props.currentUserEmail && c.assignedTo?.email === props.currentUserEmail;
      if (filter === 'blocked') return c.status === 'blocked';
      if (filter === 'resolved') return queueStatus === 'resolved';
      return true;
    });
  }, [conversations, filter, props.currentUserEmail, search]);

  const filterItems: Array<[QueueFilter, string]> = [
    ['all', 'Todas'],
    ['unread', 'Não lidas'],
    ['unassigned', 'Sem dono'],
    ['mine', 'Minhas'],
    ['blocked', 'Bloqueadas'],
    ['resolved', 'Resolvidas'],
  ];

  return (
    <Card className="flex h-full flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Fila de atendimento</h2>
          <Badge variant="outline" className="shrink-0">
            {filtered.length}
          </Badge>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar comprador, pack, envio..."
            className="h-9 pl-8 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {filterItems.map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? 'default' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {error || 'Nenhuma conversa encontrada.'}
          </div>
        )}
        {!loading &&
          filtered.map((c) => {
            const selected = c.packId === props.selectedPackId;
            const queueStatus = getQueueStatus(c);
            const priority = getPriority(c);
            const sla = getSlaInfo(c);
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
                <div className="min-w-0 flex-1 space-y-1">
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
                      {c.lastMessagePreview || '-'}
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
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={queueStatusVariant(queueStatus)} className="h-5 px-1.5 text-[10px]">
                      {QUEUE_STATUS_LABELS[queueStatus]}
                    </Badge>
                    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', priorityClass(priority))}>
                      {PRIORITY_LABELS[priority]}
                    </Badge>
                    {sla && (
                      <span className={cn('inline-flex items-center gap-1 text-[10px]', sla.className)}>
                        <Clock className="h-3 w-3" />
                        {sla.label}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    pack {c.packId}
                    {c.assignedTo?.name || c.assignedTo?.email ? ` · ${c.assignedTo.name || c.assignedTo.email}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
      </ScrollArea>
    </Card>
  );
}

function ConversationPanel(props: {
  accountId: string;
  packId: string | null;
  refreshKey: number;
  currentUser: { id?: string; name?: string; email?: string } | null;
}) {
  const { toast } = useToast();
  const [conv, setConv] = React.useState<MlChatConversationDoc | null>(null);
  const [messages, setMessages] = React.useState<MlChatMessageDoc[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [stateSaving, setStateSaving] = React.useState(false);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [text, setText] = React.useState('');
  const [attachments, setAttachments] = React.useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const loadConversation = React.useCallback(
    async (options: { sync?: boolean; showLoading?: boolean } = {}) => {
      if (!props.packId || !props.accountId) return;
      if (options.showLoading) setLoading(true);
      const params = new URLSearchParams({ accountId: props.accountId });
      if (options.sync) params.set('sync', '1');
      const response = await fetch(
        `/api/ml/chat/conversations/${props.packId}?${params.toString()}`,
        { cache: 'no-store' }
      );
      const json = await readApiJson<ConversationDetailResponse>(response);
      setConv(json.conversation || null);
      setMessages(json.messages || []);
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 60);
      setLoading(false);
    },
    [props.accountId, props.packId]
  );

  React.useEffect(() => {
    setConv(null);
    setMessages([]);
    setText('');
    setAttachments([]);
    if (!props.packId || !props.accountId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async (options: { sync?: boolean; showLoading?: boolean } = {}) => {
      if (options.showLoading) setLoading(true);
      try {
        const params = new URLSearchParams({ accountId: props.accountId });
        if (options.sync) params.set('sync', '1');
        const response = await fetch(
          `/api/ml/chat/conversations/${props.packId}?${params.toString()}`,
          { cache: 'no-store' }
        );
        const json = await readApiJson<ConversationDetailResponse>(response);
        if (cancelled) return;
        setConv(json.conversation || null);
        setMessages(json.messages || []);
        setTimeout(() => {
          if (!cancelled && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 60);
      } catch (e: any) {
        if (!cancelled) {
          toast({ variant: 'destructive', title: 'Erro', description: e?.message || String(e) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load({ sync: true, showLoading: true });
    const timer = window.setInterval(() => load(), 6000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [props.accountId, props.packId, props.refreshKey, toast]);

  const patchConversation = async (body: Record<string, unknown>) => {
    if (!props.packId) return;
    setStateSaving(true);
    try {
      const r = await fetch(`/api/ml/chat/conversations/${props.packId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: props.accountId, ...body }),
      });
      const j = await readApiJson<ConversationDetailResponse>(r);
      setConv(j.conversation || null);
      setMessages(j.messages || messages);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e?.message || String(e) });
    } finally {
      setStateSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!props.packId) return;
    setRefreshing(true);
    try {
      await loadConversation({ sync: true });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e?.message || String(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const handleMarkRead = async () => {
    if (!props.packId) return;
    setRefreshing(true);
    try {
      const r = await fetch(
        `/api/ml/chat/conversations/${props.packId}?accountId=${props.accountId}&markRead=1`,
        { method: 'POST' }
      );
      const j = await readApiJson<ConversationDetailResponse>(r);
      setConv(j.conversation || null);
      setMessages(j.messages || messages);
      toast({ title: 'Conversa marcada como lida' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e?.message || String(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const handleAssume = async () => {
    if (!props.currentUser?.email && !props.currentUser?.id) {
      toast({ variant: 'destructive', title: 'Usuário não identificado' });
      return;
    }
    await patchConversation({
      assignedTo: {
        id: props.currentUser.id || props.currentUser.email || null,
        name: props.currentUser.name || props.currentUser.email || null,
        email: props.currentUser.email || null,
      },
      queueStatus: getQueueStatus(conv) === 'new' ? 'open' : undefined,
    });
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

  const handleGenerateAi = async () => {
    if (!props.packId) return;
    setAiLoading(true);
    try {
      const r = await fetch(`/api/ml/chat/conversations/${props.packId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: props.accountId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Falha ao consultar Gemini');
      await loadConversation().catch(() => undefined);
      toast({ title: 'Sugestão gerada', description: 'Revise antes de enviar.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro no Gemini', description: e?.message });
      await loadConversation().catch(() => undefined);
    } finally {
      setAiLoading(false);
    }
  };

  const handleUseAiReply = () => {
    const reply = conv?.ai?.suggestedReply?.trim();
    if (!reply) return;
    setText(reply.slice(0, ML_MESSAGE_MAX_LENGTH));
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
      await loadConversation().catch(() => undefined);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar', description: e?.message });
      await loadConversation().catch(() => undefined);
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
  const queueStatus = getQueueStatus(conv);
  const priority = getPriority(conv);
  const sla = getSlaInfo(conv);

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="flex items-start justify-between gap-3">
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
          <div className="flex shrink-0 items-center gap-2">
            {blocked && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Bloqueada
              </Badge>
            )}
            {(conv?.unreadCount || 0) > 0 && (
              <Button size="sm" variant="outline" onClick={handleMarkRead} disabled={refreshing}>
                Marcar lida
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleAssume} disabled={stateSaving}>
              <UserCheck className="mr-2 h-4 w-4" />
              Assumir
            </Button>
            <Button size="icon" variant="ghost" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={queueStatus}
            onValueChange={(v) => patchConversation({ queueStatus: v })}
            disabled={stateSaving}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUEUE_STATUS_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority}
            onValueChange={(v) => patchConversation({ priority: v })}
            disabled={stateSaving}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {conv?.assignedTo?.name || conv?.assignedTo?.email ? (
            <Badge variant="secondary" className="gap-1">
              <UserCheck className="h-3 w-3" />
              {conv.assignedTo.name || conv.assignedTo.email}
            </Badge>
          ) : (
            <Badge variant="outline">Sem responsável</Badge>
          )}
          {sla && (
            <span className={cn('inline-flex items-center gap-1 text-xs', sla.className)}>
              <Clock className="h-3 w-3" />
              {sla.label}
            </span>
          )}
        </div>
      </div>

      {blocked && subInfo && (
        <div className="border-b bg-destructive/10 p-2 text-xs text-destructive">
          <strong>{subInfo.label}.</strong> {subInfo.description}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="flex min-h-0 flex-col">
          <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {loading && (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {!loading && messages.map((m) => <MessageBubble key={m.id} m={m} />)}
          </div>

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
                      x
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
                  <TooltipContent>Anexar arquivo (JPG, PNG, PDF, TXT - máx. 25 MB)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, ML_MESSAGE_MAX_LENGTH))}
                placeholder={
                  blocked
                    ? 'Conversa bloqueada - envio desabilitado.'
                    : 'Digite sua mensagem (até 350 caracteres)...'
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
                <Button size="icon" onClick={handleSend} disabled={blocked || sending || !text.trim()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <SupportSidePanel
          conv={conv}
          aiLoading={aiLoading}
          onGenerateAi={handleGenerateAi}
          onUseAiReply={handleUseAiReply}
        />
      </div>
    </Card>
  );
}

function SupportSidePanel(props: {
  conv: MlChatConversationDoc | null;
  aiLoading: boolean;
  onGenerateAi: () => void;
  onUseAiReply: () => void;
}) {
  const ai = props.conv?.ai;
  const priority = getPriority(props.conv);

  return (
    <aside className="min-h-0 overflow-y-auto border-t bg-muted/20 p-3 lg:border-l lg:border-t-0">
      <div className="space-y-5">
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Contexto</div>
          <div className="grid gap-2 text-xs">
            <InfoRow label="Prioridade" value={PRIORITY_LABELS[priority]} />
            <InfoRow label="Status ML" value={props.conv?.status || 'N/A'} />
            <InfoRow label="Substatus" value={props.conv?.substatus || 'N/A'} />
            <InfoRow label="Envio" value={props.conv?.shippingId || 'N/A'} />
            <InfoRow label="Claim" value={props.conv?.claimId || 'N/A'} />
            <InfoRow label="Último cliente" value={formatDateTime(props.conv?.lastCustomerMessageAt)} />
            <InfoRow label="Última resposta" value={formatDateTime(props.conv?.lastHumanReplyAt)} />
          </div>
          {props.conv?.conversationStatusPath && (
            <Badge variant="outline" className="max-w-full truncate">
              nova arq. ML
            </Badge>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Bot className="h-4 w-4" />
              Copiloto IA
            </div>
            <Button size="sm" variant="outline" onClick={props.onGenerateAi} disabled={props.aiLoading}>
              {props.aiLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Gerar
            </Button>
          </div>

          {!ai && (
            <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
              Gere uma sugestão para resumir a conversa e preparar um rascunho revisável.
            </div>
          )}

          {ai?.status === 'error' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {ai.lastError || 'Falha ao gerar sugestão.'}
            </div>
          )}

          {ai && ai.status !== 'error' && (
            <div className="space-y-3">
              <div className="rounded-md border bg-background p-3 text-xs">
                <div className="mb-1 font-medium">Resumo</div>
                <p className="text-muted-foreground">{ai.summary || 'N/A'}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <InfoBox label="Intenção" value={ai.intent || 'N/A'} />
                <InfoBox label="Confiança" value={`${Math.round((ai.confidence || 0) * 100)}%`} />
              </div>
              {ai.risks && ai.risks.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  <div className="mb-1 font-medium">Cuidados</div>
                  <ul className="list-inside list-disc space-y-1">
                    {ai.risks.map((risk, i) => (
                      <li key={`${risk}-${i}`}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ai.suggestedReply && (
                <div className="rounded-md border bg-background p-3 text-xs">
                  <div className="mb-2 font-medium">Resposta sugerida</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{ai.suggestedReply}</p>
                  <Button className="mt-3 w-full" size="sm" onClick={props.onUseAiReply}>
                    Usar resposta
                  </Button>
                </div>
              )}
              {ai.nextAction && (
                <div className="text-xs text-muted-foreground">
                  Próxima ação: {ai.nextAction}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b pb-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value || 'N/A'}</span>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
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

function AtendimentoChatClient() {
  const [accounts, setAccounts] = React.useState<MlAccountSummary[]>([]);
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

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
        description: `Verificadas ${j.scanned} conversas - ${j.synced} sincronizadas, ${j.errors} erros.`,
      });
      setRefreshKey((key) => key + 1);
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
              Fila pós-venda com contexto operacional e rascunhos revisáveis por IA.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={accountId ?? ''}
              onValueChange={(v) => {
                setAccountId(v || null);
                setSelectedPackId(null);
              }}
            >
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

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-12">
          <div className="overflow-hidden lg:col-span-4">
            <ConversationList
              accountId={accountId}
              selectedPackId={selectedPackId}
              currentUserEmail={user?.email}
              refreshKey={refreshKey}
              onSelect={setSelectedPackId}
            />
          </div>
          <div className="overflow-hidden lg:col-span-8">
            {accountId && (
              <ConversationPanel
                accountId={accountId}
                packId={selectedPackId}
                refreshKey={refreshKey}
                currentUser={user}
              />
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function AtendimentoChatPage() {
  return (
    <React.Suspense fallback={<div className="p-4">Carregando...</div>}>
      <AtendimentoChatClient />
    </React.Suspense>
  );
}
