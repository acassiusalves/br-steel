'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Bug, CheckCircle, Lightbulb, LoaderCircle, MessageSquareWarning, X } from 'lucide-react';
import { addBreadcrumb, captureError, getReportSnapshot, resetCapture } from '@/lib/report-capture';
import { createTicket, TICKET_CREATED_EVENT } from '@/services/support-tickets-service';
import { CATEGORY_LABELS, formatTicketNumber, type TicketCategory } from '@/types/support-tickets';
import DictationField from './DictationField';

/** Botão "Problemas?" e o modal de reporte, como no Calculaqui. */
export default function FloatingReportButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TicketCategory>('error');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const handleOpen = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true); setSuccess(false); setError(null); setTicketNumber(null);
    addBreadcrumb('report_dialog_open', 'Usuário abriu o diálogo de reporte', { pathname: window.location.pathname });
  };
  const handleClose = () => {
    if (loading) return;
    window.clearTimeout(closeTimer.current);
    setOpen(false); setSuccess(false); setError(null); setTicketNumber(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = description.trim();
    if (!trimmed) { setError('Descreva o erro ou melhoria antes de enviar.'); return; }
    setLoading(true); setError(null);
    try {
      addBreadcrumb('report_submit', `Usuário enviou um reporte de ${CATEGORY_LABELS[category].toLowerCase()}`, { pathname: window.location.pathname, category });
      const created = await createTicket({ description: trimmed, category, ...getReportSnapshot() });
      setTicketNumber(created.ticketNumber ?? null);
      setSuccess(true);
      setDescription('');
      resetCapture();
      window.dispatchEvent(new CustomEvent(TICKET_CREATED_EVENT));
      // Com o número na tela o diálogo demora mais para sair: dá tempo de anotar o código do chamado.
      closeTimer.current = window.setTimeout(() => { setOpen(false); setSuccess(false); }, created.ticketNumber ? 6000 : 1400);
    } catch (err) {
      captureError(err, 'report_submit');
      setError(err instanceof Error && err.message ? err.message : 'Não foi possível enviar o reporte agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Abrir reporte de problema ou melhoria"
        onClick={handleOpen}
        data-report-label="Abrir reporte de problema ou melhoria"
        className="group fixed bottom-6 left-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/25 transition-all hover:w-36 hover:scale-[1.04] hover:bg-red-700 focus-visible:w-36 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 active:scale-95 md:left-20"
      >
        <MessageSquareWarning size={21} className="shrink-0" />
        <span className="pointer-events-none ml-0 max-w-0 overflow-hidden whitespace-nowrap text-sm font-black opacity-0 transition-all group-hover:ml-2 group-hover:max-w-24 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-24 group-focus-visible:opacity-100">
          Problemas?
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 animate-in fade-in-0" onClick={handleClose} />
          <div role="dialog" aria-modal="true" aria-labelledby="report-dialog-title"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <AlertTriangle size={18} />
                </div>
                <div className="min-w-0">
                  <h2 id="report-dialog-title" className="truncate text-base font-black text-zinc-900">Reportar problema ou melhoria</h2>
                  <p className="text-xs text-zinc-500">BR Steel</p>
                </div>
              </div>
              <button type="button" onClick={handleClose} disabled={loading} aria-label="Fechar"
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
                <X size={18} />
              </button>
            </div>

            {success ? (
              <div className="p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckCircle size={26} />
                </div>
                <p className="mt-4 text-lg font-black text-zinc-900">Reporte enviado</p>
                {ticketNumber ? (
                  <>
                    <p className="mt-3 text-3xl font-black tracking-tight text-primary">{formatTicketNumber(ticketNumber)}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Anote este número para acompanhar ou cobrar o chamado. Ele também fica salvo em <strong>Meus reportes</strong>.
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-zinc-500">Vamos analisar as informações recebidas.</p>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
                  <button type="button" onClick={() => setCategory('error')} disabled={loading} aria-pressed={category === 'error'}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition ${category === 'error' ? 'bg-red-600 text-white shadow-sm' : 'text-zinc-600 hover:bg-white'}`}>
                    <Bug size={16} />
                    Erro
                  </button>
                  <button type="button" onClick={() => setCategory('improvement')} disabled={loading} aria-pressed={category === 'improvement'}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition ${category === 'improvement' ? 'bg-sky-600 text-white shadow-sm' : 'text-zinc-600 hover:bg-white'}`}>
                    <Lightbulb size={16} />
                    Melhoria
                  </button>
                </div>

                <div>
                  <label htmlFor="report-description" className="mb-1.5 block text-xs font-bold uppercase text-zinc-500">Descrição</label>
                  <DictationField
                    id="report-description"
                    value={description}
                    onChange={setDescription}
                    disabled={loading}
                    rows={5}
                    placeholder={category === 'improvement'
                      ? 'Ex: Seria útil ter um filtro nesta tela para agilizar a operação.'
                      : 'Ex: Tentei salvar a alteração, mas a tela mostrou erro depois de carregar.'}
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
                  O envio inclui página atual, navegador, versão, erros recentes e últimos cliques da sessão.
                </div>

                {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{error}</div>}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={handleClose} disabled={loading}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-bold text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-60">
                    Cancelar
                  </button>
                  <button type="submit" disabled={loading || !description.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                    {loading && <LoaderCircle size={16} className="animate-spin" />}
                    Enviar reporte
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
