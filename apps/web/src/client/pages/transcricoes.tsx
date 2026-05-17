import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { useFetch } from '../lib/hooks';
import { formatDuration, formatRelative, formatUsd } from '../lib/format';
import type { JobStatus } from '../lib/types';

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
    <div className="px-8 py-10 mx-auto max-w-6xl space-y-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Acervo</p>
        <h1 className="text-3xl font-semibold tracking-tight">Transcrições</h1>
        <p className="text-sm text-zinc-400 mt-2">
          Todas as transcrições do seu workspace. Em breve: busca full-text.
        </p>
      </header>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {!loading && transcripts.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <Search className="h-6 w-6 text-zinc-600 mx-auto" />
            <p className="text-sm text-zinc-300">Nenhuma transcrição ainda.</p>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/jobs">Transcrever primeiro vídeo</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && transcripts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {transcripts.map((t) => (
            <TranscriptCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptCard({ t }: { t: TranscriptSummary }): React.ReactElement {
  return (
    <Link
      to={`/transcricoes/${t.id}`}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 rounded-xl"
    >
      <Card className="h-full overflow-hidden group-hover:border-zinc-700 transition-colors">
        {t.thumbnailUrl ? (
          <div className="aspect-video bg-zinc-900 overflow-hidden">
            <img
              src={t.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="aspect-video bg-zinc-900 flex items-center justify-center">
            <span className="text-3xl font-semibold text-zinc-700 tracking-tight">
              {t.title[0]?.toUpperCase()}
            </span>
          </div>
        )}

        <CardContent className="pt-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold leading-snug tracking-tight line-clamp-2 group-hover:text-emerald-400 transition-colors">
              {t.title}
            </h3>
            {t.channel && <p className="text-xs text-zinc-500 mt-1 truncate">{t.channel}</p>}
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Badge variant="muted" className="text-[10px]">
              {formatDuration(t.durationSec)}
            </Badge>
            <Badge
              variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
              className="text-[10px]"
            >
              {t.transcriptionMethod === 'SUBTITLES' ? 'Legendas' : 'IA'}
            </Badge>
            {t.language && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {t.language}
              </Badge>
            )}
          </div>

          <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{formatRelative(new Date(t.createdAt))}</span>
            <span className="tabular-nums">{formatUsd(t.costUsd)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Re-export pra os outros files que referenciam JobStatus daqui sem precisar reescrever
export type { JobStatus };
