import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Globe, Library, Loader2, Search, X } from 'lucide-react';
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
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  url: string;
  title: string;
  channel: string | null;
  durationSec: number;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES' | 'SCRAPE' | 'VISION' | 'DOCUMENT';
  thumbnailUrl: string | null;
  costUsd: string | null;
  createdAt: string;
  snippet?: string;
}

interface SearchResponse {
  transcripts: TranscriptSummary[];
  query: string;
}

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function TranscricoesPage(): React.ReactElement {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 250);
  const url = useMemo(
    () => `/api/transcripts${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ''}`,
    [debouncedQ],
  );
  const { data, loading } = useFetch<SearchResponse>(url);
  const transcripts = data?.transcripts ?? [];
  const isSearching = debouncedQ.length > 0;
  const queryChanging = q !== debouncedQ;

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Library className="h-3.5 w-3.5 text-violet-400" />
            Biblioteca
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Transcrições</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Busque por palavras-chave em todas as transcrições. Indexação full-text em português,
            ordenada por relevância.
          </p>
        </header>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-app-muted)] pointer-events-none z-10" />
          {/* type="text" em vez de "search" — o type=search injeta um botão
              nativo de clear no Chrome/Safari que sobrepõe a lupa após digitar.
              Mantemos UX equivalente com nosso próprio botão (X à direita). */}
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nas transcrições…"
            autoComplete="off"
            spellCheck={false}
            className="w-full h-12 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/60 backdrop-blur-sm pl-11 pr-12 text-[15px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15 transition-colors"
          />
          {q.length > 0 && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface-hover)] transition-colors"
              aria-label="Limpar busca"
            >
              {queryChanging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        {isSearching && !loading && (
          <p className="text-xs text-[var(--color-app-muted)] -mt-6">
            <span className="tabular-nums">{transcripts.length}</span>{' '}
            {transcripts.length === 1 ? 'resultado' : 'resultados'} para “
            <span className="text-zinc-200">{debouncedQ}</span>”
          </p>
        )}

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
                <p className="font-display text-lg font-semibold tracking-tight">
                  {isSearching ? 'Nada encontrado' : 'Biblioteca vazia'}
                </p>
                <p className="text-sm text-[var(--color-app-muted)]">
                  {isSearching
                    ? 'Tente outras palavras-chave.'
                    : 'Suas transcrições aparecerão aqui.'}
                </p>
              </div>
              {!isSearching && (
                <Button variant="primary" size="lg" asChild className="mt-3">
                  <Link to="/jobs">Adicionar primeiro conteúdo</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && transcripts.length > 0 && (
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {transcripts.map((t) => (
              <StaggerItem key={t.id}>
                <TranscriptCard t={t} highlightQuery={debouncedQ} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </AnimatedPage>
  );
}

function TranscriptCard({
  t,
  highlightQuery,
}: {
  t: TranscriptSummary;
  highlightQuery: string;
}): React.ReactElement {
  const isVisualTranscript = t.transcriptionMethod === 'VISION';
  const isDocumentTranscript = t.transcriptionMethod === 'DOCUMENT';
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
      <Link
        to={`/transcricoes/${t.id}`}
        className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 rounded-2xl"
      >
        <Card
          hoverable
          elevated
          className="h-full overflow-hidden p-0 transition-colors duration-200"
        >
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
                {isDocumentTranscript ? (
                  <FileText className="h-10 w-10 text-zinc-600" />
                ) : t.source === 'WEB' || isVisualTranscript ? (
                  <Globe className="h-10 w-10 text-zinc-600" />
                ) : (
                  <span className="font-display text-5xl font-semibold text-zinc-700 tracking-tight">
                    {t.title[0]?.toUpperCase()}
                  </span>
                )}
              </div>
            )}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent"
            />
            {t.source !== 'WEB' && !isVisualTranscript && !isDocumentTranscript && (
              <div className="absolute bottom-2 right-2">
                <Badge
                  variant="default"
                  className="bg-black/60 backdrop-blur-sm border-white/10 text-[10px] tabular-nums"
                >
                  {formatDuration(t.durationSec)}
                </Badge>
              </div>
            )}
          </div>

          <CardContent className="pt-4 pb-5 space-y-3">
            <div>
              <h3 className="text-[15px] font-semibold leading-snug tracking-tight line-clamp-2 group-hover:text-violet-300 transition-colors font-display">
                {highlightInText(t.title, highlightQuery)}
              </h3>
              {t.channel && (
                <p className="text-xs text-[var(--color-app-muted)] mt-1.5 truncate">{t.channel}</p>
              )}
            </div>

            {t.snippet && (
              <p className="text-xs text-[var(--color-app-subtle)] leading-relaxed line-clamp-3">
                {renderSnippet(t.snippet)}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {/* Source primário — diferencia Vídeo / Web e plataforma */}
              <Badge variant={t.source === 'WEB' ? 'muted' : 'success'} className="text-[10px]">
                {t.source === 'WEB' && <Globe className="h-2.5 w-2.5" />}
                {displaySource(t.source)}
              </Badge>
              {/* Método (só faz sentido pra vídeos) */}
              {t.source !== 'WEB' && (
                <Badge
                  variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
                  className="text-[10px]"
                >
                  {displayMethod(t.transcriptionMethod)}
                </Badge>
              )}
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

function displaySource(source: TranscriptSummary['source']): string {
  switch (source) {
    case 'YOUTUBE':
      return 'YouTube';
    case 'INSTAGRAM':
      return 'Instagram';
    case 'TIKTOK':
      return 'TikTok';
    case 'X':
      return 'X';
    case 'WEB':
      return 'Página web';
    case 'UPLOAD':
      return 'Upload';
  }
}

function displayMethod(method: TranscriptSummary['transcriptionMethod']): string {
  switch (method) {
    case 'SUBTITLES':
      return 'Legendas';
    case 'VISION':
      return 'Imagem';
    case 'DOCUMENT':
      return 'Documento';
    case 'SCRAPE':
      return 'Web';
    case 'API':
      return 'IA';
  }
}

function highlightInText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    new RegExp(`^(${tokens.map(escapeRegex).join('|')})$`, 'i').test(p) ? (
      <mark key={i} className="bg-violet-500/20 text-violet-200 rounded-sm px-0.5 -mx-0.5">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function renderSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(«[^»]*»)/g);
  return parts.map((p, i) => {
    if (p.startsWith('«') && p.endsWith('»')) {
      return (
        <mark key={i} className="bg-violet-500/20 text-violet-200 rounded-sm px-0.5">
          {p.slice(1, -1)}
        </mark>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { JobStatus };
