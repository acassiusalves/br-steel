
"use client";

import {
  Calendar as CalendarIcon,
  DollarSign,
  Filter,
  ShoppingCart,
  Users,
  Loader2,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, TooltipProps, PieChart, Pie, Cell } from "recharts";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getSalesDashboardData } from "@/app/actions";
import { Skeleton } from "./ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";


// Helper to format currency
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

// Helper to format percentage change
const formatChange = (change: number) => {
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

// Component for stat cards
const StatCard = ({ title, value, icon: Icon, change, isLoading, valueFormatter = (v) => v.toLocaleString() }: {
  title: string;
  value: number;
  icon: React.ElementType;
  change: number;
  isLoading: boolean;
  valueFormatter?: (value: number) => string;
}) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{valueFormatter(value)}</div>
            <p className="text-xs text-muted-foreground">
              {formatChange(change)} em relação ao período anterior
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const CustomTooltip = React.memo(({ active, payload, label }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="p-2 bg-background border rounded-md shadow-lg text-sm">
        <p className="font-bold mb-1">{label}</p>
        <p>
          <span className="font-medium">Faturamento:</span> {formatCurrency(payload[0].value!)}
        </p>
        <p>
          <span className="font-medium">Quantidade Vendida:</span> {data.total}
        </p>
      </div>
    );
  }
  return null;
});
CustomTooltip.displayName = 'CustomTooltip';

const PieChartTooltip = React.memo(({ active, payload }: TooltipProps<number, string>) => {
    if (active && payload && payload.length) {
        const data = payload[0];
        return (
            <div className="p-2 bg-background border rounded-md shadow-lg text-sm">
                <p className="font-bold mb-1">{data.name}</p>
                <p>
                    <span className="font-medium">Faturamento:</span> {formatCurrency(data.value!)}
                </p>
            </div>
        );
    }
    return null;
});
PieChartTooltip.displayName = 'PieChartTooltip';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1919', '#19B2FF', '#FF6666', '#66FF66', '#6666FF'];

const stateMap: { [key: string]: string } = {
  'AC': 'Acre', 'AL': 'Alagoas', 'AP': 'Amapá', 'AM': 'Amazonas',
  'BA': 'Bahia', 'CE': 'Ceará', 'DF': 'Distrito Federal', 'ES': 'Espírito Santo',
  'GO': 'Goiás', 'MA': 'Maranhão', 'MT': 'Mato Grosso', 'MS': 'Mato Grosso do Sul',
  'MG': 'Minas Gerais', 'PA': 'Pará', 'PB': 'Paraíba', 'PR': 'Paraná',
  'PE': 'Pernambuco', 'PI': 'Piauí', 'RJ': 'Rio de Janeiro', 'RN': 'Rio Grande do Norte',
  'RS': 'Rio Grande do Sul', 'RO': 'Rondônia', 'RR': 'Roraima', 'SC': 'Santa Catarina',
  'SP': 'São Paulo', 'SE': 'Sergipe', 'TO': 'Tocantins', 'N/A': 'Não Aplicável'
};

const CustomLegend = React.memo(({ payload, totalRevenue }: { payload: any[], totalRevenue: number }) => {
    return (
        <ScrollArea className="h-[350px] w-full lg:w-56">
            <div className="space-y-3 pr-4">
                {payload.map((entry, index) => {
                    const percentage = totalRevenue > 0 ? (entry.revenue / totalRevenue) * 100 : 0;
                    return (
                        <div key={`item-${index}`} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                <span className="text-sm text-muted-foreground truncate" title={stateMap[entry.state] || entry.state}>
                                    {stateMap[entry.state] || entry.state}
                                </span>
                            </div>
                            <span className="font-medium text-sm">{percentage.toFixed(1)}%</span>
                        </div>
                    );
                })}
            </div>
        </ScrollArea>
    )
});
CustomLegend.displayName = 'CustomLegend';

export default function SalesDashboard() {
  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    const today = new Date();
    return {
      from: startOfMonth(today),
      to: endOfMonth(today),
    };
  });

  const [isLoading, setIsLoading] = React.useState(true);
  const [data, setData] = React.useState<Awaited<ReturnType<typeof getSalesDashboardData>> | null>(null);

  const { toast } = useToast();

  const fetchData = React.useCallback(async (currentDate: DateRange | undefined) => {
      if (!currentDate?.from || !currentDate?.to) {
        return;
      }
      setIsLoading(true);
      try {
        const result = await getSalesDashboardData({ from: currentDate.from, to: currentDate.to });
        setData(result);
      } catch (error: any) {
        console.error("Failed to fetch dashboard data:", error);
        toast({
          variant: "destructive",
          title: "Erro ao buscar dados",
          description: error.message,
        });
        setData(null);
      } finally {
        setIsLoading(false);
      }
  }, [toast]);

  // Carrega dados ao montar o componente ou quando a data muda
  React.useEffect(() => {
    fetchData(date);
  }, [date, fetchData]);

  const handleFilter = () => {
    fetchData(date);
  };

  const setDatePreset = (preset: 'today' | 'yesterday' | 'last7' | 'last30' | 'last3Months' | 'thisMonth' | 'lastMonth') => {
      const today = new Date();
      switch (preset) {
          case 'today':
              setDate({ from: today, to: today });
              break;
          case 'yesterday':
              const yesterday = subDays(today, 1);
              setDate({ from: yesterday, to: yesterday });
              break;
          case 'last7':
              setDate({ from: subDays(today, 6), to: today });
              break;
          case 'last30':
              setDate({ from: subDays(today, 29), to: today });
              break;
          case 'last3Months':
              setDate({ from: subMonths(today, 3), to: today });
              break;
          case 'thisMonth':
              setDate({ from: startOfMonth(today), to: endOfMonth(today) });
              break;
          case 'lastMonth':
              const lastMonthStart = startOfMonth(subMonths(today, 1));
              const lastMonthEnd = endOfMonth(subMonths(today, 1));
              setDate({ from: lastMonthStart, to: lastMonthEnd });
              break;
      }
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Painel de Vendas</h2>
          <p className="text-muted-foreground">
            Visualize o desempenho das suas vendas em um só lugar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant={"outline"}
                  className={cn(
                    "w-full sm:w-[260px] justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, "dd/MM/yy")} -{" "}
                        {format(date.to, "dd/MM/yy")}
                      </>
                    ) : (
                      format(date.from, "dd/MM/yy")
                    )
                  ) : (
                    <span>Escolha um período</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 flex" align="end">
                 <div className="flex flex-col space-y-1 p-2 border-r">
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('today')}>Hoje</Button>
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('yesterday')}>Ontem</Button>
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last7')}>Últimos 7 dias</Button>
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last30')}>Últimos 30 dias</Button>
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last3Months')}>Últimos 3 meses</Button>
                    <Separator />
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('thisMonth')}>Este mês</Button>
                    <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('lastMonth')}>Mês passado</Button>
                </div>
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={date?.from}
                  selected={date}
                  onSelect={setDate}
                  numberOfMonths={2}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
          <Select disabled>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Marketplace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="mercado-livre">Mercado Livre</SelectItem>
              <SelectItem value="amazon">Amazon</SelectItem>
              <SelectItem value="magalu">Magazine Luiza</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleFilter} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Filter className="mr-2 h-4 w-4" />
            )}
            Filtrar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Receita Total"
          value={data?.stats.totalRevenue.value ?? 0}
          change={data?.stats.totalRevenue.change ?? 0}
          icon={DollarSign}
          isLoading={isLoading}
          valueFormatter={formatCurrency}
        />
         <StatCard 
          title="Vendas"
          value={data?.stats.totalSales.value ?? 0}
          change={data?.stats.totalSales.change ?? 0}
          icon={ShoppingCart}
          isLoading={isLoading}
        />
        <StatCard 
          title="Ticket Médio"
          value={data?.stats.averageTicket.value ?? 0}
          change={data?.stats.averageTicket.change ?? 0}
          icon={DollarSign}
          isLoading={isLoading}
          valueFormatter={formatCurrency}
        />
        <StatCard 
          title="Novos Clientes"
          value={data?.stats.uniqueCustomers.value ?? 0}
          change={data?.stats.uniqueCustomers.change ?? 0}
          icon={Users}
          isLoading={isLoading}
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Ranking de Produtos</CardTitle>
              <CardDescription>Os 10 produtos que mais geraram receita no período.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
            {isLoading ? (
              <div className="h-[350px] w-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : data && data.topProducts.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                    <BarChart 
                      data={data?.topProducts}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatCurrency(value as number)}/>
                      <YAxis
                          type="category"
                          dataKey="name"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => value.length > 30 ? `${value.substring(0, 30)}...` : value}
                          width={200}
                      />
                      <Tooltip 
                        cursor={{ fill: 'hsl(var(--accent))' }}
                        content={<CustomTooltip />}
                      />
                      <Bar
                          dataKey="revenue"
                          fill="hsl(var(--primary))"
                          radius={[0, 4, 4, 0]}
                          barSize={30}
                      />
                    </BarChart>
                </ResponsiveContainer>
             ) : (
                <div className="h-[350px] w-full flex flex-col items-center justify-center text-center">
                    <p className="font-semibold">Nenhum dado de venda encontrado.</p>
                    <p className="text-muted-foreground text-sm">Tente selecionar outro período ou <a href="/api" className="text-primary underline">importe seus pedidos</a>.</p>
                </div>
            )}
            </CardContent>
        </Card>
        <Card className="lg:col-span-3">
            <CardHeader>
                <CardTitle>Vendas por Estado</CardTitle>
                <CardDescription>Faturamento total por estado (UF) no período.</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="h-[350px] w-full flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : data && data.salesByState.length > 0 ? (
                    <div className="w-full h-[350px] flex items-center justify-between">
                        <ResponsiveContainer width="50%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data.salesByState}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    outerRadius={120}
                                    fill="#8884d8"
                                    dataKey="revenue"
                                    nameKey="state"
                                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                                        const RADIAN = Math.PI / 180;
                                        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                        const x = cx + radius * Math.cos(-midAngle * RADIAN);
                                        const y = cy + radius * Math.sin(-midAngle * RADIAN);
                                        return (percent > 0.05) ? (
                                            <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12}>
                                                {`${(percent * 100).toFixed(0)}%`}
                                            </text>
                                        ) : null;
                                    }}
                                >
                                    {data.salesByState.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip content={<PieChartTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                        <CustomLegend payload={data.salesByState} totalRevenue={data.totalRevenue} />
                    </div>
                ) : (
                    <div className="h-[350px] w-full flex flex-col items-center justify-center text-center">
                        <p className="font-semibold">Nenhum dado de venda encontrado.</p>
                         <p className="text-muted-foreground text-sm">Não há informações de estado para exibir.</p>
                    </div>
                )}
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
