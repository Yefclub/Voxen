import { useState } from 'react';
import { DollarSign, LineChart, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { useFetch } from '../lib/hooks';
import { formatUsd } from '../lib/format';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';

interface CostResponse {
  summary: {
    month: { total: string; events: number };
    last30d: { total: string; events: number };
    allTime: { total: string; events: number };
  };
  range: 'month' | 'all';
  byModel: { model: string; total: string; events: number; tokens: number }[];
  byUser: {
    userId: string;
    email: string | null;
    name: string | null;
    total: string;
    events: number;
  }[];
  byKind: { kind: string; total: string; events: number }[];
  daily: { day: string; total: string }[];
}

export function AdminCustosPage(): React.ReactElement {
  const [range, setRange] = useState<'month' | 'all'>('month');
  const { data, loading } = useFetch<CostResponse>(`/api/admin/custos?range=${range}`);

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Administração
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Custos</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Quanto a instância está gastando com chat, transcrição e análise via OpenRouter.
          </p>
        </header>

        {/* Cards de resumo */}
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StaggerItem>
            <SummaryCard
              label="Mês atual"
              value={data?.summary.month.total ?? null}
              events={data?.summary.month.events ?? null}
              accent="emerald"
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryCard
              label="Últimos 30 dias"
              value={data?.summary.last30d.total ?? null}
              events={data?.summary.last30d.events ?? null}
              accent="violet"
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryCard
              label="Desde sempre"
              value={data?.summary.allTime.total ?? null}
              events={data?.summary.allTime.events ?? null}
              accent="amber"
            />
          </StaggerItem>
        </StaggerContainer>

        {/* Switcher de range */}
        <div className="flex items-center gap-2 -mb-4">
          <span className="text-xs uppercase tracking-wider text-[var(--color-app-muted)]">
            Detalhar por
          </span>
          <RangeChip active={range === 'month'} onClick={() => setRange('month')}>
            Este mês
          </RangeChip>
          <RangeChip active={range === 'all'} onClick={() => setRange('all')}>
            Histórico completo
          </RangeChip>
        </div>

        {/* Gráfico simples (últimos 30 dias) */}
        <Card elevated>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-2 mb-4">
              <LineChart className="h-3.5 w-3.5 text-violet-400" />
              <h2 className="text-sm font-semibold tracking-tight text-zinc-200">
                Últimos 30 dias
              </h2>
            </div>
            {loading || !data ? (
              <Skeleton className="h-32 w-full" />
            ) : data.daily.length === 0 ? (
              <p className="text-sm text-[var(--color-app-muted)] py-8 text-center">
                Sem gastos no período.
              </p>
            ) : (
              <DailyChart points={data.daily} />
            )}
          </CardContent>
        </Card>

        {/* Por modelo */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Por modelo</h2>
          {loading || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : data.byModel.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[var(--color-app-muted)]">
                Nada por aqui ainda.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {data.byModel.map((m) => (
                  <li key={m.model} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono text-zinc-200 truncate">{m.model}</p>
                      <p className="text-xs text-[var(--color-app-muted)] mt-0.5 tabular-nums">
                        {m.events} {m.events === 1 ? 'chamada' : 'chamadas'}
                        {m.tokens > 0 && ` · ${m.tokens.toLocaleString('pt-BR')} tokens`}
                      </p>
                    </div>
                    <span className="text-base font-display font-semibold tabular-nums">
                      {formatUsd(m.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        {/* Por uso */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Por uso</h2>
          {loading || !data ? (
            <Skeleton className="h-28 w-full" />
          ) : data.byKind.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[var(--color-app-muted)]">
                Nada por aqui ainda.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {data.byKind.map((k) => (
                  <li key={k.kind} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{kindLabel(k.kind)}</p>
                      <p className="text-xs text-[var(--color-app-muted)] mt-0.5 tabular-nums">
                        {k.events} {k.events === 1 ? 'evento' : 'eventos'}
                      </p>
                    </div>
                    <span className="text-base font-display font-semibold tabular-nums">
                      {formatUsd(k.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        {/* Por user */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Por usuário</h2>
          {loading || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : data.byUser.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[var(--color-app-muted)]">
                Nada por aqui ainda.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {data.byUser.map((u) => (
                  <li key={u.userId} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{u.name ?? '— removido —'}</p>
                      <p className="text-xs text-[var(--color-app-muted)] mt-0.5 tabular-nums">
                        {u.email ?? 'sem email'} · {u.events}{' '}
                        {u.events === 1 ? 'evento' : 'eventos'}
                      </p>
                    </div>
                    <span className="text-base font-display font-semibold tabular-nums">
                      {formatUsd(u.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </AnimatedPage>
  );
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    CHAT: 'Chat',
    TRANSCRIBE: 'Transcrição',
    DOCUMENT: 'Documentos',
    X_SEARCH: 'Análise do X',
    EMBED: 'Embeddings',
  };
  return labels[kind] ?? kind;
}

function SummaryCard({
  label,
  value,
  events,
  accent,
}: {
  label: string;
  value: string | null;
  events: number | null;
  accent: 'emerald' | 'violet' | 'amber';
}): React.ReactElement {
  const colors = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  } as const;
  return (
    <Card hoverable elevated>
      <CardContent className="pt-6 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
              {label}
            </p>
            {value === null ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <p className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums leading-none">
                {formatUsd(value)}
              </p>
            )}
            <p className="text-[11px] text-[var(--color-app-muted)] tabular-nums">
              {events ?? 0} {events === 1 ? 'cobrança' : 'cobranças'}
            </p>
          </div>
          <div
            className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${colors[accent]}`}
          >
            <DollarSign className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RangeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'px-3 h-7 rounded-md text-xs font-medium bg-zinc-100 text-zinc-900'
          : 'px-3 h-7 rounded-md text-xs font-medium text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors'
      }
    >
      {children}
    </button>
  );
}

function DailyChart({ points }: { points: { day: string; total: string }[] }): React.ReactElement {
  const values = points.map((p) => Number(p.total));
  const max = Math.max(...values, 0.0001);
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1 h-32">
        {points.map((p, i) => {
          const v = Number(p.total);
          const h = Math.max(2, (v / max) * 100);
          return (
            <motion.div
              key={p.day}
              initial={{ height: 0 }}
              animate={{ height: `${h}%` }}
              transition={{ delay: i * 0.02, type: 'spring', stiffness: 220, damping: 24 }}
              className="flex-1 rounded-sm bg-gradient-to-t from-violet-500/40 to-emerald-500/40 border-t border-emerald-400/40"
              title={`${p.day} · ${formatUsd(p.total)}`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] text-[var(--color-app-muted)] tabular-nums">
        <span>{points[0]?.day}</span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </div>
  );
}
