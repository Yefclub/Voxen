import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil, RefreshCw, RotateCcw, Search } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import type { Locale } from '../../lib/i18n';

type CorrectionHead = {
  id: string;
  correctionRevision: number;
  correctionState: 'ACTIVE' | 'STALE';
  correctionStaleReason: string | null;
  sourceVersion: number;
  sourceChecksum: string | null;
  checksum: string;
  corrected: boolean;
};

type Preview = {
  baseChecksum: string;
  resultChecksum: string;
  preview: { matchCount: number; line: number; before: string; after: string; context: string };
};

type Revision = {
  revision: number;
  actor: string;
  changeSummary: string | null;
  checksum: string;
  createdAt: string;
};
type RevisionDetail = Revision & { markdown: string; plainText: string };

type OperationKind = 'replace' | 'insert_before' | 'insert_after' | 'prepend' | 'append';

export function TranscriptCorrectionsCard({
  transcriptId,
  revision,
  state,
  staleReason,
  readOnly,
  locale,
  canonicalMarkdown,
  onUpdated,
}: {
  transcriptId: string;
  revision: number;
  state: 'ACTIVE' | 'STALE';
  staleReason: string | null;
  readOnly: boolean;
  locale: Locale;
  canonicalMarkdown: string | null;
  onUpdated: () => Promise<void> | void;
}): React.ReactElement {
  const copy = locale === 'en' ? EN : PT;
  const [open, setOpen] = useState(false);
  const [head, setHead] = useState<CorrectionHead | null>(null);
  const [kind, setKind] = useState<OperationKind>('replace');
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [occurrence, setOccurrence] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Revision[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<RevisionDetail | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadHead = useCallback(async (): Promise<CorrectionHead> => {
    const response = await fetch(`/api/transcripts/${transcriptId}/corrections`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(copy.loadError);
    const body = (await response.json()) as { head: CorrectionHead };
    setHead(body.head);
    return body.head;
  }, [copy.loadError, transcriptId]);

  useEffect(() => {
    if (!open) return;
    void loadHead().catch(() => toast.error(copy.loadError));
  }, [copy.loadError, loadHead, open]);

  async function previewChange(): Promise<void> {
    setBusy(true);
    setPreview(null);
    try {
      const current = head ?? (await loadHead());
      const operation = buildOperation(kind, target, text, occurrence);
      const response = await fetch(`/api/transcripts/${transcriptId}/corrections/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: current.correctionRevision,
          expectedSourceVersion: current.sourceVersion,
          expectedSourceChecksum: current.sourceChecksum,
          operation,
        }),
      });
      const body = (await response.json()) as Preview & { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.previewError);
      setPreview(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.previewError);
    } finally {
      setBusy(false);
    }
  }

  async function applyChange(): Promise<void> {
    if (!head || !preview) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/transcripts/${transcriptId}/corrections/apply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: head.correctionRevision,
          expectedSourceVersion: head.sourceVersion,
          expectedSourceChecksum: head.sourceChecksum,
          expectedBaseChecksum: preview.baseChecksum,
          expectedResultChecksum: preview.resultChecksum,
          operation: buildOperation(kind, target, text, occurrence),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.applyError);
      toast.success(copy.applied);
      setPreview(null);
      setTarget('');
      setText('');
      await loadHead();
      await onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.applyError);
      await loadHead().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(before?: number): Promise<void> {
    setBusy(true);
    try {
      const query = before ? `?before=${before}` : '';
      const response = await fetch(
        `/api/transcripts/${transcriptId}/corrections/revisions${query}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(copy.historyError);
      const body = (await response.json()) as {
        revisions: Revision[];
        nextBefore: number | null;
      };
      setHistory((current) => (before ? [...current, ...body.revisions] : body.revisions));
      setNextBefore(body.nextBefore);
      setShowHistory(true);
    } catch {
      toast.error(copy.historyError);
    } finally {
      setBusy(false);
    }
  }

  async function inspectRevision(targetRevision: number): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/transcripts/${transcriptId}/corrections/revisions/${targetRevision}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(copy.historyError);
      const body = (await response.json()) as { revision: RevisionDetail };
      setSelectedRevision(body.revision);
    } catch {
      toast.error(copy.historyError);
    } finally {
      setBusy(false);
    }
  }

  async function resetCorrections(): Promise<void> {
    const current = head ?? (await loadHead());
    setBusy(true);
    try {
      const response = await fetch(`/api/transcripts/${transcriptId}/corrections/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: current.correctionRevision,
          expectedSourceVersion: current.sourceVersion,
          expectedSourceChecksum: current.sourceChecksum,
          expectedBaseChecksum: current.checksum,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.resetError);
      toast.success(copy.reset);
      setPreview(null);
      await loadHead();
      if (showHistory) await loadHistory();
      await onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.resetError);
    } finally {
      setBusy(false);
    }
  }

  async function restoreRevision(targetRevision: number): Promise<void> {
    const current = head ?? (await loadHead());
    setBusy(true);
    try {
      const response = await fetch(
        `/api/transcripts/${transcriptId}/corrections/revisions/${targetRevision}/restore`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedRevision: current.correctionRevision,
            expectedSourceVersion: current.sourceVersion,
            expectedSourceChecksum: current.sourceChecksum,
            expectedBaseChecksum: current.checksum,
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.restoreError);
      toast.success(copy.restored);
      await loadHead();
      await loadHistory();
      await onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.restoreError);
    } finally {
      setBusy(false);
    }
  }

  const needsTarget = !['prepend', 'append'].includes(kind);
  return (
    <Card elevated className="border-[var(--color-app-border)]/80" data-transcript-corrections>
      <CardContent className="space-y-4 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">
                {copy.title}
              </h2>
              {revision > 0 && (
                <Badge variant="outline">
                  {copy.revision} {revision}
                </Badge>
              )}
              {state === 'STALE' && <Badge variant="warning">{copy.stale}</Badge>}
            </div>
            <p className="text-sm text-[var(--color-app-muted)]">
              {state === 'STALE'
                ? `${copy.staleDescription} ${staleReason ?? ''}`
                : copy.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {revision > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void loadHistory()}
              >
                <RotateCcw className="h-3.5 w-3.5" /> {copy.history}
              </Button>
            )}
            {canonicalMarkdown && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setShowOriginal((value) => !value)}
              >
                <Eye className="h-3.5 w-3.5" />
                {showOriginal ? copy.hideOriginal : copy.showOriginal}
              </Button>
            )}
            {revision > 0 && state === 'ACTIVE' && !readOnly && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void resetCorrections()}
              >
                {copy.reset}
              </Button>
            )}
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
                <Pencil className="h-3.5 w-3.5" /> {open ? copy.close : copy.edit}
              </Button>
            )}
          </div>
        </div>

        {showOriginal && canonicalMarkdown && (
          <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/60 p-3">
            <p className="mb-2 text-xs font-semibold text-[var(--color-app-muted)]">
              {copy.originalEvidence}
            </p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
              {canonicalMarkdown}
            </pre>
          </div>
        )}

        {open && !readOnly && (
          <div className="space-y-3 border-t border-[var(--color-app-border)] pt-4">
            <div className="grid gap-3 sm:grid-cols-[190px_1fr]">
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as OperationKind);
                  setPreview(null);
                }}
                className="h-10 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 text-sm"
              >
                <option value="replace">{copy.replace}</option>
                <option value="insert_before">{copy.insertBefore}</option>
                <option value="insert_after">{copy.insertAfter}</option>
                <option value="prepend">{copy.prepend}</option>
                <option value="append">{copy.append}</option>
              </select>
              {needsTarget && (
                <input
                  value={occurrence}
                  onChange={(event) => {
                    setOccurrence(event.target.value);
                    setPreview(null);
                  }}
                  inputMode="numeric"
                  placeholder={copy.occurrence}
                  className="h-10 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 text-sm"
                />
              )}
            </div>
            {needsTarget && (
              <textarea
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setPreview(null);
                }}
                placeholder={copy.target}
                rows={3}
                className="w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-3 font-mono text-sm"
              />
            )}
            <textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPreview(null);
              }}
              placeholder={copy.text}
              rows={4}
              className="w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-3 font-mono text-sm"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy || !text || (needsTarget && !target)}
                onClick={() => void previewChange()}
              >
                <Search className="h-3.5 w-3.5" /> {copy.preview}
              </Button>
              <Button disabled={busy || !preview} onClick={() => void applyChange()}>
                {busy ? <RefreshCw className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}{' '}
                {copy.apply}
              </Button>
            </div>
            {preview && (
              <div className="rounded-xl border border-violet-400/25 bg-violet-500/5 p-4">
                <p className="mb-2 text-xs text-[var(--color-app-muted)]">
                  {copy.previewAt
                    .replace('{line}', String(preview.preview.line))
                    .replace('{count}', String(preview.preview.matchCount))}
                </p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
                  {preview.preview.context}
                </pre>
              </div>
            )}
          </div>
        )}

        {showHistory && (
          <div className="space-y-2 border-t border-[var(--color-app-border)] pt-4">
            {history.length === 0 ? (
              <p className="text-sm text-[var(--color-app-muted)]">{copy.emptyHistory}</p>
            ) : (
              history.map((item) => (
                <div
                  key={item.revision}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-app-border)] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {copy.revision} {item.revision} · {actorLabel(item.actor, copy)}
                    </p>
                    <p className="text-xs text-[var(--color-app-muted)]">
                      {summaryLabel(item.changeSummary, copy)} ·{' '}
                      {new Date(item.createdAt).toLocaleString(locale)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void inspectRevision(item.revision)}
                    >
                      <Eye className="h-3.5 w-3.5" /> {copy.inspect}
                    </Button>
                    {!readOnly && item.revision !== head?.correctionRevision && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void restoreRevision(item.revision)}
                      >
                        {copy.restore}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
            {nextBefore && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void loadHistory(nextBefore)}
              >
                {copy.loadOlder}
              </Button>
            )}
            {selectedRevision && (
              <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/60 p-3">
                <p className="mb-2 text-xs font-semibold text-[var(--color-app-muted)]">
                  {copy.revision} {selectedRevision.revision} ·{' '}
                  {summaryLabel(selectedRevision.changeSummary, copy)}
                </p>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
                  {selectedRevision.markdown}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildOperation(
  kind: OperationKind,
  target: string,
  text: string,
  occurrence: string,
): object {
  if (kind === 'prepend' || kind === 'append') return { kind, text };
  const parsedOccurrence = Number.parseInt(occurrence, 10);
  return {
    kind,
    target,
    text,
    ...(Number.isInteger(parsedOccurrence) && parsedOccurrence > 0
      ? { occurrence: parsedOccurrence }
      : {}),
  };
}

const PT = {
  title: 'Correções da transcrição',
  revision: 'Revisão',
  stale: 'Obsoleta',
  description:
    'Corrija trechos sem alterar a evidência original. Cada mudança cria uma revisão auditável.',
  staleDescription:
    'A fonte mudou; as correções antigas foram preservadas e a leitura voltou ao conteúdo original.',
  edit: 'Corrigir',
  close: 'Fechar',
  history: 'Histórico',
  showOriginal: 'Ver original',
  hideOriginal: 'Ocultar original',
  originalEvidence: 'Evidência original imutável',
  replace: 'Substituir trecho',
  insertBefore: 'Inserir antes',
  insertAfter: 'Inserir depois',
  prepend: 'Adicionar no início',
  append: 'Adicionar no fim',
  occurrence: 'Ocorrência (opcional)',
  target: 'Trecho exato a localizar',
  text: 'Novo texto',
  preview: 'Pré-visualizar',
  apply: 'Aplicar correção',
  previewAt: 'Linha {line} · {count} ocorrência(s)',
  restore: 'Restaurar',
  inspect: 'Inspecionar',
  loadOlder: 'Carregar revisões anteriores',
  reset: 'Voltar ao conteúdo original',
  emptyHistory: 'Nenhuma correção registrada.',
  noSummary: 'Sem descrição',
  applied: 'Correção aplicada e reindexação agendada.',
  restored: 'Revisão restaurada em uma nova versão.',
  loadError: 'Não foi possível carregar a camada de correções.',
  previewError: 'Não foi possível gerar a prévia.',
  applyError: 'Não foi possível aplicar a correção.',
  historyError: 'Não foi possível carregar o histórico.',
  restoreError: 'Não foi possível restaurar a revisão.',
  resetError: 'Não foi possível voltar ao conteúdo original.',
  actorUser: 'Usuário',
  actorMcp: 'MCP',
  actorChat: 'Chat',
  actorRestore: 'Restauração',
  actorSystem: 'Sistema',
  summaryReplace: 'Substituição de trecho exato',
  summaryInsertBefore: 'Inserção antes de trecho exato',
  summaryInsertAfter: 'Inserção depois de trecho exato',
  summaryPrepend: 'Inserção no início',
  summaryAppend: 'Inserção no fim',
  summaryRestore: 'Restauração da revisão {revision}',
  summaryReset: 'Retorno ao conteúdo original',
} as const;
const EN: { [Key in keyof typeof PT]: string } = {
  title: 'Transcript corrections',
  revision: 'Revision',
  stale: 'Stale',
  description:
    'Correct passages without changing the original evidence. Every change creates an auditable revision.',
  staleDescription:
    'The source changed; old corrections were preserved and reads reverted to the original content.',
  edit: 'Correct',
  close: 'Close',
  history: 'History',
  showOriginal: 'View original',
  hideOriginal: 'Hide original',
  originalEvidence: 'Immutable original evidence',
  replace: 'Replace passage',
  insertBefore: 'Insert before',
  insertAfter: 'Insert after',
  prepend: 'Add at start',
  append: 'Add at end',
  occurrence: 'Occurrence (optional)',
  target: 'Exact passage to find',
  text: 'New text',
  preview: 'Preview',
  apply: 'Apply correction',
  previewAt: 'Line {line} · {count} occurrence(s)',
  restore: 'Restore',
  inspect: 'Inspect',
  loadOlder: 'Load older revisions',
  reset: 'Return to original content',
  emptyHistory: 'No corrections recorded.',
  noSummary: 'No description',
  applied: 'Correction applied and reindexing queued.',
  restored: 'Revision restored as a new version.',
  loadError: 'Could not load the correction layer.',
  previewError: 'Could not generate the preview.',
  applyError: 'Could not apply the correction.',
  historyError: 'Could not load correction history.',
  restoreError: 'Could not restore the revision.',
  resetError: 'Could not return to the original content.',
  actorUser: 'User',
  actorMcp: 'MCP',
  actorChat: 'Chat',
  actorRestore: 'Restore',
  actorSystem: 'System',
  summaryReplace: 'Exact passage replacement',
  summaryInsertBefore: 'Insertion before exact passage',
  summaryInsertAfter: 'Insertion after exact passage',
  summaryPrepend: 'Insertion at start',
  summaryAppend: 'Insertion at end',
  summaryRestore: 'Restore revision {revision}',
  summaryReset: 'Return to original content',
};

type CorrectionCopy = { [Key in keyof typeof PT]: string };

function actorLabel(actor: string, copy: CorrectionCopy): string {
  return (
    {
      USER: copy.actorUser,
      MCP: copy.actorMcp,
      CHAT: copy.actorChat,
      RESTORE: copy.actorRestore,
      SYSTEM: copy.actorSystem,
    }[actor] ?? actor
  );
}

function summaryLabel(summary: string | null, copy: CorrectionCopy): string {
  if (!summary) return copy.noSummary;
  const exact = {
    'Replace exact passage': copy.summaryReplace,
    'Insert before exact passage': copy.summaryInsertBefore,
    'Insert after exact passage': copy.summaryInsertAfter,
    'Prepend content': copy.summaryPrepend,
    'Append content': copy.summaryAppend,
    'Reset corrections to canonical source': copy.summaryReset,
  }[summary];
  if (exact) return exact;
  const restored = /^Restore correction revision (\d+)(?: through MCP)?$/.exec(summary);
  return restored ? copy.summaryRestore.replace('{revision}', restored[1]!) : summary;
}
