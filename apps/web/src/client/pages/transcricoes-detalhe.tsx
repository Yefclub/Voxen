import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Languages,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { useFetch } from '../lib/hooks';
import { formatDateTime, formatDuration, formatUsd } from '../lib/format';
import { AnimatedPage } from '../components/motion/animated-page';
import { TranscriptViewer } from '../components/ui/transcript-viewer';
import { Markdown } from '../components/ui/markdown';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { useI18n, type TranslateFn } from '../lib/i18n';

interface TranscriptDetail {
  id: string;
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  url: string;
  title: string;
  channel: string | null;
  author: string | null;
  durationSec: number;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES' | 'SCRAPE' | 'VISION' | 'DOCUMENT';
  model: string | null;
  costUsd: string | null;
  // Soma de costUsd da transcrição + custos de resumos/regenerações.
  // Backend calcula a partir de CostEvent.meta.transcript_id.
  totalCostUsd: string | null;
  mdPath: string;
  plainText: string;
  summaryMd: string | null;
  frontmatter: unknown;
  createdAt: string;
}

interface ResponseBody {
  transcript: TranscriptDetail;
  markdown: string;
}

export function TranscricaoDetalhePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { locale, t: translate } = useI18n();
  const { data, loading, refresh } = useFetch<ResponseBody>(id ? `/api/transcripts/${id}` : null);
  const [generating, setGenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  async function generateSummary(force: boolean): Promise<void> {
    if (!id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/transcripts/${id}/summary`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        existing?: boolean;
      };
      if (res.status === 409 && body.existing) {
        // Já tem resumo → abre confirm modal pra regen
        setConfirmRegen(true);
        return;
      }
      if (!res.ok) {
        toast.error(body.error ?? translate('library.summaryError'));
        return;
      }
      toast.success(
        force ? translate('library.summaryRegenerated') : translate('library.summaryGenerated'),
      );
      refresh();
    } catch (e) {
      toast.error(translate('library.summaryUnexpectedError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="px-8 py-10 mx-auto max-w-5xl">
        <Skeleton className="h-7 w-32 mb-8" />
        <Skeleton className="h-12 w-3/4 mb-3" />
        <Skeleton className="h-5 w-1/3 mb-10" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
          <div className="space-y-3">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  const t = data.transcript;
  const created = new Date(t.createdAt);
  const published = t.publishedAt ? new Date(t.publishedAt) : null;
  const isVisualTranscript = t.transcriptionMethod === 'VISION';
  const isDocumentTranscript = t.transcriptionMethod === 'DOCUMENT';
  const contentMarkdown = stripMarkdownFrontmatter(data.markdown);

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-5xl">
        <Button variant="ghost" size="sm" asChild className="mb-8 -ml-2">
          <Link to="/transcricoes">
            <ArrowLeft className="h-3.5 w-3.5" />
            {translate('library.detailBack')}
          </Link>
        </Button>

        <motion.header
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10 space-y-4"
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source primário — clarifica origem do conteúdo */}
            <Badge variant={t.source === 'WEB' ? 'muted' : 'success'} className="text-[10px]">
              {t.source === 'WEB' && (
                <>
                  <Globe className="h-3 w-3" />
                  {translate('library.source.web')}
                </>
              )}
              {t.source === 'YOUTUBE' && 'YouTube'}
              {t.source === 'INSTAGRAM' && 'Instagram Reel'}
              {t.source === 'TIKTOK' && 'TikTok'}
              {t.source === 'X' && 'X'}
              {t.source === 'UPLOAD' && 'Upload'}
            </Badge>
            {/* Método de extração — só faz sentido pra vídeos */}
            {t.source !== 'WEB' && (
              <Badge
                variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
                className="text-[10px]"
              >
                {isDocumentTranscript ? (
                  translate('library.method.document')
                ) : isVisualTranscript ? (
                  translate('library.method.visualAnalysis')
                ) : t.transcriptionMethod === 'SUBTITLES' ? (
                  translate('library.method.officialSubtitles')
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 inline mr-1" />{' '}
                    {translate('library.method.aiTranscript')}
                  </>
                )}
              </Badge>
            )}
            {t.language && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {t.language}
              </Badge>
            )}
          </div>
          <h1 className="font-display text-4xl lg:text-5xl font-semibold tracking-[-0.035em] leading-[1.05] text-balance">
            {t.title}
          </h1>
          {t.channel && <p className="text-[15px] text-[var(--color-app-muted)]">{t.channel}</p>}
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10">
          {/* Coluna principal: resumo + transcrição */}
          <motion.article
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="min-w-0 space-y-10"
          >
            <SummaryBlock
              summary={t.summaryMd}
              generating={generating}
              onGenerate={() => void generateSummary(false)}
              t={translate}
            />
            {t.source === 'WEB' || isVisualTranscript || isDocumentTranscript ? (
              <section>
                <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-200 mb-4">
                  {isDocumentTranscript
                    ? translate('library.documentAnalysis')
                    : isVisualTranscript
                      ? translate('library.analysis')
                      : translate('library.content')}
                </h2>
                <Card elevated>
                  <CardContent className="px-6 py-5">
                    <Markdown>{contentMarkdown}</Markdown>
                  </CardContent>
                </Card>
              </section>
            ) : (
              <TranscriptViewer markdown={data.markdown} />
            )}
          </motion.article>

          {/* Sidebar: metadata + thumbnail */}
          <motion.aside
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.18 }}
            className="space-y-4 lg:sticky lg:top-24 self-start"
          >
            {t.thumbnailUrl && (
              <Card className="overflow-hidden p-0" elevated>
                <img
                  src={t.thumbnailUrl}
                  alt=""
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
              </Card>
            )}

            <Card elevated>
              <CardContent className="pt-5 pb-5 space-y-4">
                {/* Duração só faz sentido pra vídeos */}
                {t.source !== 'WEB' && !isVisualTranscript && !isDocumentTranscript && (
                  <MetaRow
                    Icon={Clock}
                    label={translate('library.duration')}
                    value={formatDuration(t.durationSec)}
                  />
                )}
                {t.channel && t.source === 'WEB' && (
                  <MetaRow Icon={Globe} label={translate('library.site')} value={t.channel} />
                )}
                <MetaRow
                  Icon={Languages}
                  label={translate('library.language')}
                  value={t.language.toUpperCase()}
                />
                <MetaRow
                  Icon={Calendar}
                  label={translate('library.added')}
                  value={formatDateTime(created, locale)}
                />
                {published && (
                  <MetaRow
                    Icon={Calendar}
                    label={translate('library.published')}
                    value={formatDateTime(published, locale)}
                  />
                )}
                {t.model && (
                  <MetaRow
                    Icon={FileText}
                    label={translate('library.model')}
                    value={t.model}
                    mono
                  />
                )}
                {/* Mostra apenas se houve custo de fato (>0). totalCostUsd
                    agrega transcrição + summary/regenerações. */}
                {parseFloat(t.totalCostUsd ?? '0') > 0 && (
                  <MetaRow
                    Icon={FileText}
                    label={translate('library.cost')}
                    value={formatUsd(t.totalCostUsd)}
                    mono
                  />
                )}
              </CardContent>
            </Card>

            {t.source !== 'UPLOAD' && (
              <Button variant="outline" size="default" className="w-full" asChild>
                <a href={t.url} target="_blank" rel="noreferrer">
                  {t.source === 'WEB'
                    ? translate('library.openPage')
                    : translate('library.openVideo')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
          </motion.aside>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title={translate('library.regenerateTitle')}
        description={translate('library.regenerateDescription')}
        confirmLabel={translate('library.regenerateSummary')}
        cancelLabel={translate('common.cancel')}
        onConfirm={() => generateSummary(true)}
        loading={generating}
      />
    </AnimatedPage>
  );
}

function stripMarkdownFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length).trimStart() : markdown;
}

function SummaryBlock({
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
  if (!summary) {
    return (
      <Card elevated>
        <CardContent className="py-8 px-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
              <Wand2 className="h-4 w-4 text-violet-300" />
            </div>
            <div className="flex-1 space-y-1">
              <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-100">
                {t('library.summary')}
              </h2>
              <p className="text-sm text-[var(--color-app-muted)]">
                {t('library.summaryDescription')}
              </p>
            </div>
            <Button onClick={onGenerate} disabled={generating} variant="primary" size="sm">
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
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
            <Wand2 className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-100">
            {t('library.summary')}
          </h2>
        </div>
        <Button onClick={onGenerate} disabled={generating} variant="ghost" size="sm">
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
      <Card elevated>
        <CardContent className="px-6 py-5">
          <Markdown>{summary}</Markdown>
        </CardContent>
      </Card>
    </section>
  );
}

function MetaRow({
  Icon,
  label,
  value,
  mono,
}: {
  Icon: typeof Clock;
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <div className="h-7 w-7 rounded-md bg-[var(--color-app-bg-elevated)] border border-[var(--color-app-border)] flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-app-muted)] font-medium">
          {label}
        </p>
        <p
          className={
            mono
              ? 'text-[13px] font-mono text-zinc-200 truncate mt-0.5 tabular-nums'
              : 'text-sm text-zinc-200 mt-0.5'
          }
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
