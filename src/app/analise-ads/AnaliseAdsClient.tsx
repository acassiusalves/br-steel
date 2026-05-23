'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Megaphone,
  PackageSearch,
  RefreshCw,
  Store,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import DashboardLayout from '@/components/dashboard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  getMercadoLivreListings,
  listMlAccounts,
  syncMercadoLivreAdsAnalytics,
} from '@/app/actions';
import type {
  MlAdsCampaignDetail,
  MlAdsRecommendation,
  MlListingsListResult,
} from '@/services/ml-listings-cache';
import { cn } from '@/lib/utils';

type MlAccountSummary = Awaited<ReturnType<typeof listMlAccounts>>[number];
type AdsCampaignHistoryPoint = MlAdsCampaignDetail['history'][number];

function formatMoney(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatCompactMoney(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) return `R$ ${(value / 1000).toFixed(1).replace('.', ',')} mil`;
  return formatMoney(value);
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1).replace('.', ',')} mi`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1).replace('.', ',')} mil`;
  return formatNumber(value);
}

function formatPercent(value: number | null | undefined, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(decimals).replace('.', ',')}%`;
}

function formatDecimal(value: number | null | undefined, decimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(decimals).replace('.', ',');
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return '-';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Nunca sincronizado';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data indisponivel';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function adsCampaignKey(campaign: Pick<MlAdsCampaignDetail, 'accountId' | 'campaignId'>) {
  return `${campaign.accountId}:${campaign.campaignId}`;
}

function statusLabel(status: string | null | undefined) {
  if (status === 'active') return 'Ativo';
  if (status === 'paused') return 'Pausado';
  if (status === 'closed') return 'Fechado';
  if (status === 'under_review') return 'Em revisao';
  return status || '-';
}

function recommendationTone(severity: MlAdsRecommendation['severity']) {
  if (severity === 'positive') return 'border-emerald-200 bg-emerald-50 text-emerald-950';
  if (severity === 'critical') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-amber-200 bg-amber-50 text-amber-950';
}

function DetailMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function ProductThumb({
  row,
}: {
  row: { thumbnail: string | null; title: string | null; itemId: string };
}) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
      {row.thumbnail ? (
        <img src={row.thumbnail} alt={row.title || row.itemId} className="h-full w-full object-contain" />
      ) : (
        <PackageSearch className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );
}

function sumAdsHistory(points: AdsCampaignHistoryPoint[]) {
  const cost = points.reduce((sum, point) => sum + point.cost, 0);
  const totalAmount = points.reduce((sum, point) => sum + point.totalAmount, 0);
  const unitsQuantity = points.reduce((sum, point) => sum + point.unitsQuantity, 0);
  const clicks = points.reduce((sum, point) => sum + point.clicks, 0);
  const prints = points.reduce((sum, point) => sum + point.prints, 0);

  return {
    cost,
    totalAmount,
    unitsQuantity,
    clicks,
    prints,
    roas: cost > 0 ? totalAmount / cost : null,
    acos: totalAmount > 0 ? (cost / totalAmount) * 100 : null,
    ctr: prints > 0 ? (clicks / prints) * 100 : null,
    cvr: clicks > 0 ? (unitsQuantity / clicks) * 100 : null,
  };
}

function AdsHistoryTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as AdsCampaignHistoryPoint | undefined;
  if (!point) return null;

  return (
    <div className="rounded-md border bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 font-medium">{formatShortDate(label)}</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Investimento</span>
          <span className="font-medium">{formatMoney(point.cost)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Receita</span>
          <span className="font-medium">{formatMoney(point.totalAmount)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">ROAS</span>
          <span className="font-medium">{formatDecimal(point.roas)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Cliques</span>
          <span className="font-medium">{formatNumber(point.clicks)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Impressoes</span>
          <span className="font-medium">{formatNumber(point.prints)}</span>
        </div>
      </div>
    </div>
  );
}

function AdsCampaignHistory({ history }: { history: AdsCampaignHistoryPoint[] }) {
  const points = history.filter((point) => point.cost > 0 || point.totalAmount > 0 || point.prints > 0);

  if (points.length < 2) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Historico diario ainda indisponivel para esta campanha.
      </div>
    );
  }

  const lastSeven = sumAdsHistory(points.slice(-7));
  const previousSeven = sumAdsHistory(points.slice(-14, -7));
  const roasDelta = lastSeven.roas !== null && previousSeven.roas !== null
    ? lastSeven.roas - previousSeven.roas
    : null;
  const costDelta = previousSeven.cost > 0
    ? ((lastSeven.cost - previousSeven.cost) / previousSeven.cost) * 100
    : null;

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-medium">Historico diario</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatShortDate(points[0]?.date)} ate {formatShortDate(points[points.length - 1]?.date)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DetailMetric label="7d invest." value={formatMoney(lastSeven.cost)} hint={costDelta === null ? undefined : `${formatPercent(costDelta)} vs 7d ant.`} />
          <DetailMetric label="7d receita" value={formatMoney(lastSeven.totalAmount)} hint={`${formatNumber(lastSeven.unitsQuantity)} un.`} />
          <DetailMetric label="7d ROAS" value={formatDecimal(lastSeven.roas)} hint={roasDelta === null ? undefined : `${roasDelta >= 0 ? '+' : ''}${formatDecimal(roasDelta)}`} />
          <DetailMetric label="7d CTR" value={formatPercent(lastSeven.ctr)} hint={`${formatCompactNumber(lastSeven.prints)} imp.`} />
        </div>
      </div>

      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.35} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="money"
              tickFormatter={formatCompactMoney}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={76}
            />
            <YAxis
              yAxisId="roas"
              orientation="right"
              tickFormatter={(value) => formatDecimal(Number(value), 1)}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <RechartsTooltip content={<AdsHistoryTooltip />} />
            <Bar yAxisId="money" dataKey="totalAmount" name="Receita" fill="#2563eb" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="money" dataKey="cost" name="Investimento" fill="#0f766e" radius={[3, 3, 0, 0]} />
            <Line
              yAxisId="roas"
              type="monotone"
              dataKey="roas"
              name="ROAS"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#2563eb]" />Receita Ads</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#0f766e]" />Investimento</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-[#f59e0b]" />ROAS</span>
      </div>
    </div>
  );
}

function AdsListingFlags({ listing }: { listing: MlAdsCampaignDetail['listings'][number] }) {
  const flags: string[] = [];
  if (listing.adsCost >= 50 && listing.adsUnitsQuantity === 0) flags.push('sem venda');
  if ((listing.adsRoas ?? 0) > 0 && (listing.adsRoas ?? 0) < 3) flags.push('ROAS baixo');
  if ((listing.adsAcos ?? 0) > 30) flags.push('ACOS alto');
  if (listing.adsPrints >= 1000 && (listing.adsCtr ?? 0) < 0.2) flags.push('CTR baixo');
  if (listing.adsClicks >= 50 && (listing.adsCvr ?? 0) < 1) flags.push('CVR baixo');

  if (flags.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {flags.slice(0, 2).map((flag) => (
        <Badge key={flag} variant="destructive" className="text-[10px]">
          {flag}
        </Badge>
      ))}
    </div>
  );
}

function AdsCampaignDetailPanel({
  details,
  selectedKey,
  onSelect,
}: {
  details: MlAdsCampaignDetail[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const selected = details.find((detail) => adsCampaignKey(detail) === selectedKey) || details[0] || null;

  if (!selected) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        Sem detalhe de campanha sincronizado.
      </div>
    );
  }

  const currentKey = adsCampaignKey(selected);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Detalhe da campanha
            </CardTitle>
            <CardDescription>
              Analise por campanha, produtos, anuncios e historico diario.
            </CardDescription>
          </div>
          <Select value={currentKey} onValueChange={onSelect}>
            <SelectTrigger className="w-full lg:w-[340px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {details.map((detail) => (
                <SelectItem key={adsCampaignKey(detail)} value={adsCampaignKey(detail)}>
                  {detail.name || detail.campaignId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/30 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="truncate font-semibold">{selected.name || selected.campaignId}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{selected.accountName || selected.accountId}</span>
                <span>{selected.status || '-'}</span>
                {selected.strategy ? <span>{selected.strategy}</span> : null}
                {selected.budget !== null ? <span>orcamento {formatMoney(selected.budget)}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.highSpendNoSales > 0 ? <Badge variant="destructive">{selected.highSpendNoSales} sem venda</Badge> : null}
              {selected.lowRoasListings > 0 ? <Badge variant="destructive">{selected.lowRoasListings} ROAS baixo</Badge> : null}
              {selected.highAcosListings > 0 ? <Badge variant="destructive">{selected.highAcosListings} ACOS alto</Badge> : null}
              {selected.lowCtrListings > 0 ? <Badge variant="outline">{selected.lowCtrListings} CTR baixo</Badge> : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <DetailMetric label="Investimento" value={formatMoney(selected.cost)} />
          <DetailMetric label="Receita Ads" value={formatMoney(selected.totalAmount)} hint={`${formatNumber(selected.unitsQuantity)} un.`} />
          <DetailMetric label="ROAS" value={formatDecimal(selected.roas)} />
          <DetailMetric label="ACOS" value={formatPercent(selected.acos)} />
          <DetailMetric label="CTR" value={formatPercent(selected.ctr)} hint={`${formatNumber(selected.prints)} impressoes`} />
          <DetailMetric label="CVR" value={formatPercent(selected.cvr)} hint={`${formatNumber(selected.clicks)} cliques`} />
          <DetailMetric label="Anuncios Ads" value={formatNumber(selected.adsCount)} hint={`${formatNumber(selected.localListingsCount)} cruzados`} />
          <DetailMetric label="Qualidade media" value={formatPercent(selected.averageQualityScore, 0)} hint={`${formatNumber(selected.visitsLast30Days)} visitas 30d`} />
        </div>

        <AdsCampaignHistory history={selected.history} />

        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-3">
            <div className="text-sm font-medium">Produtos/ad groups</div>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Grupo</TableHead>
                    <TableHead className="text-right">Invest.</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.adGroups.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">
                        Nenhum grupo local cruzado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selected.adGroups.map((group) => (
                      <TableRow key={group.key}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ProductThumb row={{ thumbnail: group.thumbnail, title: group.label, itemId: group.topItemId || group.key }} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{group.label}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {formatNumber(group.listingsCount)} anuncio(s)
                                {group.adGroupId ? ` · ad group ${group.adGroupId}` : ''}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatMoney(group.cost)}</TableCell>
                        <TableCell className="text-right">{formatMoney(group.totalAmount)}</TableCell>
                        <TableCell className="text-right">{formatDecimal(group.roas)}</TableCell>
                        <TableCell className="text-right">{formatPercent(group.ctr)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">Anuncios que mais consomem verba</div>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anuncio</TableHead>
                    <TableHead>Status Ads</TableHead>
                    <TableHead className="text-right">Invest./receita</TableHead>
                    <TableHead className="text-right">ROAS/ACOS</TableHead>
                    <TableHead className="text-right">Alertas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.listings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">
                        Nenhum anuncio local cruzado com esta campanha.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selected.listings.map((listing) => (
                      <TableRow key={listing.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ProductThumb row={listing} />
                            <div className="min-w-0">
                              <div className="line-clamp-2 text-sm font-medium">{listing.title || listing.itemId}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                <span className="font-mono">{listing.itemId}</span>
                                {listing.sellerSku ? <span>SKU {listing.sellerSku}</span> : null}
                                {listing.permalink ? (
                                  <a href={listing.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground">
                                    ML <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline">{listing.adsStatus || '-'}</Badge>
                            <div className="text-xs text-muted-foreground">{statusLabel(listing.status)}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium">{formatMoney(listing.adsCost)}</div>
                          <div className="text-xs text-muted-foreground">{formatMoney(listing.adsTotalAmount)}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium">{formatDecimal(listing.adsRoas)}</div>
                          <div className="text-xs text-muted-foreground">{formatPercent(listing.adsAcos)}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <AdsListingFlags listing={listing} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnaliseAdsClient() {
  const { toast } = useToast();
  const [accounts, setAccounts] = React.useState<MlAccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState<string>('all');
  const [data, setData] = React.useState<MlListingsListResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSyncingAds, setIsSyncingAds] = React.useState(false);
  const [selectedCampaignKey, setSelectedCampaignKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listMlAccounts()
      .then((result) => {
        if (!cancelled) setAccounts(result);
      })
      .catch((error) => {
        toast({
          title: 'Erro ao carregar contas ML',
          description: error instanceof Error ? error.message : 'Nao foi possivel listar contas.',
          variant: 'destructive',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getMercadoLivreListings({
        accountId: selectedAccountId === 'all' ? null : selectedAccountId,
        offset: 0,
        limit: 1,
        viewMode: 'list',
        groupBy: 'sku',
        analysisFilter: 'all',
      });
      setData(result);
    } catch (error) {
      toast({
        title: 'Erro ao carregar analise Ads',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountId, toast]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSyncAds = React.useCallback(async () => {
    setIsSyncingAds(true);
    try {
      const targetAccounts =
        selectedAccountId !== 'all'
          ? [selectedAccountId]
          : accounts.length > 0
            ? accounts.map((account) => account.accountId)
            : [null];

      let campaigns = 0;
      let ads = 0;
      let campaignDaily = 0;
      let adDaily = 0;
      for (const accountId of targetAccounts) {
        const report = await syncMercadoLivreAdsAnalytics(accountId);
        campaigns += report.campaignsSynced;
        ads += report.adsSynced;
        campaignDaily += report.campaignDailySynced;
        adDaily += report.adsDailySynced;
      }

      toast({
        title: 'Metricas de Ads sincronizadas',
        description: `${formatNumber(campaigns)} campanha(s), ${formatNumber(ads)} anuncio(s), ${formatNumber(campaignDaily)} dia/campanha e ${formatNumber(adDaily)} dia/anuncio.`,
      });
      await loadData();
    } catch (error) {
      toast({
        title: 'Erro na sincronizacao de Ads',
        description: error instanceof Error ? error.message : 'Nao foi possivel carregar metricas pagas.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingAds(false);
    }
  }, [accounts, loadData, selectedAccountId, toast]);

  const details = data?.adsCampaignDetails || [];
  const activeCampaignKey = details.some((detail) => adsCampaignKey(detail) === selectedCampaignKey)
    ? selectedCampaignKey
    : details[0]
      ? adsCampaignKey(details[0])
      : null;
  const selectedAccountLabel = selectedAccountId === 'all'
    ? 'Todas as contas'
    : accounts.find((account) => account.accountId === selectedAccountId)?.nickname || selectedAccountId;

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-yellow-400 text-sm font-bold text-black">
                ADS
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Analise Ads Mercado Livre</h1>
                <p className="text-sm text-muted-foreground">
                  Campanhas pagas · Product Ads · {selectedAccountLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={selectedAccountId}
              onValueChange={(value) => {
                setSelectedAccountId(value);
                setSelectedCampaignKey(null);
              }}
            >
              <SelectTrigger className="w-full sm:w-[240px]">
                <SelectValue placeholder="Todas as contas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.accountId} value={account.accountId}>
                    {account.nickname || account.accountName || account.accountId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/anuncios-mercado-livre">
                <Store className="h-4 w-4" />
                Anuncios ML
              </Link>
            </Button>
            <Button onClick={handleSyncAds} disabled={isSyncingAds} className="gap-2">
              {isSyncingAds ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isSyncingAds ? 'Sincronizando...' : 'Atualizar Ads'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <DetailMetric label="Anuncios em Ads" value={formatNumber(data?.summary.adsListings)} hint={`${formatNumber(data?.adsSyncState?.campaignsSynced)} campanhas`} />
          <DetailMetric label="Investimento" value={formatMoney(data?.summary.adsCost)} />
          <DetailMetric label="Receita Ads" value={formatMoney(data?.summary.adsTotalAmount)} hint={`${formatNumber(data?.summary.adsUnitsQuantity)} un.`} />
          <DetailMetric label="ROAS" value={formatDecimal(data?.summary.adsRoas)} hint={`ACOS ${formatPercent(data?.summary.adsAcos)}`} />
          <DetailMetric label="CTR" value={formatPercent(data?.summary.adsCtr)} hint={`${formatCompactNumber(data?.summary.adsPrints)} imp.`} />
          <DetailMetric label="CVR" value={formatPercent(data?.summary.adsCvr)} hint={`${formatNumber(data?.summary.adsClicks)} cliques`} />
          <DetailMetric label="ROAS baixo" value={formatNumber(data?.summary.adsLowRoas)} />
          <DetailMetric label="Gasto sem venda" value={formatNumber(data?.summary.adsHighSpendNoSales)} />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Megaphone className="h-4 w-4" />
                  Visao geral de Ads
                </CardTitle>
                <CardDescription>
                  {data?.adsSyncState?.lastSyncedAt
                    ? `Periodo ${data.adsSyncState.dateFrom} ate ${data.adsSyncState.dateTo} · atualizado ${formatDate(data.adsSyncState.lastSyncedAt)}`
                    : 'Atualize Ads para cruzar investimento pago, receita, anuncios e historico.'}
                </CardDescription>
              </div>
              {data?.adsSyncState?.dailyDateFrom ? (
                <Badge variant="outline">
                  Historico {data.adsSyncState.dailyDateFrom} ate {data.adsSyncState.dailyDateTo}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Campanhas por investimento</div>
                  <Badge variant="outline">{formatNumber(data?.adsCampaigns.length)} campanhas</Badge>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campanha</TableHead>
                        <TableHead className="text-right">Invest.</TableHead>
                        <TableHead className="text-right">Receita</TableHead>
                        <TableHead className="text-right">ROAS</TableHead>
                        <TableHead className="text-right">ACOS</TableHead>
                        <TableHead className="text-right">Anuncios</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">
                            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                            Carregando campanhas...
                          </TableCell>
                        </TableRow>
                      ) : !data || data.adsCampaigns.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">
                            Sem campanhas sincronizadas.
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.adsCampaigns.map((campaign) => {
                          const key = adsCampaignKey(campaign);
                          return (
                            <TableRow
                              key={key}
                              className={cn('cursor-pointer', activeCampaignKey === key && 'bg-muted/60')}
                              onClick={() => setSelectedCampaignKey(key)}
                            >
                              <TableCell>
                                <div className="font-medium">{campaign.name || campaign.campaignId}</div>
                                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                  {campaign.accountName ? <span>{campaign.accountName}</span> : null}
                                  <span>{campaign.status || '-'}</span>
                                  {campaign.strategy ? <span>· {campaign.strategy}</span> : null}
                                  {campaign.budget !== null ? <span>· orcamento {formatMoney(campaign.budget)}</span> : null}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{formatMoney(campaign.cost)}</TableCell>
                              <TableCell className="text-right">{formatMoney(campaign.totalAmount)}</TableCell>
                              <TableCell className="text-right">{formatDecimal(campaign.roas)}</TableCell>
                              <TableCell className="text-right">{formatPercent(campaign.acos)}</TableCell>
                              <TableCell className="text-right">{formatNumber(campaign.adsCount)}</TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Recomendacoes</div>
                  <Badge variant="outline">{formatNumber(data?.adsRecommendations.length)}</Badge>
                </div>
                {!data || data.adsRecommendations.length === 0 ? (
                  <div className="rounded-md border p-4 text-sm text-muted-foreground">
                    Sem recomendacoes com os criterios atuais.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.adsRecommendations.slice(0, 8).map((recommendation) => (
                      <div
                        key={recommendation.id}
                        className={cn('rounded-md border p-3', recommendationTone(recommendation.severity))}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {recommendation.severity === 'critical' ? <AlertTriangle className="h-4 w-4" /> : null}
                              {recommendation.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs opacity-80">{recommendation.description}</div>
                            {recommendation.campaignName ? (
                              <div className="mt-1 text-xs opacity-80">Campanha: {recommendation.campaignName}</div>
                            ) : null}
                          </div>
                          <Badge variant="outline" className="shrink-0 bg-background/60">
                            {recommendation.metricLabel} {recommendation.metricLabel === 'Investimento' ? formatMoney(recommendation.metricValue) : formatDecimal(recommendation.metricValue)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <AdsCampaignDetailPanel
          details={details}
          selectedKey={activeCampaignKey}
          onSelect={setSelectedCampaignKey}
        />
      </div>
    </DashboardLayout>
  );
}
