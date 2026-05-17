import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { ArrowLeft, Calendar, Clock, ExternalLink, FileText, Languages } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { useFetch } from '../lib/hooks';
import { formatDateTime, formatDuration, formatUsd } from '../lib/format';

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

interface Response {
  transcript: TranscriptDetail;
  markdown: string;
}

// Remove o frontmatter (---...---) e o cabeçalho duplicado (# Title + > meta)
// porque já mostramos esses dados na barra lateral. Mantém só o corpo.
function stripFrontmatterAndHeader(md: string): string {
  let body = md;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }
  // Remove ![thumbnail](...) e # Title que vêm duplicados
  body = body.replace(/^!\[thumbnail\][^\n]*\n+/, '');
  body = body.replace(/^#\s+[^\n]+\n+/, '');
  // Remove a linha "> [Vídeo original]..."
  body = body.replace(/^>\s+\[Vídeo original\][^\n]*\n+/, '');
  // Remove ## Transcrição
  body = body.replace(/^##\s+Transcrição\s*\n+/m, '');
  return body.trim();
}

export function TranscricaoDetalhePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data, loading } = useFetch<Response>(id ? `/api/transcripts/${id}` : null);

  const cleanedBody = useMemo(() => (data ? stripFrontmatterAndHeader(data.markdown) : ''), [data]);

  if (loading || !data) {
    return (
      <div className="px-8 py-10 mx-auto max-w-5xl">
        <Skeleton className="h-8 w-32 mb-6" />
        <Skeleton className="h-64 w-full mb-4" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-5/6 mb-2" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    );
  }

  const t = data.transcript;
  const created = new Date(t.createdAt);
  const published = t.publishedAt ? new Date(t.publishedAt) : null;

  return (
    <div className="px-8 py-10 mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" asChild className="mb-6">
        <Link to="/transcricoes">
          <ArrowLeft className="h-3.5 w-3.5" />
          Acervo
        </Link>
      </Button>

      <header className="mb-8 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="muted" className="text-[10px]">
            {t.source.toLowerCase()}
          </Badge>
          <Badge
            variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
            className="text-[10px]"
          >
            {t.transcriptionMethod === 'SUBTITLES' ? 'Legendas oficiais' : 'Transcrição via IA'}
          </Badge>
          {t.language && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {t.language}
            </Badge>
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{t.title}</h1>
        {t.channel && <p className="text-sm text-zinc-400">{t.channel}</p>}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
        {/* Coluna principal: corpo da transcrição */}
        <article className="prose-voxen min-w-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 font-mono text-xs no-underline hover:underline hover:text-emerald-300 transition-colors mr-2"
                >
                  {props.children}
                </a>
              ),
              p: ({ children }) => <p className="text-zinc-300 leading-relaxed mb-3">{children}</p>,
            }}
          >
            {cleanedBody}
          </ReactMarkdown>
        </article>

        {/* Coluna lateral: metadata */}
        <aside className="space-y-3">
          {t.thumbnailUrl && (
            <Card className="overflow-hidden p-0">
              <img
                src={t.thumbnailUrl}
                alt=""
                className="w-full aspect-video object-cover"
                loading="lazy"
              />
            </Card>
          )}

          <Card>
            <CardContent className="pt-5 space-y-3 text-sm">
              <MetaRow Icon={Clock} label="Duração" value={formatDuration(t.durationSec)} />
              <MetaRow Icon={Languages} label="Idioma" value={t.language.toUpperCase()} />
              <MetaRow Icon={Calendar} label="Adicionado" value={formatDateTime(created)} />
              {published && (
                <MetaRow Icon={Calendar} label="Publicado em" value={formatDateTime(published)} />
              )}
              {t.model && <MetaRow Icon={FileText} label="Modelo" value={t.model} mono />}
              {t.costUsd && <MetaRow Icon={FileText} label="Custo" value={formatUsd(t.costUsd)} />}
            </CardContent>
          </Card>

          <Button variant="outline" size="sm" className="w-full" asChild>
            <a href={t.url} target="_blank" rel="noreferrer">
              Abrir vídeo original
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </aside>
      </div>
    </div>
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
      <Icon className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</p>
        <p className={mono ? 'text-xs font-mono text-zinc-200 truncate' : 'text-sm text-zinc-200'}>
          {value}
        </p>
      </div>
    </div>
  );
}
