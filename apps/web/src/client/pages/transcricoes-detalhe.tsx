import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Languages,
  Sparkles,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { useFetch } from '../lib/hooks';
import { formatDateTime, formatDuration, formatUsd } from '../lib/format';
import { AnimatedPage } from '../components/motion/animated-page';
import { TranscriptViewer } from '../components/ui/transcript-viewer';

interface TranscriptDetail {
  id: string;
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK';
  url: string;
  title: string;
  channel: string | null;
  author: string | null;
  durationSec: number;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES';
  model: string | null;
  costUsd: string | null;
  mdPath: string;
  plainText: string;
  frontmatter: unknown;
  createdAt: string;
}

interface ResponseBody {
  transcript: TranscriptDetail;
  markdown: string;
}

export function TranscricaoDetalhePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data, loading } = useFetch<ResponseBody>(id ? `/api/transcripts/${id}` : null);

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

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-5xl">
        <Button variant="ghost" size="sm" asChild className="mb-8 -ml-2">
          <Link to="/transcricoes">
            <ArrowLeft className="h-3.5 w-3.5" />
            Acervo
          </Link>
        </Button>

        <motion.header
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10 space-y-4"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="muted" className="text-[10px] tracking-wider uppercase">
              {t.source.toLowerCase()}
            </Badge>
            <Badge
              variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
              className="text-[10px]"
            >
              {t.transcriptionMethod === 'SUBTITLES' ? (
                'Legendas oficiais'
              ) : (
                <>
                  <Sparkles className="h-3 w-3 inline mr-1" /> Transcrição via IA
                </>
              )}
            </Badge>
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
          {/* Coluna principal: transcrição */}
          <motion.article
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="min-w-0"
          >
            <TranscriptViewer markdown={data.markdown} />
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
                <MetaRow Icon={Clock} label="Duração" value={formatDuration(t.durationSec)} />
                <MetaRow Icon={Languages} label="Idioma" value={t.language.toUpperCase()} />
                <MetaRow Icon={Calendar} label="Adicionado" value={formatDateTime(created)} />
                {published && (
                  <MetaRow Icon={Calendar} label="Publicado" value={formatDateTime(published)} />
                )}
                {t.model && <MetaRow Icon={FileText} label="Modelo" value={t.model} mono />}
                {t.costUsd && (
                  <MetaRow Icon={FileText} label="Custo" value={formatUsd(t.costUsd)} mono />
                )}
              </CardContent>
            </Card>

            <Button variant="outline" size="default" className="w-full" asChild>
              <a href={t.url} target="_blank" rel="noreferrer">
                Abrir vídeo original
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </motion.aside>
        </div>
      </div>
    </AnimatedPage>
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
