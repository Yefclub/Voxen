import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Badge } from './ui/badge';
import { useI18n } from '../lib/i18n';
import type { VersionMonitorState } from '../lib/use-version-monitor';

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
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {/* Cabeçalho com destaque */}
        <div className="flex items-start gap-4 border-b border-[var(--color-app-border)] bg-gradient-to-b from-emerald-500/[0.07] to-transparent p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 pr-6">
            <DialogTitle className="text-lg font-semibold tracking-tight text-[var(--color-app-fg)]">
              {t('shell.updateAvailable')}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-relaxed text-[var(--color-app-muted)]">
              {t('shell.updateModalSubtitle')}
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
        <div className="max-h-[44dvh] overflow-y-auto overflow-x-hidden px-6 py-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-app-muted)]">
            {t('shell.updateWhatsNew')}
          </h3>
          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner size={20} />
            </div>
          ) : notes && notes.length > 0 ? (
            <ul className="space-y-3.5">
              {notes.map((note, idx) => (
                <li
                  key={`${note.version}-${idx}`}
                  className="border-l-2 border-[var(--color-app-border)] pl-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
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
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--color-app-muted)]">
              {t('shell.updateNotesEmpty')}
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="flex justify-end gap-2 border-t border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-6 py-4">
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={applying}>
            {t('shell.updateLater')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleApply} disabled={applying}>
            {applying ? <Spinner size={16} /> : <RefreshCw className="h-4 w-4" />}
            {t('shell.updateAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
