import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatRelative(date: Date): string {
  return formatDistanceToNow(date, { locale: ptBR, addSuffix: true });
}

export function formatDateTime(date: Date): string {
  return format(date, "dd 'de' MMM 'às' HH:mm", { locale: ptBR });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatUsd(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return '—';
  if (num === 0) return '$0,00';
  // Modelos baratos podem dar custos <$0,0001 — mostrar mais casas para o valor
  // ainda ser legível em vez de virar '<$0,01' (que escondia a informação).
  const abs = Math.abs(num);
  const decimals = abs < 0.0001 ? 6 : abs < 1 ? 4 : 2;
  return `$${num.toFixed(decimals).replace('.', ',')}`;
}
