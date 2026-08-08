import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Sparkles, Wand2, Workflow } from '../ui/icons';
import { toast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Markdown } from '../ui/markdown';
import type { TranslateFn } from '../../lib/i18n';
import { cn } from '../../lib/utils';

export function TranscriptSummaryBlock({
  summary,
  generating,
  onGenerate,
  t,
}: {
  summary: string | null;
  generating: boolean;
  onGenerate: () => void;
  t: TranslateFn;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copySummary(): Promise<void> {
    if (!summary?.trim()) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
      toast.success(t('library.summaryCopied'));
    } catch {
      toast.error(t('library.summaryCopyError'));
    }
  }

  if (!summary) {
    return (
      <Card elevated className="overflow-hidden border-[var(--color-app-border)]/80">
        <CardContent className="space-y-4 px-5 py-7 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-app-border-strong)] bg-gradient-to-br from-violet-500/20 to-emerald-500/15">
              <Wand2 className="h-4 w-4 text-violet-300" />
            </div>
            <div className="flex-1 space-y-1">
              <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--color-app-fg)]">
                {t('library.summary')}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--color-app-muted)]">
                {t('library.summaryDescription')}
              </p>
            </div>
            <Button
              onClick={onGenerate}
              disabled={generating}
              variant="primary"
              size="sm"
              className="w-full sm:w-auto"
            >
              {generating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('library.generating')}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('library.generateSummary')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <section className="group/summary space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border-strong)] bg-gradient-to-br from-violet-500/20 to-emerald-500/15">
            <Wand2 className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <h2 className="font-display text-base font-semibold tracking-tight text-[var(--color-app-fg)] sm:text-lg">
            {t('library.summary')}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            onClick={() => void copySummary()}
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]"
            aria-label={t('library.copySummary')}
            title={t('library.copySummary')}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-accent-primary)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="text-xs">{copied ? t('common.copied') : t('common.copy')}</span>
          </Button>
          <Button
            onClick={onGenerate}
            disabled={generating}
            variant="ghost"
            size="sm"
            className="h-8"
          >
            {generating ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('library.regenerating')}
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                {t('library.regenerateSummary')}
              </>
            )}
          </Button>
        </div>
      </div>
      <Card
        elevated
        className={cn(
          'border-[var(--color-app-border)]/80 transition-colors',
          'hover:border-[var(--color-app-border-strong)]',
        )}
      >
        <CardContent className="px-5 py-5 sm:px-6">
          <Markdown>{summary}</Markdown>
        </CardContent>
      </Card>
    </section>
  );
}

export function TranscriptFlowBlock({
  flowchart,
  generating,
  onGenerate,
  t,
}: {
  flowchart: string | null;
  generating: boolean;
  onGenerate: () => void;
  t: TranslateFn;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyFlow(): Promise<void> {
    if (!flowchart?.trim()) return;
    try {
      await navigator.clipboard.writeText(flowchart);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1_500);
      toast.success(t('library.flowCopied'));
    } catch {
      toast.error(t('library.flowCopyError'));
    }
  }

  if (!flowchart) {
    return (
      <Card elevated className="overflow-hidden border-[var(--color-app-border)]/80">
        <CardContent className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-app-border-strong)] bg-[var(--color-accent-primary-soft)]">
            <Workflow className="h-4 w-4 text-[var(--color-accent-primary)]" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-display text-base font-semibold text-[var(--color-app-fg)]">
              {t('library.flow')}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--color-app-muted)]">
              {t('library.flowDescription')}
            </p>
          </div>
          <Button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
          >
            {generating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('library.generatingFlow')}
              </>
            ) : (
              <>
                <Workflow className="h-3.5 w-3.5" /> {t('library.generateFlow')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-accent-primary-soft)]">
            <Workflow className="h-3.5 w-3.5 text-[var(--color-accent-primary)]" />
          </div>
          <h2 className="font-display text-base font-semibold text-[var(--color-app-fg)] sm:text-lg">
            {t('library.flow')}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            onClick={() => void copyFlow()}
            variant="ghost"
            size="sm"
            className="h-8"
            aria-label={t('library.copyFlow')}
            title={t('library.copyFlow')}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="text-xs">{copied ? t('common.copied') : t('common.copy')}</span>
          </Button>
          <Button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            variant="ghost"
            size="sm"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Workflow className="h-3.5 w-3.5" />
            )}
            {t('library.regenerateFlow')}
          </Button>
        </div>
      </div>
      <Card elevated className="overflow-hidden border-[var(--color-app-border)]/80">
        <CardContent className="px-4 py-3 sm:px-5">
          <Markdown>{`\`\`\`mermaid\n${flowchart}\n\`\`\``}</Markdown>
        </CardContent>
      </Card>
    </section>
  );
}
