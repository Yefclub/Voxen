import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Sparkles } from '@/components/ui/icons';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Badge } from './ui/badge';
import { useI18n } from '../lib/i18n';
import type { VersionMonitorState } from '../lib/use-version-monitor';
import { useChatShell } from '../lib/chat-shell-state';

interface ReleaseNote {
  version: string;
  channel?: string;
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
  date?: string;
}

interface ReleasesResponse {
  releases: ReleaseNote[];
}

// Rótulo curto por tipo de changelog (fallback: o próprio tipo).
const TYPE_LABEL: Record<string, string> = {
  feat: 'Novidade',
  fix: 'Correção',
  perf: 'Performance',
  ui: 'Interface',
  infra: 'Infra',
  security: 'Segurança',
  chore: 'Interno',
};

/**
 * Modal centralizado de nova versão. Substitui o antigo toast: mostra a
 * transição de versão e o "o que mudou" (changelog da release via /api/releases),
 * com ações de recarregar agora ou dispensar. O estado vem do useVersionMonitor.
 */
export function UpdateModal({
  monitor,
}: {
  monitor: VersionMonitorState;
}): React.ReactElement | null {
  const { t } = useI18n();
  const { update, apply, dismiss } = monitor;
  const { streaming } = useChatShell();
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!update) {
      setNotes(null);
      setApplying(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch('/api/releases?limit=4', { headers: { Accept: 'application/json' } })
      .then((res) =>
        res.ok ? (res.json() as Promise<ReleasesResponse>) : Promise.reject(new Error()),
      )
      .then((data) => {
        if (!cancelled) setNotes(Array.isArray(data.releases) ? data.releases : []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [update]);

  if (!update) return null;

  const handleApply = (): void => {
    setApplying(true);
    apply();
  };

  const typeLabel = (type: string): string => TYPE_LABEL[type] ?? type;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) dismiss();
      }}
    >
      <DialogContent className="max-h-[min(92dvh,52rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:w-[min(100vw-3rem,48rem)]">
        {/* Cabeçalho com destaque */}
        <div className="flex items-start gap-4 border-b border-[var(--color-app-border)] bg-gradient-to-br from-emerald-500/[0.12] via-transparent to-violet-500/[0.08] p-5 sm:p-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 pr-6">
            <DialogTitle className="font-display text-xl font-semibold tracking-[-0.025em] text-[var(--color-app-fg)] sm:text-2xl">
              {t('shell.updateAvailable')}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-relaxed text-[var(--color-app-muted)]">
              {streaming ? t('shell.updateBlockedStreaming') : t('shell.updateModalSubtitle')}
            </DialogDescription>
            {update.toVersion && (
              <div className="mt-3 flex items-center gap-1.5 font-mono text-[11px]">
                {update.fromVersion && (
                  <>
                    <span className="text-[var(--color-app-muted)]">v{update.fromVersion}</span>
                    <span className="text-[var(--color-app-muted)]">→</span>
                  </>
                )}
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
                  v{update.toVersion}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* O que mudou */}
        <div className="min-h-48 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-8 sm:py-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-app-muted)]">
              {t('shell.updateWhatsNew')}
            </h3>
            <Link
              to="/novidades"
              onClick={dismiss}
              className="shrink-0 text-xs font-medium text-violet-300 hover:text-violet-200 hover:underline"
            >
              {t('shell.versionOpenChangelog')}
            </Link>
          </div>
          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner size={20} />
            </div>
          ) : notes && notes.length > 0 ? (
            <ol className="relative space-y-3 before:absolute before:bottom-5 before:left-[0.38rem] before:top-5 before:w-px before:bg-[var(--color-app-border)]">
              {notes.map((note, idx) => (
                <li
                  key={`${note.version}-${idx}`}
                  className="relative ml-6 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/45 p-4"
                >
                  <span className="absolute -left-[1.85rem] top-5 h-3 w-3 rounded-full border-2 border-[var(--color-app-bg-elevated)] bg-[var(--color-accent-violet)]" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-[var(--color-app-muted)]">
                      v{note.version}
                    </span>
                    {note.type && (
                      <Badge variant="outline" className="text-[9px] uppercase">
                        {typeLabel(note.type)}
                      </Badge>
                    )}
                    {(note.title || note.summary) && (
                      <span className="text-[13px] font-medium text-[var(--color-app-subtle)]">
                        {note.title || note.summary}
                      </span>
                    )}
                  </div>
                  {note.title && (note.body || note.summary) && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--color-app-muted)]">
                      {(note.body || note.summary || '').trim()}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-[var(--color-app-muted)]">
              {t('shell.updateNotesEmpty')}
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-8 sm:py-5">
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={applying}>
            {t('shell.updateLater')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            disabled={applying || streaming}
          >
            {applying ? <Spinner size={16} /> : <RefreshCw className="h-4 w-4" />}
            {t('shell.updateAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
