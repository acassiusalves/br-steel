import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/**
 * Parses a price string or number into a number, handling various pt-BR and en-US formats.
 * @param input The price string (e.g., "2.235,00", "22.35", "2,235.00") or number.
 * @returns The parsed number, or NaN if invalid.
 */
export function parsePriceToNumber(input?: string | number): number {
  if (input === undefined || input === null) return NaN;
  if (typeof input === 'number') return input;

  let s = String(input).trim();

  // Remove currency symbols/spaces, keeping only digits and separators
  s = s.replace(/[^\d.,]/g, '');

  if (!s) return NaN;

  // Case with both comma and dot: the LAST separator is decimal
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    
    // Assume comma is the decimal separator if it comes after the last dot
    if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        s = s.replace(/,/g, '');
    }
    return Number(s);
  }

  // Only comma: treat as decimal separator
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
    return Number(s);
  }

  return Number(s);
}

/**
 * Formats a number into a BRL currency string.
 * @param value The number to format.
 * @returns The formatted currency string (e.g., "R$ 1.234,56").
 */
export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * Formats a number into a clean percentage string.
 * It rounds numbers that are very close to an integer, but keeps one or two decimal places otherwise.
 * @param value The number to format (e.g., 15.99999 for 16%).
 * @returns The formatted percentage string.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0%';
  }
  // Check if the number is very close to an integer
  if (Math.abs(value - Math.round(value)) < 0.001) {
    return `${Math.round(value)}%`;
  }
  // Otherwise, format to 2 decimal places if needed, or keep it clean
  return `${Number(value.toFixed(2))}%`;
}


// Legacy formatCurrency, kept for compatibility, but new code should use formatBRL
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export const getShippingCostFor1To2Kg = (price: number): number | null => {
    if (price >= 200) return 28.14;
    if (price >= 150) return 25.80;
    if (price >= 120) return 23.45;
    if (price >= 100) return 21.11;
    if (price >= 79) return 18.76;
    return null;
};

export function formatRelativeTime(date: string | Date) {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return 'data inválida';
    
    return formatDistanceToNowStrict(dateObj, {
      addSuffix: true,
      locale: ptBR,
    });
  } catch {
    return 'data inválida';
  }
}
