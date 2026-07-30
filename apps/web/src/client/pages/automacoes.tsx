import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Workflow,
  Plus,
  Play,
  Pencil,
  Trash2,
  Pause,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Markdown } from '../components/ui/markdown';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';

/**
 * Trava o scroll do body enquanto `active` for true — paridade com o `Dialog`
 * do shadcn (Radix) para os modais próprios desta página, evitando que o fundo
 * role atrás. Restaura o valor anterior ao desmontar/fechar.
 */
type AutomationType = 'PERIODIC_SUMMARY' | 'WEB_RESEARCH';
type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type Delivery = 'IN_APP';
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

export function AutomacoesPage(): React.ReactElement {
  const { locale, t } = useI18n();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [runViewer, setRunViewer] = useState<{ automation: Automation; runs: Run[] } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);

  const fetchAutomations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/automations', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { automations: Automation[] };
      setAutomations(data.automations);
    } catch (err) {
      toast.error(t('automations.fetchError'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchAutomations();
  }, [fetchAutomations]);

  async function runNow(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/automations/${id}/run`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t('automations.runQueued'), {
        description: t('automations.runQueuedDescription'),
      });
      await fetchAutomations();
    } catch (err) {
      toast.error(t('automations.runError'), {
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
      toast.error(t('automations.statusError'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function confirmRemove(a: Automation): Promise<void> {
    try {
      const res = await fetch(`/api/automations/${a.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t('automations.removed'));
      await fetchAutomations();
    } catch (err) {
      toast.error(t('automations.removeError'), {
        description: err instanceof Error ? err.message : undefined,
      });
      throw err;
    }
  }

  async function openRuns(a: Automation): Promise<void> {
    try {
      const res = await fetch(`/api/automations/${a.id}/runs?limit=20`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { runs: Run[] };
      setRunViewer({ automation: a, runs: data.runs });
    } catch (err) {
      toast.error(t('automations.runsError'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title={t('automations.title')}
        description={t('automations.description')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-1.5 size-4" />
            {t('automations.new')}
          </Button>
        }
      />

      {loading ? (
        <div className="py-12 text-center text-[var(--color-app-muted)] text-sm">
          <Loader2 className="size-4 animate-spin mx-auto mb-2" />
          {t('automations.loading')}
        </div>
      ) : automations.length === 0 ? (
        <EmptyState onCreate={() => setFormOpen(true)} t={t} />
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
              onDelete={() => setPendingDelete(a)}
              onOpenRuns={() => openRuns(a)}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <AutomationForm
          initial={editing}
          t={t}
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
          locale={locale}
          t={t}
          onClose={() => setRunViewer(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('automations.deleteTitle')}
        description={
          pendingDelete ? t('automations.deleteConfirm', { name: pendingDelete.name }) : undefined
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (pendingDelete) await confirmRemove(pendingDelete);
        }}
      />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function EmptyState({ onCreate, t }: { onCreate: () => void; t: TranslateFn }): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-app-border)] p-12 text-center">
      <Workflow className="size-10 text-[var(--color-app-muted)] mx-auto mb-3" />
      <h2 className="text-base font-medium text-[var(--color-app-subtle)] mb-1">
        {t('automations.emptyTitle')}
      </h2>
      <p className="text-sm text-[var(--color-app-muted)] mb-4 max-w-md mx-auto">
        {t('automations.emptyDescription')}
      </p>
      <Button onClick={onCreate}>
        <Plus className="size-4 mr-1.5" />
        {t('automations.createFirst')}
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
  locale,
  t,
}: {
  automation: Automation;
  onRunNow: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
  onOpenRuns: () => void;
  locale: Locale;
  t: TranslateFn;
}): React.ReactElement {
  const a = automation;
  const freqLabel = useMemo(() => formatFrequency(a, locale, t), [a, locale, t]);
  const nextLabel = a.nextRunAt
    ? new Date(a.nextRunAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const lastBadge = a.lastRun ? <RunStatusBadge status={a.lastRun.status} t={t} /> : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-4 ${
        a.status === 'PAUSED' ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-[var(--color-app-fg)] truncate">{a.name}</h3>
            <span className="text-[11px] uppercase tracking-wide font-medium text-[var(--color-app-muted)] bg-[var(--color-app-bg-elevated)] px-1.5 py-0.5 rounded">
              {typeLabel(a.type, t)}
            </span>
            {a.status === 'PAUSED' && (
              <span className="text-[11px] uppercase tracking-wide font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                {t('automations.paused')}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-app-muted)] flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {freqLabel}
            </span>
            <span>·</span>
            <span>{t('automations.next', { date: nextLabel })}</span>
            {a.runCount > 0 && (
              <>
                <span>·</span>
                <button
                  onClick={onOpenRuns}
                  className="underline-offset-2 hover:underline cursor-pointer"
                >
                  {t(
                    a.runCount === 1
                      ? 'automations.runCountSingular'
                      : 'automations.runCountPlural',
                    { count: a.runCount },
                  )}
                </button>
                {lastBadge}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton onClick={onRunNow} title={t('automations.runNow')}>
            <Play className="size-4" />
          </IconButton>
          <IconButton
            onClick={onTogglePause}
            title={a.status === 'ACTIVE' ? t('automations.pause') : t('automations.resume')}
          >
            {a.status === 'ACTIVE' ? <Pause className="size-4" /> : <Play className="size-4" />}
          </IconButton>
          <IconButton onClick={onEdit} title={t('notes.edit')}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton onClick={onDelete} title={t('common.delete')} danger>
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
          ? 'text-[var(--color-app-muted)] hover:text-rose-400 hover:bg-rose-500/10'
          : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface-hover)]'
      }`}
    >
      {children}
    </button>
  );
}

function RunStatusBadge({ status, t }: { status: RunStatus; t: TranslateFn }): React.ReactElement {
  const map: Record<
    RunStatus,
    { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    PENDING: {
      label: t('automations.runStatus.pending'),
      cls: 'text-[var(--color-app-muted)] bg-[var(--color-app-bg-elevated)]',
      Icon: Clock,
    },
    RUNNING: {
      label: t('automations.runStatus.running'),
      cls: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40',
      Icon: Loader2,
    },
    SUCCESS: {
      label: t('automations.runStatus.success'),
      cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40',
      Icon: CheckCircle2,
    },
    FAILED: {
      label: t('automations.runStatus.failed'),
      cls: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40',
      Icon: AlertCircle,
    },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${cls}`}
    >
      <Icon className={`size-3 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

function formatFrequency(a: Automation, locale: Locale, t: TranslateFn): string {
  const hh = String(a.hour).padStart(2, '0');
  const mm = String(a.minute).padStart(2, '0');
  if (a.frequency === 'DAILY') return t('automations.frequency.dailyAt', { time: `${hh}:${mm}` });
  if (a.frequency === 'WEEKLY') {
    const dow = a.dayOfWeek ?? 0;
    const dayName = dayLabels(t)[dow] ?? t('automations.day.monday');
    return t('automations.frequency.weeklyAt', {
      day: locale === 'pt-BR' ? dayName.toLowerCase() : dayName,
      time: `${hh}:${mm}`,
    });
  }
  return t('automations.frequency.monthlyAt', { day: a.dayOfMonth ?? 1, time: `${hh}:${mm}` });
}

function typeLabel(type: AutomationType, t: TranslateFn): string {
  return type === 'PERIODIC_SUMMARY'
    ? t('automations.type.summary')
    : t('automations.type.webResearch');
}

function frequencyLabel(frequency: Frequency, t: TranslateFn): string {
  const labels: Record<Frequency, string> = {
    DAILY: t('automations.freq.daily'),
    WEEKLY: t('automations.freq.weekly'),
    MONTHLY: t('automations.freq.monthly'),
  };
  return labels[frequency];
}

function dayLabels(t: TranslateFn): string[] {
  return [
    t('automations.day.monday'),
    t('automations.day.tuesday'),
    t('automations.day.wednesday'),
    t('automations.day.thursday'),
    t('automations.day.friday'),
    t('automations.day.saturday'),
    t('automations.day.sunday'),
  ];
}

function promptPlaceholder(type: AutomationType, t: TranslateFn): string {
  return type === 'PERIODIC_SUMMARY'
    ? t('automations.prompt.summary')
    : t('automations.prompt.webResearch');
}

// ---------------------------------------------------------------------------
// Form (create + edit)
// ---------------------------------------------------------------------------

function AutomationForm({
  initial,
  t,
  onClose,
  onSaved,
}: {
  initial: Automation | null;
  t: TranslateFn;
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
  const delivery: Delivery = 'IN_APP';
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
      toast.error(t('automations.form.required'));
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
      toast.success(isEdit ? t('automations.updated') : t('automations.created'));
      onSaved();
    } catch (err) {
      toast.error(t('automations.saveError'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <form onSubmit={submit}>
          <DialogHeader className="sticky top-0 z-10 border-b border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-3 pr-12 sm:px-6 sm:py-4 sm:pr-14">
            <DialogTitle>
              {isEdit ? t('automations.form.editTitle') : t('automations.form.newTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-6 space-y-4">
            <Field label={t('automations.form.name')}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('automations.form.namePlaceholder')}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-fg)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                maxLength={120}
                required
              />
            </Field>

            <Field label={t('automations.form.type')}>
              <div className="grid grid-cols-2 gap-2">
                {(['PERIODIC_SUMMARY', 'WEB_RESEARCH'] as const).map((automationType) => (
                  <button
                    key={automationType}
                    type="button"
                    onClick={() => {
                      setType(automationType);
                      if (!prompt.trim()) setPrompt(promptPlaceholder(automationType, t));
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                      type === automationType
                        ? 'border-violet-500 bg-violet-500/10 text-violet-200'
                        : 'border-[var(--color-app-border)] text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface-hover)]'
                    }`}
                  >
                    <div className="font-medium">{typeLabel(automationType, t)}</div>
                    <div className="text-[11px] text-[var(--color-app-muted)] mt-0.5">
                      {automationType === 'PERIODIC_SUMMARY'
                        ? t('automations.type.summaryDescription')
                        : t('automations.type.webResearchDescription')}
                    </div>
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t('automations.form.prompt')}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={promptPlaceholder(type, t)}
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-fg)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                maxLength={4000}
                required
              />
            </Field>

            <Field label={t('automations.form.frequency')}>
              <div className="flex gap-2">
                {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      frequency === f
                        ? 'border-violet-500 bg-violet-500/10 text-violet-200'
                        : 'border-[var(--color-app-border)] text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface-hover)]'
                    }`}
                  >
                    {frequencyLabel(f, t)}
                  </button>
                ))}
              </div>
            </Field>

            {frequency === 'WEEKLY' && (
              <Field label={t('automations.form.dayOfWeek')}>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-fg)] text-sm"
                >
                  {dayLabels(t).map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {frequency === 'MONTHLY' && (
              <Field label={t('automations.form.dayOfMonth')}>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-fg)] text-sm"
                />
                <p className="text-[11px] text-[var(--color-app-muted)] mt-1">
                  {t('automations.form.monthHint')}
                </p>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('automations.form.hour')}>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-fg)] text-sm"
                />
              </Field>
              <Field label={t('automations.form.minute')}>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-fg)] text-sm"
                />
              </Field>
            </div>

            {/* Delivery: apenas IN_APP (Telegram removido). Mantemos o campo
              no payload por compatibilidade com o schema. */}
            <input type="hidden" name="delivery" value="IN_APP" />

            <div className="text-[11px] text-[var(--color-app-muted)]">
              {t('automations.form.timezone', { timezone })}
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 border-t border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-3 sm:px-6 sm:py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              {isEdit ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      <span className="text-xs font-medium text-[var(--color-app-subtle)] mb-1.5 block">
        {label}
      </span>
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
  locale,
  t,
  onClose,
}: {
  automation: Automation;
  runs: Run[];
  locale: Locale;
  t: TranslateFn;
  onClose: () => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(runs[0]?.id ?? null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b border-[var(--color-app-border)] px-4 py-3 pr-12 sm:px-6 sm:py-4 sm:pr-14">
          <DialogTitle>{automation.name}</DialogTitle>
          <DialogDescription className="text-xs">{t('automations.recentRuns')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 space-y-3">
          {runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--color-app-muted)]">
              {t('automations.noRuns')}
            </div>
          ) : (
            runs.map((r) => {
              const ts = r.startedAt ?? r.createdAt;
              const isOpen = expanded === r.id;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[var(--color-app-surface-hover)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <RunStatusBadge status={r.status} t={t} />
                      <span className="text-sm text-[var(--color-app-subtle)]">
                        {new Date(ts).toLocaleString(locale, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      {r.triggeredBy === 'manual' && (
                        <span className="text-[10px] uppercase text-[var(--color-app-muted)]">
                          {t('automations.manual')}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--color-app-muted)]">
                      $
                      {(Number.isFinite(parseFloat(r.costUsd)) ? parseFloat(r.costUsd) : 0).toFixed(
                        4,
                      )}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-[var(--color-app-border)] px-4 py-3 bg-[var(--color-app-bg)]/40">
                      {r.status === 'FAILED' && r.errorMessage && (
                        <div className="text-sm text-rose-300 mb-2 break-words">
                          ⚠️ {r.errorMessage}
                        </div>
                      )}
                      {r.outputMd ? (
                        <Markdown>{r.outputMd}</Markdown>
                      ) : (
                        <div className="text-sm text-[var(--color-app-muted)] italic">
                          {r.status === 'PENDING' || r.status === 'RUNNING'
                            ? t('automations.waiting')
                            : t('automations.noOutput')}
                        </div>
                      )}
                      {r.noteId && (
                        <div className="mt-3 text-xs text-[var(--color-app-muted)]">
                          {t('automations.noteCreated')}{' '}
                          <a
                            href={`/notas/${r.noteId}`}
                            className="text-violet-300 hover:underline"
                          >
                            {t('automations.open')}
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
      </DialogContent>
    </Dialog>
  );
}
