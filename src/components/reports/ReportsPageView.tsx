'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Bug, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, Lightbulb, LoaderCircle, MonitorSmartphone,
  RefreshCw, RotateCcw, Search, X,
} from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { useAuth } from '@/contexts/AuthContext';
import { listTickets, reopenTicket, TICKET_CREATED_EVENT, updateTicketStatus } from '@/services/support-tickets-service';
import {
  CATEGORY_LABELS, formatTicketNumber, matchesTicketNumber, STATUS_LABELS,
  type SupportTicket, type TicketCategory, type TicketScope, type TicketStatus,
} from '@/types/support-tickets';
import DictationField from './DictationField';

const STATUS_CLASSES: Record<TicketStatus, string> = {
  pending: 'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-green-50 text-green-700 border-green-200',
};
const CATEGORY_CLASSES: Record<TicketCategory, string> = {
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  improvement: 'bg-sky-50 text-sky-700 border-sky-200',
};
const PAGE_SIZES = [10, 25, 50];
const inputClass = 'rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10';

const formatDate = (value: string | null | undefined, fallback = '-') => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('pt-BR');
};
function formatJson(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function formatLogContent(log: SupportTicket['logs'][number]) {
  if (typeof log.message === 'string' && log.message.trim()) return log.message;
  if (Array.isArray(log.args)) return log.args.map(formatJson).join(' ');
  return formatJson(log);
}
const text = (value: unknown) => (value === undefined || value === null || value === '' ? '-' : String(value));

function StatusBadge({ status }: { status: TicketStatus }) {
  const Icon = status === 'resolved' ? CheckCircle2 : status === 'in_progress' ? Clock : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${STATUS_CLASSES[status]}`}>
      <Icon size={12} />{STATUS_LABELS[status]}
    </span>
  );
}
function CategoryBadge({ category }: { category: TicketCategory }) {
  const Icon = category === 'improvement' ? Lightbulb : Bug;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${CATEGORY_CLASSES[category]}`}>
      <Icon size={12} />{CATEGORY_LABELS[category]}
    </span>
  );
}

interface ReportsPageViewProps {
  scope: TicketScope;
  title: string;
  subtitle: string;
  showUserColumn?: boolean;
  allowAdminActions?: boolean;
  emptyDescription: string;
}

/** Lista e detalhes dos reportes, igual à tela do Calculaqui; serve "Reportes" (admin) e "Meus reportes". */
export default function ReportsPageView({ scope, title, subtitle, showUserColumn = false, allowAdminActions = false, emptyDescription }: ReportsPageViewProps) {
  const { user } = useAuth();
  const [reports, setReports] = useState<SupportTicket[]>([]);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<TicketCategory | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [reopenDetails, setReopenDetails] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const loadReports = useCallback(async () => {
    setLoading(true); setError('');
    try { setReports((await listTickets(scope)).reports); }
    catch (err) { setError(err instanceof Error && err.message ? err.message : 'Erro ao carregar reportes.'); }
    finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { void loadReports(); }, [loadReports]);
  useEffect(() => {
    const reload = () => void loadReports();
    window.addEventListener(TICKET_CREATED_EVENT, reload);
    return () => window.removeEventListener(TICKET_CREATED_EVENT, reload);
  }, [loadReports]);

  const filtered = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return reports.filter(report => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && report.category !== categoryFilter) return false;
      if (!search) return true;
      // O número do chamado é o que a pessoa tem na mão para procurar: buscar "42" acha o #42.
      if (matchesTicketNumber(report.ticketNumber, search)) return true;
      return [report.description, report.user?.name, report.user?.email, report.context?.pathname, report.fingerprint,
        CATEGORY_LABELS[report.category], STATUS_LABELS[report.status]]
        .filter(Boolean).join(' ').toLowerCase().includes(search);
    });
  }, [categoryFilter, reports, searchTerm, statusFilter]);

  useEffect(() => { setPage(1); }, [scope, statusFilter, categoryFilter, searchTerm, pageSize]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const counts = useMemo(() => ({
    total: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    inProgress: reports.filter(r => r.status === 'in_progress').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
  }), [reports]);

  const replace = (updated: SupportTicket) => {
    setReports(current => current.map(r => (r.id === updated.id ? updated : r)));
    setSelected(current => (current?.id === updated.id ? updated : current));
  };
  const handleStatusChange = async (id: string, status: TicketStatus) => {
    setUpdating(true); setError('');
    try { replace(await updateTicketStatus(id, status)); }
    catch (err) { setError(err instanceof Error && err.message ? err.message : 'Erro ao atualizar status.'); }
    finally { setUpdating(false); }
  };
  const handleReopen = async () => {
    if (!selected) return;
    const details = reopenDetails.trim();
    if (!details) { setError('Explique o que ainda precisa ser corrigido.'); return; }
    setUpdating(true); setError('');
    try { replace(await reopenTicket(selected.id, details)); setReopenDetails(''); }
    catch (err) { setError(err instanceof Error && err.message ? err.message : 'Erro ao reabrir chamado.'); }
    finally { setUpdating(false); }
  };
  const closeDetails = () => { setSelected(null); setReopenDetails(''); };
  const canReopen = Boolean(selected && user && selected.createdByUid === user.id && selected.status === 'resolved');

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600"><Bug size={20} /></div>
            <div>
              <h1 className="text-xl font-black text-zinc-900">{title}</h1>
              <p className="text-sm text-zinc-500">{subtitle.replace('{count}', String(counts.total))}</p>
            </div>
          </div>
          <button type="button" onClick={loadReports} disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60">
            {loading ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Total', value: counts.total, className: 'text-zinc-900' },
            { label: 'Pendentes', value: counts.pending, className: 'text-red-600' },
            { label: 'Em análise', value: counts.inProgress, className: 'text-amber-700' },
            { label: 'Resolvidos', value: counts.resolved, className: 'text-green-600' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-zinc-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase text-zinc-400">{item.label}</p>
              <p className={`mt-1 text-2xl font-black ${item.className}`}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-zinc-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input type="text" value={searchTerm} onChange={event => setSearchTerm(event.target.value)}
              placeholder="Buscar por número, descrição, usuário, página ou fingerprint..." aria-label="Buscar reportes"
              className={`w-full pl-9 pr-3 ${inputClass}`} />
          </label>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as TicketStatus | 'all')} aria-label="Filtrar por status" className={inputClass}>
            <option value="all">Todos os status</option>
            <option value="pending">Pendentes</option>
            <option value="in_progress">Em análise</option>
            <option value="resolved">Resolvidos</option>
          </select>
          <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as TicketCategory | 'all')} aria-label="Filtrar por tipo" className={inputClass}>
            <option value="all">Todos os tipos</option>
            <option value="error">Erros</option>
            <option value="improvement">Melhorias</option>
          </select>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div>}

        <div className="overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm">
          {loading && reports.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center"><LoaderCircle size={28} className="animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <AlertCircle size={36} className="text-zinc-300" />
              <p className="mt-3 font-bold text-zinc-700">Nenhum reporte encontrado</p>
              <p className="mt-1 max-w-md text-sm text-zinc-500">{emptyDescription}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-100 text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-black uppercase text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Chamado</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Tipo</th>
                    {showUserColumn && <th className="px-4 py-3">Usuário</th>}
                    <th className="px-4 py-3">Resumo</th>
                    <th className="px-4 py-3">Página</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {paginated.map(report => (
                    <tr key={report.id} className="hover:bg-zinc-50/70">
                      <td className="whitespace-nowrap px-4 py-3 font-black text-zinc-700">{formatTicketNumber(report.ticketNumber)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">{formatDate(report.createdAt)}</td>
                      <td className="px-4 py-3"><CategoryBadge category={report.category} /></td>
                      {showUserColumn && (
                        <td className="px-4 py-3">
                          <div className="font-bold text-zinc-800">{report.user?.name || 'Usuário'}</div>
                          <div className="text-xs text-zinc-400">{report.user?.email || '-'}</div>
                        </td>
                      )}
                      <td className="max-w-sm px-4 py-3 text-zinc-600"><span className="line-clamp-2">{report.description || '-'}</span></td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-xs text-zinc-500">{text(report.context?.pathname)}</td>
                      <td className="px-4 py-3"><StatusBadge status={report.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setSelected(report)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/10">
                          <Eye size={14} />Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-col gap-3 border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span>{filtered.length} {filtered.length === 1 ? 'reporte' : 'reportes'}</span>
                  <select value={pageSize} onChange={event => setPageSize(Number(event.target.value))} aria-label="Itens por página"
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs outline-none">
                    {PAGE_SIZES.map(size => <option key={size} value={size}>{size} por página</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Página anterior"
                    className="rounded-lg border border-zinc-200 p-1.5 transition hover:bg-zinc-50 disabled:opacity-40"><ChevronLeft size={16} /></button>
                  <span className="text-xs">Página {currentPage} de {totalPages}</span>
                  <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages} aria-label="Próxima página"
                    className="rounded-lg border border-zinc-200 p-1.5 transition hover:bg-zinc-50 disabled:opacity-40"><ChevronRight size={16} /></button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar detalhes" className="absolute inset-0 bg-black/40" onClick={closeDetails} />
          <div role="dialog" aria-modal="true" aria-labelledby="ticket-details-title"
            className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in-0 zoom-in-95">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="ticket-details-title" className="text-lg font-black text-zinc-900">Chamado {formatTicketNumber(selected.ticketNumber)}</h2>
                  <CategoryBadge category={selected.category} />
                  <StatusBadge status={selected.status} />
                </div>
                <p className="mt-1 text-sm text-zinc-500">Contexto técnico capturado no envio.</p>
              </div>
              <button type="button" onClick={closeDetails} aria-label="Fechar"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"><X size={18} /></button>
            </div>

            <div className="space-y-5 overflow-y-auto p-5">
              <div className="grid gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs font-bold uppercase text-zinc-400">Reportado por</div>
                  <div className="mt-1 font-bold text-zinc-800">{selected.user?.name || 'Usuário'}</div>
                  <div className="text-xs text-zinc-500">{selected.user?.email || '-'}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-zinc-400">Criado em</div>
                  <div className="mt-1">{formatDate(selected.createdAt)}</div>
                  {selected.resolvedAt && <div className="text-xs text-green-700">Resolvido em {formatDate(selected.resolvedAt)}</div>}
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-zinc-400">Fingerprint</div>
                  <div className="mt-1 font-mono text-xs">{selected.fingerprint || '-'}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-zinc-400">Build</div>
                  <div className="mt-1 font-mono text-xs">{text(selected.context?.buildId)}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-bold uppercase text-zinc-400">Página de origem</div>
                  <div className="mt-1 break-all text-xs text-primary">{text(selected.context?.url || selected.context?.pathname)}</div>
                </div>
              </div>

              <section>
                <h3 className="mb-2 text-sm font-black text-zinc-900">Descrição informada</h3>
                <div className={`whitespace-pre-wrap rounded-xl border p-4 text-sm ${CATEGORY_CLASSES[selected.category]}`}>{selected.description || '-'}</div>
              </section>

              {selected.reopenHistory.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-black text-zinc-900">Reaberturas</h3>
                  <div className="space-y-2">
                    {[...selected.reopenHistory].reverse().map((entry, index) => (
                      <div key={index} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-sm">
                        <div className="mb-1 text-xs text-zinc-500">{entry.reopenedBy?.name || 'Usuário'} em {formatDate(entry.reopenedAt)}</div>
                        <div className="whitespace-pre-wrap">{entry.details || '-'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-zinc-900"><MonitorSmartphone size={16} />Ambiente</h3>
                <div className="grid gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-4 text-xs md:grid-cols-2">
                  <div><span className="font-bold">Resolução:</span> {text(selected.context?.resolution)}</div>
                  <div><span className="font-bold">Pathname:</span> {text(selected.context?.pathname)}</div>
                  <div><span className="font-bold">Ambiente:</span> {text(selected.context?.environment)}</div>
                  <div><span className="font-bold">Sessão:</span> {text(selected.context?.sessionId)}</div>
                  <div><span className="font-bold">Timezone:</span> {text(selected.context?.timezone)}</div>
                  <div><span className="font-bold">Locale:</span> {text(selected.context?.locale)}</div>
                  <div className="break-all md:col-span-2"><span className="font-bold">User agent:</span> {text(selected.context?.userAgent)}</div>
                </div>
              </section>

              {selected.breadcrumbs.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-black text-zinc-900">Linha do tempo da sessão</h3>
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-100 bg-zinc-50 p-4 text-xs">
                    {selected.breadcrumbs.map((crumb, index) => (
                      <div key={index} className="border-b border-zinc-200 pb-2 last:border-0 last:pb-0">
                        <div className="font-mono text-zinc-500">[{text(crumb.timestamp)}] {crumb.type || 'evento'}</div>
                        <div className="mt-1">{crumb.message || '-'}</div>
                        {crumb.data && <pre className="mt-1 whitespace-pre-wrap text-zinc-500">{formatJson(crumb.data)}</pre>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {Object.keys(selected.domainContext).length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-black text-zinc-900">Contexto da página</h3>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-100 bg-zinc-50 p-4 text-xs">{formatJson(selected.domainContext)}</pre>
                </section>
              )}

              {selected.logs.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-black text-zinc-900">Logs capturados</h3>
                  <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-100">
                    {selected.logs.map((log, index) => (
                      <div key={index} className="border-b border-zinc-800 pb-3 last:border-0 last:pb-0">
                        <div className="text-zinc-400">[{text(log.timestamp)}] {log.level || 'error'} · {log.source || '-'}</div>
                        <div className="mt-1 whitespace-pre-wrap">{formatLogContent(log)}</div>
                        {typeof log.stack === 'string' && log.stack && <pre className="mt-2 whitespace-pre-wrap text-red-300">{log.stack}</pre>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {canReopen && (
                <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div>
                    <h3 className="text-sm font-black text-amber-950">Ainda não foi resolvido?</h3>
                    <p className="mt-1 text-sm text-amber-900">Reabra o chamado e explique o que ainda acontece.</p>
                  </div>
                  <DictationField value={reopenDetails} onChange={setReopenDetails} disabled={updating} rows={4}
                    placeholder="Descreva o que ainda acontece e como reproduzir novamente." />
                  <button type="button" onClick={handleReopen} disabled={updating || !reopenDetails.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-amber-700 disabled:opacity-60">
                    {updating ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    Reabrir chamado
                  </button>
                </section>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              {allowAdminActions ? (
                <div className="flex flex-wrap gap-2">
                  {selected.status !== 'in_progress' && selected.status !== 'resolved' && (
                    <button type="button" onClick={() => handleStatusChange(selected.id, 'in_progress')} disabled={updating}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60">
                      Marcar em análise
                    </button>
                  )}
                  {selected.status !== 'resolved' && (
                    <button type="button" onClick={() => handleStatusChange(selected.id, 'resolved')} disabled={updating}
                      className="rounded-xl bg-green-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-green-700 disabled:opacity-60">
                      Concluir
                    </button>
                  )}
                  {selected.status === 'resolved' && (
                    <button type="button" onClick={() => handleStatusChange(selected.id, 'in_progress')} disabled={updating}
                      className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60">
                      Reabrir como admin
                    </button>
                  )}
                </div>
              ) : <div />}
              <button type="button" onClick={closeDetails}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-600 transition hover:bg-zinc-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
