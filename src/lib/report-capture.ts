'use client';
/**
 * Captura de contexto para os reportes, como o ReportContext do Calculaqui: últimos erros do navegador e
 * últimos passos do usuário (cliques, envios, falhas HTTP, troca de página). Fica no módulo, e não num
 * componente, porque cada página do BR Steel monta o próprio layout: assim a sessão sobrevive à navegação.
 */
import type { TicketBreadcrumb, TicketLog } from '@/types/support-tickets';

const MAX_LOGS = 25;
const MAX_BREADCRUMBS = 80;
const SESSION_KEY = 'brsteel_report_session_id';
const IGNORED_PATHS = ['/api/operations/support-tickets'];

let logs: TicketLog[] = [];
let breadcrumbs: TicketBreadcrumb[] = [];
let domainContext: Record<string, unknown> = {};
let installed = false;
let lastRoute: string | null = null;

const push = <T,>(items: T[], item: T, max: number) => [...items, item].slice(-max);
const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}...` : value);

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
  if (arg == null || ['string', 'number', 'boolean'].includes(typeof arg)) return arg;
  try { return JSON.parse(JSON.stringify(arg)); } catch { return String(arg); }
}
const messageOf = (args: unknown[]) => args.map(arg => typeof arg === 'string' ? arg : arg instanceof Error ? arg.message
  : arg && typeof arg === 'object' && typeof (arg as { message?: unknown }).message === 'string' ? (arg as { message: string }).message : '')
  .filter(Boolean).join(' ');

function sessionId() {
  const fallback = () => (window.crypto && 'randomUUID' in window.crypto ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const generated = fallback();
    window.sessionStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch { return fallback(); }
}

function safePath(raw: string) {
  try { const url = new URL(raw, window.location.origin); return `${url.pathname}${url.search ? '?...' : ''}`; }
  catch { return truncate(raw, 240); }
}
function elementLabel(element: Element) {
  const explicit = element.getAttribute('data-report-label') || element.getAttribute('aria-label') || element.getAttribute('title')
    || element.getAttribute('name') || element.getAttribute('id') || '';
  if (explicit.trim()) return truncate(explicit.trim(), 140);
  const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
  return text ? truncate(text, 140) : element.tagName.toLowerCase();
}
function elementDescriptor(element: Element) {
  const d: Record<string, unknown> = { tag: element.tagName.toLowerCase() };
  if (element.id) d.id = element.id;
  if (element.getAttribute('role')) d.role = element.getAttribute('role');
  if (element.getAttribute('type')) d.type = element.getAttribute('type');
  if (element instanceof HTMLAnchorElement && element.href) d.href = safePath(element.href);
  return d;
}
function errorLog(error: unknown, source: string, data?: Record<string, unknown>): TicketLog {
  if (error instanceof Error) return { timestamp: new Date().toISOString(), level: 'error', source, message: error.message, stack: error.stack, args: data ? [data] : undefined };
  return { timestamp: new Date().toISOString(), level: 'error', source, message: typeof error === 'string' ? error : String(error), args: [serializeArg(error), ...(data ? [data] : [])] };
}

export function addBreadcrumb(type: string, message: string, data?: Record<string, unknown>) {
  breadcrumbs = push(breadcrumbs, { timestamp: new Date().toISOString(), type, message, data }, MAX_BREADCRUMBS);
}
export function captureError(error: unknown, source = 'manual', data?: Record<string, unknown>) {
  logs = push(logs, errorLog(error, source, data), MAX_LOGS);
}
/** Dados da tela atual que ajudam a entender o chamado (ex.: lote aberto). */
export function setDomainContext(context: Record<string, unknown>, replace = false) {
  domainContext = replace ? context : { ...domainContext, ...context };
}
export function resetCapture() { logs = []; breadcrumbs = []; }
export function trackRoute(route: string) {
  if (route === lastRoute) return;
  addBreadcrumb('route_change', `Navegou para ${route}`, lastRoute ? { from: lastRoute } : undefined);
  lastRoute = route;
  domainContext = {};
}

export function getReportSnapshot() {
  return {
    context: {
      url: window.location.href, pathname: window.location.pathname, search: window.location.search,
      referrer: document.referrer || undefined, userAgent: navigator.userAgent,
      resolution: `${window.innerWidth}x${window.innerHeight}`,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'development',
      environment: process.env.NODE_ENV, sessionId: sessionId(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language,
      online: navigator.onLine, visibilityState: document.visibilityState,
    },
    logs: [...logs], breadcrumbs: [...breadcrumbs], domainContext: { ...domainContext },
  };
}

/** Instala os ouvintes uma vez por aba; chamadas seguintes não fazem nada. */
export function installReportCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs = push(logs, { timestamp: new Date().toISOString(), level: 'error', source: 'console.error', message: messageOf(args), args: args.map(serializeArg) }, MAX_LOGS);
    originalError.apply(console, args);
  };
  window.addEventListener('error', event => {
    logs = push(logs, { timestamp: new Date().toISOString(), level: 'error', source: 'window.onerror', message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined, args: [{ filename: event.filename, lineno: event.lineno, colno: event.colno }] }, MAX_LOGS);
  });
  window.addEventListener('unhandledrejection', event => {
    logs = push(logs, { timestamp: new Date().toISOString(), level: 'error', source: 'unhandledrejection',
      message: event.reason instanceof Error ? event.reason.message : String(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack : undefined, args: [serializeArg(event.reason)] }, MAX_LOGS);
  });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element
      ? event.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]') : null;
    if (target) addBreadcrumb('ui_click', `Clique em ${elementLabel(target)}`, elementDescriptor(target));
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (form) addBreadcrumb('form_submit', 'Envio de formulário detectado', { id: form.id || undefined, name: form.getAttribute('name') || undefined, method: form.method || undefined });
  }, true);
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now();
    const path = safePath(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : undefined) || 'GET';
    const ignored = IGNORED_PATHS.some(p => path.startsWith(p));
    try {
      const response = await originalFetch(input, init);
      if (!response.ok && !ignored) {
        addBreadcrumb('network_error', `Falha HTTP ${response.status} em ${method} ${path}`, { path, method, status: response.status, durationMs: Math.round(performance.now() - startedAt) });
      }
      return response;
    } catch (error) {
      if (!ignored) {
        const durationMs = Math.round(performance.now() - startedAt);
        addBreadcrumb('network_exception', `Erro de rede em ${method} ${path}`, { path, method, durationMs });
        logs = push(logs, errorLog(error, 'fetch', { path, method, durationMs }), MAX_LOGS);
      }
      throw error;
    }
  };
}
