
'use client';

import * as React from 'react';
import {
  Calendar as CalendarIcon,
  Filter,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProductionDemand } from '@/app/actions';
import type { ProductionDemand } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';


export default function ProducaoPage() {
  const [demand, setDemand] = React.useState<ProductionDemand[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [date, setDate] = React.useState<DateRange | undefined>(undefined);
  const { toast } = useToast();
  
  const fetchData = React.useCallback(async (currentDate: DateRange | undefined) => {
    setIsLoading(true);
    try {
      if (!currentDate?.from || !currentDate?.to) {
        toast({
          variant: "destructive",
          title: "Período Inválido",
          description: "Por favor, selecione uma data de início e fim.",
        });
        setDemand([]);
        return;
      }
      const data = await getProductionDemand({ from: currentDate.from, to: currentDate.to });
      setDemand(data);
    } catch (error) {
      console.error("Failed to fetch production demand:", error);
      toast({
        variant: "destructive",
        title: "Erro ao Buscar Dados",
        description: "Não foi possível carregar a demanda de produção.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    const today = new Date();
    const initialDate = {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: today,
    };
    setDate(initialDate);
    fetchData(initialDate);
  }, [fetchData]);

  const handleFilter = () => {
    if (!date) {
        toast({
            variant: "destructive",
            title: "Período não selecionado",
            description: "Por favor, escolha um período para filtrar.",
        });
        return;
    }
    fetchData(date);
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Análise para Produção</h2>
                <p className="text-muted-foreground">
                    Demanda de produtos baseada em vendas com Nota Fiscal emitida no período.
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
        <Card>
          <CardHeader>
            <CardTitle>Demanda por SKU</CardTitle>
            <CardDescription>
              A lista abaixo mostra a quantidade total de cada produto vendido em pedidos que já tiveram a nota fiscal gerada no período selecionado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Descrição do Produto</TableHead>
                  <TableHead className="text-right">Quantidade Vendida (com NF)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : demand.length > 0 ? (
                  demand.map((item) => (
                    <TableRow key={item.sku}>
                      <TableCell className="font-medium">{item.sku}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right font-bold">{item.quantity}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      Nenhum item vendido com nota fiscal encontrada para o período.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
