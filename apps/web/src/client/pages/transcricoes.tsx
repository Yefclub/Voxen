import { Link } from 'react-router-dom';
import { Library, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { useFetch } from '../lib/hooks';
import { formatDuration, formatRelative, formatUsd } from '../lib/format';
import type { JobStatus } from '../lib/types';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';

interface TranscriptSummary {
  id: string;
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK';
  url: string;
  title: string;
  channel: string | null;
  durationSec: number;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES';
  thumbnailUrl: string | null;
  costUsd: string | null;
  createdAt: string;
}

export function TranscricoesPage(): React.ReactElement {
  const { data, loading } = useFetch<{ transcripts: TranscriptSummary[] }>('/api/transcripts');
  const transcripts = data?.transcripts ?? [];

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Library className="h-3.5 w-3.5 text-violet-400" />
            Acervo
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Transcrições</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Todas as transcrições do seu workspace. Em breve: busca full-text e conversa com o
            agente.
          </p>
        </header>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        )}

        {!loading && transcripts.length === 0 && (
          <Card elevated>
            <CardContent className="py-20 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
                <Search className="h-5 w-5 text-violet-400" />
              </div>
              <div className="space-y-1.5">
                <p className="font-display text-lg font-semibold tracking-tight">Acervo vazio</p>
                <p className="text-sm text-[var(--color-app-muted)]">
                  Suas transcrições aparecerão aqui.
                </p>
              </div>
              <Button variant="primary" size="lg" asChild className="mt-3">
                <Link to="/jobs">Transcrever primeiro vídeo</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && transcripts.length > 0 && (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {transcripts.map((t) => (
              <StaggerItem key={t.id}>
                <TranscriptCard t={t} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </AnimatedPage>
  );
}

function TranscriptCard({ t }: { t: TranscriptSummary }): React.ReactElement {
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
      <Link
        to={`/transcricoes/${t.id}`}
        className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 rounded-2xl"
      >
        <Card
          hoverable
          elevated
          className="h-full overflow-hidden p-0 transition-shadow duration-300 group-hover:glow-violet"
        >
          {/* Thumbnail */}
          <div className="relative aspect-video bg-[var(--color-app-bg-elevated)] overflow-hidden">
            {t.thumbnailUrl ? (
              <img
                src={t.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                <span className="font-display text-5xl font-semibold text-zinc-700 tracking-tight">
                  {t.title[0]?.toUpperCase()}
                </span>
              </div>
            )}
            {/* Overlay gradiente inferior pra legibilidade do badge de duração */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent"
            />
            <div className="absolute bottom-2 right-2">
              <Badge
                variant="default"
                className="bg-black/60 backdrop-blur-sm border-white/10 text-[10px] tabular-nums"
              >
                {formatDuration(t.durationSec)}
              </Badge>
            </div>
          </div>

          <CardContent className="pt-4 pb-5 space-y-3">
            <div>
              <h3 className="text-[15px] font-semibold leading-snug tracking-tight line-clamp-2 group-hover:text-violet-300 transition-colors font-display">
                {t.title}
              </h3>
              {t.channel && (
                <p className="text-xs text-[var(--color-app-muted)] mt-1.5 truncate">{t.channel}</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Badge
                variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
                className="text-[10px]"
              >
                {t.transcriptionMethod === 'SUBTITLES' ? 'Legendas' : 'IA'}
              </Badge>
              {t.language && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                  {t.language}
                </Badge>
              )}
            </div>

            <div className="pt-3 border-t border-[var(--color-app-border)] flex items-center justify-between text-[11px] text-[var(--color-app-muted)]">
              <span>{formatRelative(new Date(t.createdAt))}</span>
              <span className="tabular-nums font-mono">{formatUsd(t.costUsd)}</span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

export type { JobStatus };
