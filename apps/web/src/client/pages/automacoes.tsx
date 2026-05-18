import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Workflow,
  Plus,
  Play,
  Pencil,
  Trash2,
  Pause,
  X,
  Clock,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from '../components/ui/markdown';
import { Button } from '../components/ui/button';

type AutomationType = 'PERIODIC_SUMMARY' | 'WEB_RESEARCH';
type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type Delivery = 'IN_APP' | 'TELEGRAM' | 'BOTH';
type Status = 'ACTIVE' | 'PAUSED';
type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

interface Automation {
  id: string;
  name: string;
  type: AutomationType;
  prompt: string;
  frequency: Frequency;
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  delivery: Delivery;
  status: Status;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastRun: { id: string; status: RunStatus; finishedAt: string | null } | null;
  createdAt: string;
}

interface Run {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  outputMd: string | null;
  errorMessage: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  noteId: string | null;
  telegramSent: boolean;
  triggeredBy: string;
  createdAt: string;
}

const TYPE_LABELS: Record<AutomationType, string> = {
  PERIODIC_SUMMARY: 'Resumo periódico',
  WEB_RESEARCH: 'Pesquisa web → nota',
};

const FREQ_LABELS: Record<Frequency, string> = {
  DAILY: 'Diária',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
};

const DAYS_OF_WEEK = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const PROMPT_PLACEHOLDERS: Record<AutomationType, string> = {
  PERIODIC_SUMMARY:
    'Liste e resuma todas as transcrições e notas que criei nos últimos 7 dias. Destaque temas recorrentes, insights principais e tópicos pra aprofundar.',
  WEB_RESEARCH:
    'Pesquise na web sobre <coloque seu tópico aqui>. Crie uma nota com: principais achados, links úteis, tópicos pra aprofundar.',
};

export function AutomacoesPage(): React.ReactElement {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [hasTelegram, setHasTelegram] = useState<boolean>(false);
  const [runViewer, setRunViewer] = useState<{ automation: Automation; runs: Run[] } | null>(null);

  const fetchAutomations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/automations', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { automations: Automation[] };
      setAutomations(data.automations);
    } catch (err) {
      toast.error('Falha ao carregar automações.', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAutomations();
    // Detecta telegram via /api/account/telegram-link (existente)
    fetch('/api/account/telegram', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { linked?: boolean }) => setHasTelegram(!!d.linked))
      .catch(() => setHasTelegram(false));
  }, [fetchAutomations]);

  async function runNow(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/automations/${id}/run`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Execução enfileirada.', {
        description: 'Em até 1 min a Vox processa essa automação. Atualize a página pra ver o resultado.',
      });
      await fetchAutomations();
    } catch (err) {
      toast.error('Falha ao disparar.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function togglePause(a: Automation): Promise<void> {
    try {
      const res = await fetch(`/api/automations/${a.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAutomations();
    } catch (err) {
      toast.error('Falha ao atualizar status.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function remove(a: Automation): Promise<void> {
    if (!confirm(`Apagar a automação "${a.name}"? Histórico de execuções também será removido.`)) return;
    try {
      const res = await fetch(`/api/automations/${a.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Automação removida.');
      await fetchAutomations();
    } catch (err) {
      toast.error('Falha ao remover.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function openRuns(a: Automation): Promise<void> {
    try {
      const res = await fetch(`/api/automations/${a.id}/runs?limit=20`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { runs: Run[] };
      setRunViewer({ automation: a, runs: data.runs });
    } catch (err) {
      toast.error('Falha ao listar execuções.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-5xl mx-auto px-6 py-8 space-y-6"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center ring-1 ring-zinc-200 dark:ring-zinc-800">
            <Workflow className="size-5 text-zinc-700 dark:text-zinc-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Automações</h1>
            <p className="text-sm text-zinc-500">
              Jobs periódicos que a Vox executa pra você em background.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4 mr-1.5" />
          Nova automação
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-zinc-500 text-sm">
          <Loader2 className="size-4 animate-spin mx-auto mb-2" />
          Carregando…
        </div>
      ) : automations.length === 0 ? (
        <EmptyState onCreate={() => setFormOpen(true)} />
      ) : (
        <div className="grid gap-3">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              onRunNow={() => runNow(a.id)}
              onEdit={() => {
                setEditing(a);
                setFormOpen(true);
              }}
              onTogglePause={() => togglePause(a)}
              onDelete={() => remove(a)}
              onOpenRuns={() => openRuns(a)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <AutomationForm
            initial={editing}
            hasTelegram={hasTelegram}
            onClose={() => {
              setFormOpen(false);
              setEditing(null);
            }}
            onSaved={async () => {
              setFormOpen(false);
              setEditing(null);
              await fetchAutomations();
            }}
          />
        )}
        {runViewer && (
          <RunsModal
            automation={runViewer.automation}
            runs={runViewer.runs}
            onClose={() => setRunViewer(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 p-12 text-center">
      <Workflow className="size-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
      <h2 className="text-base font-medium text-zinc-800 dark:text-zinc-200 mb-1">
        Sem automações ainda
      </h2>
      <p className="text-sm text-zinc-500 mb-4 max-w-md mx-auto">
        Configure jobs periódicos: resumos semanais do que você consumiu, pesquisas web automáticas
        em temas de interesse, ou notificações no Telegram quando algo importante for produzido.
      </p>
      <Button onClick={onCreate}>
        <Plus className="size-4 mr-1.5" />
        Criar primeira automação
      </Button>
    </div>
  );
}

function AutomationCard({
  automation,
  onRunNow,
  onEdit,
  onTogglePause,
  onDelete,
  onOpenRuns,
}: {
  automation: Automation;
  onRunNow: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
  onOpenRuns: () => void;
}): React.ReactElement {
  const a = automation;
  const freqLabel = useMemo(() => formatFrequency(a), [a]);
  const nextLabel = a.nextRunAt
    ? new Date(a.nextRunAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const lastBadge = a.lastRun ? <RunStatusBadge status={a.lastRun.status} /> : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border bg-white dark:bg-zinc-950 p-4 ${
        a.status === 'PAUSED'
          ? 'border-zinc-200 dark:border-zinc-800 opacity-70'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{a.name}</h3>
            <span className="text-[11px] uppercase tracking-wide font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded">
              {TYPE_LABELS[a.type]}
            </span>
            {a.status === 'PAUSED' && (
              <span className="text-[11px] uppercase tracking-wide font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                pausada
              </span>
            )}
            {(a.delivery === 'TELEGRAM' || a.delivery === 'BOTH') && (
              <span className="text-[11px] flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 rounded">
                <Send className="size-3" />
                Telegram
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {freqLabel}
            </span>
            <span>·</span>
            <span>Próxima: {nextLabel}</span>
            {a.runCount > 0 && (
              <>
                <span>·</span>
                <button
                  onClick={onOpenRuns}
                  className="underline-offset-2 hover:underline cursor-pointer"
                >
                  {a.runCount} execuç{a.runCount === 1 ? 'ão' : 'ões'}
                </button>
                {lastBadge}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton onClick={onRunNow} title="Rodar agora">
            <Play className="size-4" />
          </IconButton>
          <IconButton onClick={onTogglePause} title={a.status === 'ACTIVE' ? 'Pausar' : 'Retomar'}>
            {a.status === 'ACTIVE' ? <Pause className="size-4" /> : <Play className="size-4" />}
          </IconButton>
          <IconButton onClick={onEdit} title="Editar">
            <Pencil className="size-4" />
          </IconButton>
          <IconButton onClick={onDelete} title="Apagar" danger>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
    </motion.div>
  );
}

function IconButton({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`size-8 rounded-lg flex items-center justify-center transition-colors ${
        danger
          ? 'text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40'
          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
      }`}
    >
      {children}
    </button>
  );
}

function RunStatusBadge({ status }: { status: RunStatus }): React.ReactElement {
  const map: Record<RunStatus, { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
    PENDING: { label: 'pendente', cls: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-900', Icon: Clock },
    RUNNING: {
      label: 'rodando',
      cls: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40',
      Icon: Loader2,
    },
    SUCCESS: {
      label: 'ok',
      cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40',
      Icon: CheckCircle2,
    },
    FAILED: {
      label: 'falhou',
      cls: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40',
      Icon: AlertCircle,
    },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      <Icon className={`size-3 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

function formatFrequency(a: Automation): string {
  const hh = String(a.hour).padStart(2, '0');
  const mm = String(a.minute).padStart(2, '0');
  if (a.frequency === 'DAILY') return `Todo dia às ${hh}:${mm}`;
  if (a.frequency === 'WEEKLY') {
    const dow = a.dayOfWeek ?? 0;
    const dayName = DAYS_OF_WEEK[dow] ?? 'Segunda';
    return `Toda ${dayName.toLowerCase()} às ${hh}:${mm}`;
  }
  return `Todo dia ${a.dayOfMonth ?? 1} do mês às ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Form (create + edit)
// ---------------------------------------------------------------------------

function AutomationForm({
  initial,
  hasTelegram,
  onClose,
  onSaved,
}: {
  initial: Automation | null;
  hasTelegram: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const isEdit = initial != null;
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AutomationType>(initial?.type ?? 'PERIODIC_SUMMARY');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'WEEKLY');
  const [hour, setHour] = useState(initial?.hour ?? 9);
  const [minute, setMinute] = useState(initial?.minute ?? 0);
  const [dayOfWeek, setDayOfWeek] = useState<number>(initial?.dayOfWeek ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState<number>(initial?.dayOfMonth ?? 1);
  const [delivery, setDelivery] = useState<Delivery>(initial?.delivery ?? 'IN_APP');
  const [submitting, setSubmitting] = useState(false);

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
    } catch {
      return 'America/Sao_Paulo';
    }
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) {
      toast.error('Nome e prompt são obrigatórios.');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        type,
        prompt: prompt.trim(),
        frequency,
        hour,
        minute,
        dayOfWeek: frequency === 'WEEKLY' ? dayOfWeek : null,
        dayOfMonth: frequency === 'MONTHLY' ? dayOfMonth : null,
        timezone,
        delivery,
      };
      const url = isEdit ? `/api/automations/${initial.id}` : '/api/automations';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(isEdit ? 'Automação atualizada.' : 'Automação criada.');
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar.', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between sticky top-0 bg-white dark:bg-zinc-950">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
            {isEdit ? 'Editar automação' : 'Nova automação'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <Field label="Nome">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Resumo semanal das transcrições"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              maxLength={120}
              required
            />
          </Field>

          <Field label="Tipo">
            <div className="grid grid-cols-2 gap-2">
              {(['PERIODIC_SUMMARY', 'WEB_RESEARCH'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t);
                    if (!prompt.trim()) setPrompt(PROMPT_PLACEHOLDERS[t]);
                  }}
                  className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                    type === t
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-200'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="font-medium">{TYPE_LABELS[t]}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {t === 'PERIODIC_SUMMARY'
                      ? 'Sintetiza transcrições/notas recentes'
                      : 'Busca web e cria nota'}
                  </div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Prompt (o que a Vox deve fazer)">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={PROMPT_PLACEHOLDERS[type]}
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              maxLength={4000}
              required
            />
          </Field>

          <Field label="Frequência">
            <div className="flex gap-2">
              {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    frequency === f
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-200'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  {FREQ_LABELS[f]}
                </button>
              ))}
            </div>
          </Field>

          {frequency === 'WEEKLY' && (
            <Field label="Dia da semana">
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
              >
                {DAYS_OF_WEEK.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {frequency === 'MONTHLY' && (
            <Field label="Dia do mês (1-31)">
              <input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Em meses com menos dias, ajusta automaticamente pro último dia.
              </p>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hora">
              <input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
              />
            </Field>
            <Field label="Minuto">
              <input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
              />
            </Field>
          </div>

          <Field label="Entrega">
            <div className="space-y-1.5">
              {(
                [
                  { v: 'IN_APP' as const, label: 'Aparece em /automacoes (padrão)', requiresTg: false },
                  { v: 'TELEGRAM' as const, label: 'Envia pro meu Telegram', requiresTg: true },
                  { v: 'BOTH' as const, label: 'Ambos', requiresTg: true },
                ]
              ).map((opt) => {
                const disabled = opt.requiresTg && !hasTelegram;
                return (
                  <label
                    key={opt.v}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${
                      delivery === opt.v
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40'
                        : 'border-zinc-200 dark:border-zinc-800'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                    title={disabled ? 'Vincule o Telegram em /conta primeiro' : ''}
                  >
                    <input
                      type="radio"
                      name="delivery"
                      checked={delivery === opt.v}
                      onChange={() => !disabled && setDelivery(opt.v)}
                      disabled={disabled}
                      className="accent-violet-600"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </Field>

          <div className="text-[11px] text-zinc-500">Timezone: {timezone}</div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2 sticky bottom-0 bg-white dark:bg-zinc-950">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            {isEdit ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Runs viewer modal
// ---------------------------------------------------------------------------

function RunsModal({
  automation,
  runs,
  onClose,
}: {
  automation: Automation;
  runs: Run[];
  onClose: () => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(runs[0]?.id ?? null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{automation.name}</h2>
            <p className="text-xs text-zinc-500">Execuções recentes</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              Nenhuma execução ainda. Use "Rodar agora" pra disparar manualmente.
            </div>
          ) : (
            runs.map((r) => {
              const ts = r.startedAt ?? r.createdAt;
              const isOpen = expanded === r.id;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <RunStatusBadge status={r.status} />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {new Date(ts).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      {r.triggeredBy === 'manual' && (
                        <span className="text-[10px] uppercase text-zinc-500">manual</span>
                      )}
                      {r.telegramSent && (
                        <span className="text-[10px] flex items-center gap-1 text-sky-700 dark:text-sky-400">
                          <Send className="size-3" />
                          enviado
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-500">
                      ${parseFloat(r.costUsd).toFixed(4)}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 bg-zinc-50/50 dark:bg-zinc-900/30">
                      {r.status === 'FAILED' && r.errorMessage && (
                        <div className="text-sm text-rose-700 dark:text-rose-300 mb-2">
                          ⚠️ {r.errorMessage}
                        </div>
                      )}
                      {r.outputMd ? (
                        <Markdown>{r.outputMd}</Markdown>
                      ) : (
                        <div className="text-sm text-zinc-500 italic">
                          {r.status === 'PENDING' || r.status === 'RUNNING'
                            ? 'Aguardando processamento…'
                            : 'Sem output.'}
                        </div>
                      )}
                      {r.noteId && (
                        <div className="mt-3 text-xs text-zinc-500">
                          📄 Nota criada:{' '}
                          <a
                            href={`/notas/${r.noteId}`}
                            className="text-violet-700 dark:text-violet-300 hover:underline"
                          >
                            abrir
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
