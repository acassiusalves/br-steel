/* ============================================
   DATE RANGE PICKER V2 - INSPIRADO NO GOOGLE ADS
   Seletor de intervalo de datas com presets
   ============================================ */

"use client"

import * as React from "react"
import { format, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui-v2/button"
import { Calendar } from "@/components/ui-v2/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui-v2/popover"

interface DateRangePickerProps extends React.ComponentProps<"div"> {
    date: DateRange | undefined;
    onDateChange: (date: DateRange | undefined) => void;
}

export function DateRangePicker({
  className,
  date,
  onDateChange
}: DateRangePickerProps) {

  const handlePresetClick = (preset: 'today' | 'yesterday' | 'todayAndYesterday' | 'last7' | 'last14' | 'last28' | 'last30' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'max') => {
    const today = new Date();
    let fromDate: Date;
    let toDate: Date = endOfDay(today);

    switch (preset) {
        case 'today':
            fromDate = startOfDay(today);
            break;
        case 'yesterday':
            fromDate = startOfDay(subDays(today, 1));
            toDate = endOfDay(subDays(today, 1));
            break;
        case 'todayAndYesterday':
            fromDate = startOfDay(subDays(today, 1));
            toDate = endOfDay(today);
            break;
        case 'last7':
            fromDate = startOfDay(subDays(today, 6));
            break;
        case 'last14':
            fromDate = startOfDay(subDays(today, 13));
            break;
        case 'last28':
            fromDate = startOfDay(subDays(today, 27));
            break;
        case 'last30':
            fromDate = startOfDay(subDays(today, 29));
            break;
        case 'thisWeek':
            fromDate = startOfWeek(today, { locale: ptBR });
            toDate = endOfWeek(today, { locale: ptBR });
            break;
        case 'lastWeek':
            const lastWeek = subWeeks(today, 1);
            fromDate = startOfWeek(lastWeek, { locale: ptBR });
            toDate = endOfWeek(lastWeek, { locale: ptBR });
            break;
        case 'thisMonth':
            fromDate = startOfMonth(today);
            toDate = endOfMonth(today);
            break;
        case 'lastMonth':
            const lastMonth = subMonths(today, 1);
            fromDate = startOfMonth(lastMonth);
            toDate = endOfMonth(lastMonth);
            break;
        case 'max':
            // Definir uma data muito antiga para pegar todos os dados
            fromDate = new Date(2020, 0, 1); // 01/01/2020
            toDate = endOfDay(today);
            break;
    }
    onDateChange({ from: fromDate, to: toDate });
  };


  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[300px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "dd/MM/yyyy", { locale: ptBR })} -{" "}
                  {format(date.to, "dd/MM/yyyy", { locale: ptBR })}
                </>
              ) : (
                format(date.from, "dd/MM/yyyy", { locale: ptBR })
              )
            ) : (
              <span>Selecione um período</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto p-0" align="start">
          <div className="flex flex-col border-r p-4">
              <span className="text-sm font-medium mb-2">Usados recentemente</span>
              <div className="flex flex-col space-y-2 overflow-y-auto max-h-[400px] pr-2">
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('today')}>Hoje</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('yesterday')}>Ontem</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('todayAndYesterday')}>Hoje e ontem</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('last7')}>Últimos 7 dias</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('last14')}>Últimos 14 dias</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('last28')}>Últimos 28 dias</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('last30')}>Últimos 30 dias</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('thisWeek')}>Esta semana</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('lastWeek')}>Semana passada</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('thisMonth')}>Este mês</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('lastMonth')}>Mês passado</Button>
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetClick('max')}>Máximo</Button>
              </div>
          </div>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={onDateChange}
            numberOfMonths={2}
            locale={ptBR}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
