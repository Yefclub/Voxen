import { formatDistanceToNow, format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { ptBR } from 'date-fns/locale';
import type { Locale } from './i18n';

function dateLocale(locale: Locale): typeof ptBR {
  return locale === 'en' ? enUS : ptBR;
}

export function formatRelative(date: Date, locale: Locale = 'pt-BR'): string {
  return formatDistanceToNow(date, { locale: dateLocale(locale), addSuffix: true });
}

export function formatDateTime(date: Date, locale: Locale = 'pt-BR'): string {
  const pattern = locale === 'en' ? "MMM d 'at' HH:mm" : "dd 'de' MMM 'às' HH:mm";
  return format(date, pattern, { locale: dateLocale(locale) });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatUsd(
  amount: number | string | null | undefined,
  locale: Locale = 'pt-BR',
): string {
  if (amount === null || amount === undefined) return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return '—';
  if (num === 0) return locale === 'en' ? '$0.00' : '$0,00';
  // Modelos baratos podem dar custos <$0,0001 — mostrar mais casas para o valor
  // ainda ser legível em vez de virar '<$0,01' (que escondia a informação).
  const abs = Math.abs(num);
  const decimals = abs < 0.0001 ? 6 : abs < 1 ? 4 : 2;
  const value = num.toFixed(decimals);
  return `$${locale === 'en' ? value : value.replace('.', ',')}`;
}
