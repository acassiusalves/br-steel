'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  Box,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Eye,
  Filter,
  ListChecks,
  Loader2,
  PackageSearch,
  Search,
  Sparkles,
  Store,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type {
  DeepSearchCategoryInsight,
  DeepSearchConsideredItem,
  DeepSearchProgress,
  DeepSearchQueryResult,
  DeepSearchRequest,
  DeepSearchResult,
  DeepSearchResultItem,
  DeepSearchSavedAnalysis,
  DeepSearchSavedAnalysisSummary,
  DeepSearchTermInsight,
} from '@/lib/deep-search-types';
import { cn, formatCurrency } from '@/lib/utils';

type ApiResponse = {
  ok: boolean;
  error?: string;
  result?: DeepSearchResult;
};

type SavedAnalysesApiResponse = {
  ok: boolean;
  error?: string;
  analyses?: DeepSearchSavedAnalysisSummary[];
};

type SavedAnalysisApiResponse = {
  ok: boolean;
  error?: string;
  analysis?: DeepSearchSavedAnalysis;
};

type SaveAnalysisApiResponse = {
  ok: boolean;
  error?: string;
  summary?: DeepSearchSavedAnalysisSummary;
};

type SortMode = 'recurrence' | 'opportunity' | 'performance' | 'similarity' | 'visits' | 'price';
type StreamEvent = { event: string; data: unknown };
type DeepSearchQueryResultView = DeepSearchQueryResult & {
  clientQueryId: string;
  originalIndex: number;
};
const ALL_CANDIDATES_ID = '__all_candidates__';

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined || Number.isNaN(value) ? 'N/A' : formatCurrency(value);
}

function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : new Intl.NumberFormat('pt-BR').format(value);
}

function formatVisitsWindowLabel(days: number | null | undefined) {
  return `Visitas ${days || 7} dias`;
}

function formatMode(value: string) {
  return value === 'catalog' ? 'Catálogo' : 'Anúncios';
}

function resultUrl(item: DeepSearchResultItem['item']) {
  if (item.permalink) return item.permalink;
  if (item.catalogProductId) return `https://www.mercadolivre.com.br/p/${item.catalogProductId}`;
  return '#';
}

function sortResults(results: DeepSearchResultItem[], sortMode: SortMode) {
  return [...results].sort((left, right) => {
    if (sortMode === 'recurrence') {
      const occurrenceDiff = right.occurrenceCount - left.occurrenceCount;
      if (occurrenceDiff !== 0) return occurrenceDiff;
      return (right.signals.visits || 0) - (left.signals.visits || 0);
    }
    if (sortMode === 'visits') return (right.signals.visits || 0) - (left.signals.visits || 0);
    if (sortMode === 'price') return (left.item.price || Number.MAX_SAFE_INTEGER) - (right.item.price || Number.MAX_SAFE_INTEGER);
    return right.scores[sortMode] - left.scores[sortMode];
  });
}

function parseStreamEvent(rawEvent: string): StreamEvent | null {
  const lines = rawEvent.split('\n');
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

async function runDeepSearchRequest(
  request: DeepSearchRequest,
  onProgress: (progress: DeepSearchProgress) => void
) {
  const response = await fetch('/api/mercado-livre/deep-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: true }),
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Falha ao executar Deep Search.');
  }

  if (!contentType.includes('text/event-stream') || !response.body) {
    const data = (await response.json()) as ApiResponse;
    if (!data.result) throw new Error(data.error || 'A busca não retornou resultado.');
    return data.result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: DeepSearchResult | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const rawEvent of events) {
      const parsed = parseStreamEvent(rawEvent);
      if (!parsed) continue;

      if (parsed.event === 'progress') {
        onProgress(parsed.data as DeepSearchProgress);
      } else if (parsed.event === 'heartbeat') {
        const heartbeat = parsed.data as { progress?: DeepSearchProgress | null };
        if (heartbeat.progress) onProgress(heartbeat.progress);
      } else if (parsed.event === 'result') {
        finalResult = parsed.data as DeepSearchResult;
        onProgress(finalResult.progress);
      } else if (parsed.event === 'error') {
        const data = parsed.data as { error?: string };
        throw new Error(data.error || 'Falha ao executar Deep Search.');
      }
    }
  }

  if (!finalResult) throw new Error('A conexão terminou antes do resultado final.');
  return finalResult;
}

function progressValue(progress: DeepSearchProgress | null, fallback: number) {
  if (!progress) return fallback;
  if (progress.phase === 'completed') return 100;
  if (progress.phase === 'scoring') return 95;
  if (progress.totalQueries > 0) {
    return Math.min(94, Math.max(8, (progress.currentQuery / progress.totalQueries) * 90));
  }
  return fallback;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatPhase(value: string) {
  const labels: Record<string, string> = {
    base: 'base',
    category_trend: 'categoria',
    derived_category_trend: 'subcategoria',
    preparing: 'preparando',
    generating_queries: 'gerando termos',
    level_1: 'nível 1',
    level_2: 'nível 2',
    level_3: 'nível 3',
    searching: 'buscando',
    scoring: 'ranqueando',
    completed: 'concluído',
    failed: 'falhou',
  };
  return labels[value] || value;
}

export default function DeepSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const analysisId = searchParams.get('analysisId')?.trim() || '';
  const startedRef = useRef(false);
  const [request, setRequest] = useState<DeepSearchRequest | null>(null);
  const [result, setResult] = useState<DeepSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSavedAnalysis, setLoadingSavedAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DeepSearchProgress | null>(null);
  const [visualProgress, setVisualProgress] = useState(8);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>('recurrence');
  const [minSimilarity, setMinSimilarity] = useState(0);
  const [minPerformance, setMinPerformance] = useState(0);
  const [term, setTerm] = useState('');
  const [savedAnalyses, setSavedAnalyses] = useState<DeepSearchSavedAnalysisSummary[]>([]);
  const [loadingSavedAnalyses, setLoadingSavedAnalyses] = useState(false);
  const [savedAnalysesError, setSavedAnalysesError] = useState<string | null>(null);
  const [showSavedAnalyses, setShowSavedAnalyses] = useState(false);
  const [savingAnalysis, setSavingAnalysis] = useState(false);

  const loadSavedAnalyses = useCallback(async () => {
    setLoadingSavedAnalyses(true);
    setSavedAnalysesError(null);
    try {
      const response = await fetch('/api/mercado-livre/deep-search/saved?limit=40');
      const data = (await response.json().catch(() => ({}))) as SavedAnalysesApiResponse;
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || 'Falha ao carregar análises salvas.');
      }
      setSavedAnalyses(data.analyses || []);
    } catch (loadError) {
      setSavedAnalysesError(loadError instanceof Error ? loadError.message : 'Falha ao carregar análises salvas.');
    } finally {
      setLoadingSavedAnalyses(false);
    }
  }, []);

  const saveCurrentAnalysis = useCallback(async () => {
    if (!result || savingAnalysis) return;
    setSavingAnalysis(true);
    setError(null);
    try {
      const response = await fetch('/api/mercado-livre/deep-search/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      });
      const data = (await response.json().catch(() => ({}))) as SaveAnalysisApiResponse;
      if (!response.ok || data.ok === false || !data.summary) {
        throw new Error(data.error || 'Falha ao salvar análise.');
      }
      setResult((current) => (current ? { ...current, savedAnalysis: data.summary || null } : current));
      void loadSavedAnalyses();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar análise.');
    } finally {
      setSavingAnalysis(false);
    }
  }, [loadSavedAnalyses, result, savingAnalysis]);

  useEffect(() => {
    void loadSavedAnalyses();
  }, [loadSavedAnalyses]);

  useEffect(() => {
    if (!analysisId) return;
    startedRef.current = true;
    setLoadingSavedAnalysis(true);
    setError(null);
    setRequest(null);
    setResult(null);
    setProgress(null);

    async function loadSavedAnalysis() {
      try {
        const response = await fetch(`/api/mercado-livre/deep-search/saved?analysisId=${encodeURIComponent(analysisId)}`);
        const data = (await response.json().catch(() => ({}))) as SavedAnalysisApiResponse;
        if (!response.ok || data.ok === false || !data.analysis?.result) {
          throw new Error(data.error || 'Análise salva não encontrada.');
        }
        setResult(data.analysis.result);
        setProgress(data.analysis.result.progress);
        setRequest({
          accountId: data.analysis.result.account?.accountId || data.analysis.summary.accountId,
          config: data.analysis.result.config,
        });
        setVisualProgress(100);
        setShowSavedAnalyses(false);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar análise salva.');
      } finally {
        setLoadingSavedAnalysis(false);
      }
    }

    void loadSavedAnalysis();
  }, [analysisId]);

  useEffect(() => {
    if (analysisId) return;
    const raw = window.sessionStorage.getItem('mercadoLivreDeepSearchRequest');
    if (!raw) {
      setError('Nenhuma configuração de Deep Search foi encontrada.');
      return;
    }

    try {
      const parsed = JSON.parse(raw) as DeepSearchRequest;
      setRequest(parsed);
    } catch {
      setError('Configuração de Deep Search inválida.');
    }
  }, [analysisId]);

  useEffect(() => {
    if (!request || startedRef.current) return;
    startedRef.current = true;
    const activeRequest = request;

    async function run() {
      setLoading(true);
      setError(null);
      setProgress(null);
      setVisualProgress(12);
      setElapsedSeconds(0);
      try {
        const data = await runDeepSearchRequest(activeRequest, setProgress);
        setResult(data);
        setProgress(data.progress);
        setVisualProgress(100);
        void loadSavedAnalyses();
      } catch (runError) {
        setError(runError instanceof Error ? runError.message : 'Falha ao executar Deep Search.');
      } finally {
        setLoading(false);
      }
    }

    void run();
  }, [loadSavedAnalyses, request]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setVisualProgress((current) => Math.min(92, current + (current < 45 ? 7 : 3)));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const filteredResults = useMemo(() => {
    const searchTerm = term.trim().toLowerCase();
    const filtered = (result?.results || []).filter((entry) => {
      if (entry.scores.similarity < minSimilarity) return false;
      if (entry.scores.performance < minPerformance) return false;
      if (!searchTerm) return true;
      const text = [
        entry.item.title,
        entry.baseProduct.title,
        entry.item.brand,
        entry.item.model,
        entry.item.sellerNickname,
        entry.labels.join(' '),
        entry.occurrences.map((occurrence) => occurrence.query).join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(searchTerm);
    });
    return sortResults(filtered, sortMode);
  }, [minPerformance, minSimilarity, result?.results, sortMode, term]);

  const summary = useMemo(() => {
    const rows = result?.results || [];
    return {
      ranked: rows.length,
      scanned: result?.metadata.totalItemsScanned || 0,
      uniqueCandidates: result?.metadata.uniqueCandidates || 0,
      occurrences: result?.metadata.totalOccurrences || 0,
      categories: result?.insights.categories.length || 0,
      terms: result?.insights.terms.length || 0,
    };
  }, [
    result?.insights.categories.length,
    result?.insights.terms.length,
    result?.metadata.totalItemsScanned,
    result?.metadata.totalOccurrences,
    result?.metadata.uniqueCandidates,
    result?.results,
  ]);

  const activeProgressValue = progressValue(progress, visualProgress);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6 lg:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Deep Search de Mercado</h1>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                {request?.config.focus === 'performance'
                  ? 'Performance'
                  : request?.config.focus === 'similarity'
                    ? 'Similaridade'
                    : 'Oportunidades'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {request ? `${request.config.baseProducts.length} produto(s) base · conta ${request.accountId}` : 'Busca profunda Mercado Livre'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSavedAnalyses((current) => !current)}>
              <Database className="h-4 w-4" />
              Análises salvas
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/buscar-mercado-livre')}>
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
          </div>
        </div>

        {showSavedAnalyses || (!result && !loading && !analysisId) ? (
          <SavedAnalysesPanel
            analyses={savedAnalyses}
            loading={loadingSavedAnalyses}
            error={savedAnalysesError}
            onRefresh={loadSavedAnalyses}
            onOpen={(id) => router.push(`/buscar-mercado-livre/deep-search?analysisId=${encodeURIComponent(id)}`)}
          />
        ) : null}

        {loadingSavedAnalysis ? (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando análise salva...
            </CardContent>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span className="truncate">
                    {progress?.message || 'Iniciando Deep Search...'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatElapsed(elapsedSeconds)}
                  </span>
                  {progress?.totalQueries ? (
                    <Badge variant="outline">
                      {progress.currentQuery}/{progress.totalQueries} buscas
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Progress value={activeProgressValue} />
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <span className="block font-medium text-foreground">{formatCount(progress?.resultsFound || 0)}</span>
                  candidatos lidos
                </div>
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <span className="block font-medium text-foreground">{formatCount(progress?.matchedResults || 0)}</span>
                  candidatos únicos
                </div>
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <span className="block font-medium text-foreground">{formatPhase(progress?.phase || 'preparing')}</span>
                  etapa atual
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Algumas buscas demoram mais quando há enriquecimento de visitas e catálogo. Enquanto o tempo e a mensagem estiverem atualizando, a execução segue ativa.
              </p>
              {progress?.errors.length ? (
                <Alert>
                  <PackageSearch className="h-4 w-4" />
                  <AlertTitle>Algumas queries falharam, mas a busca continua</AlertTitle>
                  <AlertDescription>{progress.errors.slice(-2).join(' | ')}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <PackageSearch className="h-4 w-4" />
            <AlertTitle>Deep Search não concluído</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardContent className="flex flex-col gap-2 p-4 text-sm md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">Análise #{result.savedAnalysis?.analysisId || result.sessionId}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.savedAnalysis
                      ? `Salva em ${formatDateTime(result.savedAnalysis.completedAt)} · abra novamente pelo ID ou pela lista de análises salvas.`
                      : 'Esta execução ainda não confirmou gravação no histórico.'}
                  </p>
                </div>
                {result.savedAnalysis ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/buscar-mercado-livre/deep-search?analysisId=${encodeURIComponent(result.sessionId)}`)}
                  >
                    <Database className="h-4 w-4" />
                    Abrir por ID
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void saveCurrentAnalysis()} disabled={savingAnalysis}>
                    {savingAnalysis ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                    Salvar agora
                  </Button>
                )}
              </CardContent>
            </Card>

            {result.progress.errors.length ? (
              <Alert>
                <PackageSearch className="h-4 w-4" />
                <AlertTitle>Avisos da análise</AlertTitle>
                <AlertDescription>{result.progress.errors.slice(-3).join(' | ')}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Ranking final" value={formatCount(summary.ranked)} icon={PackageSearch} />
              <MetricCard label="Anúncios lidos" value={formatCount(summary.scanned)} icon={Eye} />
              <MetricCard label="Candidatos únicos" value={formatCount(summary.uniqueCandidates)} icon={ListChecks} />
              <MetricCard label="Aparições" value={formatCount(summary.occurrences)} icon={Sparkles} />
              <MetricCard label="Categorias" value={formatCount(summary.categories)} icon={BarChart3} />
              <MetricCard label="Termos" value={formatCount(summary.terms)} icon={Search} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Filter className="h-4 w-4" />
                      Filtros do ranking
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Buscar nos resultados</Label>
                      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Título, vendedor, marca" />
                    </div>
                    <div className="space-y-2">
                      <Label>Ordenar por</Label>
                      <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="recurrence">Mais recorrentes</SelectItem>
                          <SelectItem value="opportunity">Maior oportunidade</SelectItem>
                          <SelectItem value="performance">Melhor performance</SelectItem>
                          <SelectItem value="similarity">Maior similaridade</SelectItem>
                          <SelectItem value="visits">Mais visitas</SelectItem>
                          <SelectItem value="price">Menor preço</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Separator />
                    <ScoreInput label="Similaridade mínima" value={minSimilarity} onChange={setMinSimilarity} />
                    <ScoreInput label="Performance mínima" value={minPerformance} onChange={setMinPerformance} />
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="font-medium">{filteredResults.length} / {result.results.length} resultados</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {result.metadata.totalQueries} buscas · {result.metadata.totalItemsScanned} candidatos · {result.metadata.totalOccurrences} aparições
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </aside>

              <section className="space-y-4">
                <DeepSearchExplorationPanel result={result} />
                <DeepSearchInsightsPanel result={result} />

                <div className="flex flex-col gap-1 rounded-lg border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Ranking final</h2>
                    <p className="text-xs text-muted-foreground">
                      Produtos que passaram pelos filtros e pela pontuação de similaridade.
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {filteredResults.length} / {result.results.length}
                  </Badge>
                </div>

                {filteredResults.length === 0 ? (
                  <Card>
                    <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-2 p-8 text-center">
                      <Search className="h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nenhum resultado nos filtros atuais</p>
                    </CardContent>
                  </Card>
                ) : (
                  filteredResults.map((entry) => (
                    <DeepSearchResultCard
                      key={entry.id}
                      entry={entry}
                      visitsLabel={formatVisitsWindowLabel(result.config.visitsWindow)}
                    />
                  ))
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function getClientItemKey(item: Pick<DeepSearchResultItem['item'], 'sourceType' | 'id'>) {
  return `${item.sourceType}:${item.id}`;
}

function sortQueryResults(queryResults: DeepSearchQueryResult[]) {
  const levelOrder: Record<DeepSearchQueryResult['level'], number> = {
    base: 0,
    category_trend: 1,
    derived_category_trend: 2,
  };

  return [...queryResults].sort((left, right) => {
    const levelDiff = levelOrder[left.level] - levelOrder[right.level];
    if (levelDiff !== 0) return levelDiff;
    const visitsDiff = right.totalVisits - left.totalVisits;
    if (visitsDiff !== 0) return visitsDiff;
    return right.acceptedCandidates - left.acceptedCandidates;
  });
}

function getClientQueryId(query: DeepSearchQueryResult, index: number) {
  return [
    query.queryId || 'query',
    query.level || 'base',
    query.categoryId || 'no-category',
    query.mode || 'items',
    index,
  ].join(':');
}

function formatSkippedReason(reason: DeepSearchConsideredItem['skippedReason']) {
  if (reason === 'base_product') return 'produto base';
  if (reason === 'filters') return 'fora dos filtros';
  return 'analisado';
}

function sortConsideredItemsByVisits(items: DeepSearchConsideredItem[]) {
  return [...items].sort((left, right) => {
    const visitsDiff = (right.item.totalVisits || 0) - (left.item.totalVisits || 0);
    if (visitsDiff !== 0) return visitsDiff;
    const occurrenceDiff = right.occurrenceNumber - left.occurrenceNumber;
    if (occurrenceDiff !== 0) return occurrenceDiff;
    return left.item.title.localeCompare(right.item.title, 'pt-BR');
  });
}

function buildAllCandidateItems(queryResults: DeepSearchQueryResult[]) {
  const byCompositeKey = new Map<string, DeepSearchConsideredItem>();

  queryResults.forEach((query) => {
    query.items.forEach((entry) => {
      if (!entry.accepted) return;
      const compositeKey = `${query.baseProductId}:${entry.itemKey}`;
      const current = byCompositeKey.get(compositeKey);
      if (!current) {
        byCompositeKey.set(compositeKey, entry);
        return;
      }

      const currentVisits = current.item.totalVisits || 0;
      const nextVisits = entry.item.totalVisits || 0;
      byCompositeKey.set(compositeKey, {
        ...(nextVisits > currentVisits ? entry : current),
        occurrenceNumber: Math.max(current.occurrenceNumber, entry.occurrenceNumber),
      });
    });
  });

  return sortConsideredItemsByVisits([...byCompositeKey.values()]);
}

function DeepSearchExplorationPanel({ result }: { result: DeepSearchResult }) {
  const queryResults = useMemo<DeepSearchQueryResultView[]>(
    () =>
      sortQueryResults(result.queryResults || []).map((query, index) => ({
        ...query,
        clientQueryId: getClientQueryId(query, index),
        originalIndex: index,
      })),
    [result.queryResults]
  );
  const allCandidateItems = useMemo(() => buildAllCandidateItems(result.queryResults || []), [result.queryResults]);
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(ALL_CANDIDATES_ID);
  const [queryFilter, setQueryFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [onlyAccepted, setOnlyAccepted] = useState(false);
  const visitsLabel = formatVisitsWindowLabel(result.config.visitsWindow);

  useEffect(() => {
    if (queryResults.length === 0) {
      setSelectedQueryId(null);
      return;
    }

    if (selectedQueryId === ALL_CANDIDATES_ID) return;
    if (!selectedQueryId || !queryResults.some((query) => query.clientQueryId === selectedQueryId)) {
      setSelectedQueryId(ALL_CANDIDATES_ID);
    }
  }, [queryResults, selectedQueryId]);

  const rankedByItemKey = useMemo(() => {
    const entries = new Map<string, DeepSearchResultItem>();
    result.results.forEach((entry) => {
      const itemKey = getClientItemKey(entry.item);
      const current = entries.get(itemKey);
      if (!current || entry.occurrenceCount > current.occurrenceCount) {
        entries.set(itemKey, entry);
      }
    });
    return entries;
  }, [result.results]);

  const filteredQueries = useMemo(() => {
    const search = queryFilter.trim().toLowerCase();
    if (!search) return queryResults;
    return queryResults.filter((query) => {
      const text = [
        query.query,
        query.reason,
        query.categoryName,
        query.categoryId,
        query.baseProductTitle,
        formatPhase(query.level),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(search);
    });
  }, [queryFilter, queryResults]);

  const selectedQuery = useMemo(
    () => queryResults.find((query) => query.clientQueryId === selectedQueryId) || null,
    [queryResults, selectedQueryId]
  );
  const selectedAllCandidates = selectedQueryId === ALL_CANDIDATES_ID;
  const selectedItemsSource = selectedAllCandidates ? allCandidateItems : selectedQuery?.items || [];
  const selectedTotalVisits = selectedAllCandidates
    ? allCandidateItems.reduce((sum, entry) => sum + (entry.item.totalVisits || 0), 0)
    : selectedQuery?.totalVisits || 0;

  const visibleItems = useMemo(() => {
    const search = itemFilter.trim().toLowerCase();
    return sortConsideredItemsByVisits(
      selectedItemsSource.filter((entry) => {
        if (onlyAccepted && !entry.accepted) return false;
        if (!search) return true;
        const item = entry.item;
        const text = [
          item.title,
          item.sellerNickname,
          item.brand,
          item.model,
          item.categoryId,
          item.categoryInfo?.name,
          item.categoryInfo?.path,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(search);
      })
    );
  }, [itemFilter, onlyAccepted, selectedItemsSource]);

  if (queryResults.length === 0) return null;

  return (
    <Card className="overflow-hidden rounded-lg">
      <CardHeader className="border-b bg-muted/20 pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" />
              Resultados por termo
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Navegue pelos anúncios lidos em cada termo executado pela Deep Search.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{formatCount(queryResults.length)} termos</Badge>
            <Badge variant="secondary">{formatCount(result.metadata.totalItemsScanned)} anúncios lidos</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid min-h-[520px] xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="border-b bg-slate-50/70 p-3 xl:border-b-0 xl:border-r">
            <Input
              value={queryFilter}
              onChange={(event) => setQueryFilter(event.target.value)}
              placeholder="Filtrar termos, categorias"
              className="mb-3 bg-white"
            />
            <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
              <button
                type="button"
                onClick={() => setSelectedQueryId(ALL_CANDIDATES_ID)}
                className={cn(
                  'w-full rounded-md border bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50',
                  selectedAllCandidates && 'border-blue-300 bg-blue-50/70'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-semibold text-slate-900">Todos os candidatos únicos</p>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    geral
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <span>{formatCount(result.metadata.totalItemsScanned)} lidos</span>
                  <span>{formatCount(allCandidateItems.length)} únicos</span>
                  <span>{formatCount(selectedTotalVisits)} visitas {result.config.visitsWindow || 7}d</span>
                </div>
                <p className="mt-2 truncate text-[11px] text-muted-foreground">
                  Ordenado por maior número de visitas
                </p>
              </button>

              {filteredQueries.length === 0 ? (
                <div className="rounded-md border bg-white p-3 text-xs text-muted-foreground">
                  Nenhum termo encontrado.
                </div>
              ) : (
                filteredQueries.map((query) => (
                  <button
                    key={query.clientQueryId}
                    type="button"
                    onClick={() => setSelectedQueryId(query.clientQueryId)}
                    className={cn(
                      'w-full rounded-md border bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50',
                      selectedQuery?.clientQueryId === query.clientQueryId && 'border-blue-300 bg-blue-50/70'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-xs font-semibold text-slate-900">{query.query}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {formatPhase(query.level)}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span>{formatCount(query.scanned)} lidos</span>
                      <span>{formatCount(query.acceptedCandidates)} analisados</span>
                      <span>{formatCount(query.totalVisits)} visitas {result.config.visitsWindow || 7}d</span>
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate">{query.categoryName || query.baseProductTitle}</span>
                      {query.categoryId ? (
                        <Badge variant="secondary" className="h-5 shrink-0 font-mono text-[10px]">
                          {query.categoryId}
                        </Badge>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="min-w-0 p-4">
            {selectedAllCandidates || selectedQuery ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="line-clamp-2 text-base font-semibold">
                        {selectedAllCandidates ? 'Todos os candidatos únicos' : selectedQuery?.query}
                      </h3>
                      <Badge variant="secondary">{selectedAllCandidates ? 'Geral' : formatMode(selectedQuery?.mode || '')}</Badge>
                      {!selectedAllCandidates && selectedQuery?.trendRank ? (
                        <Badge variant="outline">rank {selectedQuery.trendRank}</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedAllCandidates
                        ? 'Todos os candidatos aceitos pela busca antes do corte do ranking final.'
                        : selectedQuery?.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedAllCandidates
                        ? `${formatCount(result.metadata.totalOccurrences)} aparições em ${formatCount(queryResults.length)} termos`
                        : selectedQuery?.categoryName
                          ? `${selectedQuery.categoryName}${selectedQuery.categoryId ? ` · ${selectedQuery.categoryId}` : ''}`
                          : `Produto base: ${selectedQuery?.baseProductTitle}`}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs lg:min-w-[300px]">
                    <SummaryPill
                      label="Lidos"
                      value={formatCount(selectedAllCandidates ? result.metadata.totalItemsScanned : selectedQuery?.scanned)}
                    />
                    <SummaryPill
                      label={selectedAllCandidates ? 'Únicos' : 'Analisados'}
                      value={formatCount(selectedAllCandidates ? allCandidateItems.length : selectedQuery?.acceptedCandidates)}
                    />
                    <SummaryPill label={visitsLabel} value={formatCount(selectedTotalVisits)} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={itemFilter}
                    onChange={(event) => setItemFilter(event.target.value)}
                    placeholder="Buscar nos anúncios deste termo"
                    className="sm:max-w-sm"
                  />
                  <Button
                    type="button"
                    variant={onlyAccepted ? 'default' : 'outline'}
                    onClick={() => setOnlyAccepted((current) => !current)}
                    className="justify-start sm:justify-center"
                  >
                    {onlyAccepted ? <CheckCircle2 className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
                    Somente analisados
                  </Button>
                  <Badge variant="secondary" className="h-10 justify-center px-3">
                    {formatCount(visibleItems.length)} visíveis
                  </Badge>
                  <Badge variant="outline" className="h-10 justify-center px-3">
                    Mais visitas primeiro
                  </Badge>
                </div>

                <div className="max-h-[640px] space-y-2 overflow-auto pr-1">
                  {visibleItems.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-md border bg-muted/20 p-6 text-center">
                      <Search className="h-7 w-7 text-muted-foreground" />
                      <p className="mt-2 text-sm font-medium">Nenhum anúncio neste filtro</p>
                    </div>
                  ) : (
                    visibleItems.map((entry, index) => (
                      <ConsideredItemRow
                        key={`${selectedAllCandidates ? ALL_CANDIDATES_ID : selectedQuery?.clientQueryId || 'term'}:${entry.itemKey}:${index}`}
                        entry={entry}
                        rankedResult={rankedByItemKey.get(entry.itemKey)}
                        visitsLabel={visitsLabel}
                      />
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function ConsideredItemRow({
  entry,
  rankedResult,
  visitsLabel,
}: {
  entry: DeepSearchConsideredItem;
  rankedResult?: DeepSearchResultItem;
  visitsLabel: string;
}) {
  const item = entry.item;
  const statusLabel = rankedResult ? 'ranking final' : entry.accepted ? 'analisado' : formatSkippedReason(entry.skippedReason);
  const statusClass = rankedResult
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : entry.accepted
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  const categoryLabel = item.categoryInfo?.name || item.categoryId || '-';
  const recurrence = rankedResult?.occurrenceCount || entry.occurrenceNumber;

  return (
    <div className="rounded-md border bg-white p-3 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[64px_minmax(0,1fr)_180px]">
        <div className="h-16 w-16 overflow-hidden rounded-md border bg-slate-50">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt={item.title} className="h-full w-full object-contain" />
          ) : (
            <Box className="m-auto mt-4 h-8 w-8 text-muted-foreground" />
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn('h-5 border text-[10px]', statusClass)}>
              {entry.accepted ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {statusLabel}
            </Badge>
            {recurrence > 1 ? (
              <Badge variant="outline" className="h-5 text-[10px]">
                {recurrence} aparições
              </Badge>
            ) : null}
            {rankedResult ? (
              <Badge variant="outline" className="h-5 text-[10px]">
                oportunidade {rankedResult.scores.opportunity}%
              </Badge>
            ) : null}
          </div>

          <a
            href={resultUrl(item)}
            target="_blank"
            rel="noreferrer"
            className="group line-clamp-2 text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline"
          >
            {item.title}
            <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-60" />
          </a>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{categoryLabel}</span>
            {item.categoryId ? <span className="font-mono">{item.categoryId}</span> : null}
            {item.sellerNickname ? <span>{item.sellerNickname}</span> : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:block sm:space-y-2">
          <MetricLine label="Preço" value={formatMoney(item.price)} />
          <MetricLine label={visitsLabel} value={formatCount(item.totalVisits)} />
          <MetricLine label="Condição" value={item.condition || '-'} />
          <MetricLine label="Envio" value={item.logisticType || (item.freeShipping ? 'grátis' : '-')} />
        </div>
      </div>
    </div>
  );
}

function DeepSearchInsightsPanel({ result }: { result: DeepSearchResult }) {
  const topCategories = result.insights.categories.slice(0, 5);
  const topTerms = result.insights.terms.slice(0, 8);
  const recurring = result.insights.recurringProducts.slice(0, 5);
  const visitsLabel = formatVisitsWindowLabel(result.config.visitsWindow);

  if (topCategories.length === 0 && topTerms.length === 0 && recurring.length === 0) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <InsightCard title="Categorias fortes">
        {topCategories.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma categoria agregada.</p>
        ) : (
          topCategories.map((category) => (
            <CategoryInsightRow key={category.categoryId} category={category} visitsWindow={result.config.visitsWindow} />
          ))
        )}
      </InsightCard>

      <InsightCard title="Termos que mais abriram mercado">
        {topTerms.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum termo agregado.</p>
        ) : (
          topTerms.map((term, index) => (
            <TermInsightRow
              key={`${term.queryId}:${term.level}:${term.categoryId || 'no-category'}:${index}`}
              term={term}
              visitsWindow={result.config.visitsWindow}
            />
          ))
        )}
      </InsightCard>

      <InsightCard title="Produtos recorrentes">
        {recurring.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum produto apareceu em mais de uma busca.</p>
        ) : (
          recurring.map((item, index) => (
            <div key={`${item.itemKey}:${index}`} className="space-y-1 rounded-md border bg-muted/20 p-2">
              <div className="flex items-start gap-2">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded border bg-white">
                  {item.thumbnail ? <img src={item.thumbnail} alt={item.title} className="h-full w-full object-contain" /> : null}
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-xs font-medium">{item.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    <span>{formatCount(item.occurrences)} aparições</span>
                    <span>{formatCount(item.terms.length)} termos</span>
                    <span>{formatCount(item.visits)} {visitsLabel.toLowerCase()}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {item.categoryName ? <span className="truncate">{item.categoryName}</span> : null}
                {item.categoryId ? (
                  <Badge variant="outline" className="h-5 font-mono text-[10px]">
                    {item.categoryId}
                  </Badge>
                ) : null}
              </div>
              <p className="line-clamp-1 text-[11px] text-muted-foreground">{item.terms.join(' · ')}</p>
            </div>
          ))
        )}
      </InsightCard>
    </div>
  );
}

function InsightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function CategoryInsightRow({ category, visitsWindow }: { category: DeepSearchCategoryInsight; visitsWindow: number }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold">{category.name}</p>
        <Badge variant="outline" className="font-mono text-[10px]">
          {category.categoryId}
        </Badge>
      </div>
      {category.path && category.path !== category.name ? (
        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={category.path}>
          {category.path}
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span>{category.termsUsed} termos</span>
        <span>{formatCount(category.uniqueCandidates)} únicos</span>
        <span>{formatCount(category.maxVisits)} máx. {visitsWindow || 7}d</span>
      </div>
    </div>
  );
}

function TermInsightRow({ term, visitsWindow }: { term: DeepSearchTermInsight; visitsWindow: number }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold">{term.term}</p>
        <Badge variant="outline" className="text-[10px]">
          {formatPhase(term.level)}
        </Badge>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span>{formatCount(term.scanned)} lidos</span>
        <span>{formatCount(term.uniqueCandidates)} únicos</span>
        <span>{formatCount(term.totalVisits)} visitas {visitsWindow || 7}d</span>
      </div>
    </div>
  );
}

function SavedAnalysesPanel({
  analyses,
  loading,
  error,
  onRefresh,
  onOpen,
}: {
  analyses: DeepSearchSavedAnalysisSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpen: (analysisId: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Análises salvas
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <Database className="h-4 w-4" />
            <AlertTitle>Histórico indisponível</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading && analyses.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando análises salvas...
          </div>
        ) : null}

        {!loading && analyses.length === 0 ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            Nenhuma análise salva encontrada.
          </div>
        ) : null}

        {analyses.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {analyses.map((analysis) => (
              <button
                key={analysis.analysisId}
                type="button"
                onClick={() => onOpen(analysis.analysisId)}
                className="rounded-lg border bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold">{analysis.title}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">#{analysis.analysisId}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {formatVisitsWindowLabel(analysis.visitsWindow)}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <span>{formatCount(analysis.totalItemsScanned)} lidos</span>
                  <span>{formatCount(analysis.uniqueCandidates)} únicos</span>
                  <span>{formatCount(analysis.totalQueries)} termos</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {formatDateTime(analysis.completedAt)}
                  </span>
                  {analysis.accountName ? <span>{analysis.accountName}</span> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md border bg-muted p-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={value ? String(value) : ''}
        onChange={(event) => onChange(Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
        inputMode="numeric"
        placeholder="0"
      />
    </div>
  );
}

function DeepSearchResultCard({ entry, visitsLabel }: { entry: DeepSearchResultItem; visitsLabel: string }) {
  const item = entry.item;
  const hasFull = entry.signals.hasFull;
  const priceDelta = entry.signals.priceDeltaPercent;
  const scoreTone =
    entry.scores.opportunity >= 75
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : entry.scores.opportunity >= 60
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <Card className="overflow-hidden rounded-lg border-slate-200 bg-white shadow-sm">
      <div className="border-b bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className={cn('h-6 border text-xs', scoreTone)}>Oportunidade {entry.scores.opportunity}%</Badge>
            <Badge variant="secondary">Aparições {entry.occurrenceCount}</Badge>
            <Badge variant="outline">Similaridade {entry.scores.similarity}%</Badge>
            <Badge variant="outline">Performance {entry.scores.performance}%</Badge>
          </div>
          <Badge variant="secondary">{formatMode(entry.foundBy.mode)}</Badge>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[96px_minmax(0,1fr)_260px]">
        <div className="h-24 w-24 overflow-hidden rounded-md border bg-slate-50">
          {item.thumbnail ? <img src={item.thumbnail} alt={item.title} className="h-full w-full object-contain" /> : <Box className="m-auto mt-7 h-9 w-9 text-muted-foreground" />}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <a
              href={resultUrl(item)}
              target="_blank"
              rel="noreferrer"
              className="group line-clamp-2 text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline"
            >
              {item.title}
              <ExternalLink className="ml-1 inline-block h-3 w-3 opacity-60" />
            </a>
            <p className="text-xs text-muted-foreground">Base: {entry.baseProduct.title}</p>
            <p className="text-xs text-muted-foreground">Query: {entry.foundBy.query}</p>
            {entry.occurrenceCount > 1 ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                Apareceu em: {entry.occurrences.map((occurrence) => occurrence.query).slice(0, 6).join(' · ')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {entry.labels.map((label) => (
              <Badge key={label} variant="outline" className="h-5 text-[10px]">
                {label}
              </Badge>
            ))}
          </div>

          {entry.reasons.length > 0 ? (
            <p className="text-xs text-slate-600">{entry.reasons.join(' · ')}</p>
          ) : null}
        </div>

        <aside className="space-y-3">
          <div className="rounded-md border bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <MetricLine label="Preço" value={formatMoney(item.price)} />
              <MetricLine label="Delta" value={priceDelta === null ? '-' : `${priceDelta > 0 ? '+' : ''}${priceDelta}%`} />
              <MetricLine label={visitsLabel} value={formatCount(entry.signals.visits)} />
              <MetricLine label="Aparições" value={formatCount(entry.occurrenceCount)} />
            </div>
          </div>

          <div className="space-y-1.5 text-xs text-slate-600">
            {item.sellerNickname ? (
              <p className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5" />
                {item.sellerNickname}
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" />
              {hasFull ? 'Full' : item.hasFlex ? 'Flex' : item.freeShipping ? 'Frete grátis' : 'Frete normal'}
            </p>
          </div>
        </aside>
      </div>
    </Card>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  );
}
