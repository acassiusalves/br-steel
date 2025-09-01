
"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar as CalendarIcon,
  DollarSign,
  Filter,
  ShoppingCart,
  Users,
  Loader2,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { format } from "date-fns";
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


export default function SalesDashboard() {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: new Date(new Date().getFullYear(), 0, 1),
    to: new Date(),
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
  
  React.useEffect(() => {
    fetchData(date);
  }, []); // Fetch on initial load
  
  const handleFilter = () => {
    fetchData(date);
  };


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
              <PopoverContent className="w-auto p-0" align="end">
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
        <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>Visão Geral das Vendas</CardTitle>
              <CardDescription>Receita mensal no período selecionado.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
            {isLoading ? (
              <div className="h-[350px] w-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : data && data.monthlyRevenue.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={data?.monthlyRevenue}>
                      <XAxis
                          dataKey="name"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                      />
                      <YAxis
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => formatCurrency(Number(value))}
                      />
                      <Tooltip 
                        cursor={{ fill: 'hsl(var(--accent))' }}
                        contentStyle={{
                          background: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 'var(--radius)',
                        }}
                        formatter={(value) => [formatCurrency(Number(value)), "Receita"]}
                      />
                      <Bar
                          dataKey="total"
                          fill="hsl(var(--primary))"
                          radius={[4, 4, 0, 0]}
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
        <Card className="lg:col-span-2">
            <CardHeader>
                <CardTitle>Importar e Exportar</CardTitle>
                <CardDescription>
                Gerencie seus dados de vendas.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <Button disabled className="w-full"><ArrowUpFromLine className="mr-2 h-4 w-4" />Importar CSV</Button>
                <Button disabled variant="secondary" className="w-full"><ArrowDownToLine className="mr-2 h-4 w-4" />Exportar Excel</Button>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
