'use client';

import * as React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PriceHistoryEntry } from '@/lib/deep-search-types'; // Adjusted import

interface PriceHistoryChartProps {
    data: PriceHistoryEntry[];
    currentPrice?: number | null;
    className?: string;
}

// Formata valor em BRL
const formatBRL = (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
};

// Formata data para exibição
const formatDate = (dateStr: string) => {
    try {
        return format(parseISO(dateStr), 'dd/MM', { locale: ptBR });
    } catch {
        return dateStr;
    }
};

// Calcula tendência de preço
const calculateTrend = (data: PriceHistoryEntry[]): { trend: 'up' | 'down' | 'stable'; percentage: number } => {
    if (data.length < 2) return { trend: 'stable', percentage: 0 };

    const firstValidPrice = data.find(d => d.avgPrice !== null)?.avgPrice;
    const lastValidPrice = [...data].reverse().find(d => d.avgPrice !== null)?.avgPrice;

    if (!firstValidPrice || !lastValidPrice) return { trend: 'stable', percentage: 0 };

    const percentage = ((lastValidPrice - firstValidPrice) / firstValidPrice) * 100;

    if (percentage > 2) return { trend: 'up', percentage };
    if (percentage < -2) return { trend: 'down', percentage };
    return { trend: 'stable', percentage };
};

// Tooltip customizado
const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0]?.payload;
    if (!data) return null;

    return (
        <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 text-xs">
            <p className="font-semibold text-sm mb-2">{formatDate(label)}</p>
            <div className="space-y-1">
                {data.avgPrice !== null && (
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Média:</span>
                        <span className="font-medium text-primary">{formatBRL(data.avgPrice)}</span>
                    </div>
                )}
                {data.minPrice !== null && data.maxPrice !== null && (
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Range:</span>
                        <span className="font-medium">{formatBRL(data.minPrice)} - {formatBRL(data.maxPrice)}</span>
                    </div>
                )}
                {data.classicPrice !== null && (
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Clássico:</span>
                        <span className="font-medium text-blue-600">{formatBRL(data.classicPrice)}</span>
                    </div>
                )}
                {data.premiumPrice !== null && (
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Premium:</span>
                        <span className="font-medium text-purple-600">{formatBRL(data.premiumPrice)}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export function PriceHistoryChart({ data, currentPrice, className }: PriceHistoryChartProps) {
    // Se não há dados suficientes, mostra placeholder
    if (!data || data.length < 2) {
        return (
            <div className={cn("flex items-center justify-center h-[140px] bg-muted/20 rounded-lg border border-dashed", className)}>
                <div className="text-center text-muted-foreground text-xs">
                    <p className="font-medium">Histórico de Preços</p>
                    <p className="text-[10px] mt-1">Dados insuficientes (mín. 2 dias)</p>
                </div>
            </div>
        );
    }

    const { trend, percentage } = calculateTrend(data);

    // Calcula domínio do Y com margem
    const allPrices = data.flatMap(d => [d.avgPrice, d.minPrice, d.maxPrice].filter(p => p !== null)) as number[];
    const minY = Math.min(...allPrices) * 0.95;
    const maxY = Math.max(...allPrices) * 1.05;

    const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
    const trendColor = trend === 'up' ? 'text-red-500' : trend === 'down' ? 'text-green-500' : 'text-muted-foreground';

    return (
        <div className={cn("bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/40 dark:to-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 p-3", className)}>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Histórico de Preços</span>
                    <span className="text-[10px] text-muted-foreground/70">({data.length} dias)</span>
                </div>
                <div className={cn("flex items-center gap-1 text-xs", trendColor)}>
                    <TrendIcon className="h-3 w-3" />
                    <span className="font-medium">{Math.abs(percentage).toFixed(1)}%</span>
                </div>
            </div>

            {/* Chart */}
            <div className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
                        margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="rangeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis
                            dataKey="date"
                            tickFormatter={formatDate}
                            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={[minY, maxY]}
                            tickFormatter={(v) => formatBRL(v).replace('R$', '')}
                            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            width={50}
                        />
                        <Tooltip content={<CustomTooltip />} />

                        {/* Área de range min-max (fundo) */}
                        <Area
                            type="monotone"
                            dataKey="maxPrice"
                            stroke="transparent"
                            fill="url(#rangeGradient)"
                            fillOpacity={1}
                        />

                        {/* Linha do preço médio (principal) */}
                        <Area
                            type="monotone"
                            dataKey="avgPrice"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            fill="url(#priceGradient)"
                            dot={false}
                            activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
                        />

                        {/* Linha de preço mínimo (pontilhada) */}
                        <Line
                            type="monotone"
                            dataKey="minPrice"
                            stroke="#22c55e"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                            dot={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-2">
                <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-primary rounded" />
                    <span className="text-[9px] text-muted-foreground">Média</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-green-500 rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, #22c55e 2px, #22c55e 4px)' }} />
                    <span className="text-[9px] text-muted-foreground">Mínimo</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-slate-400/20 rounded" />
                    <span className="text-[9px] text-muted-foreground">Range</span>
                </div>
            </div>
        </div>
    );
}
