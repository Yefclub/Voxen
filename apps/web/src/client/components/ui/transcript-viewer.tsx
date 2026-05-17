import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

/**
 * Texto contínuo da transcrição. Cada segmento é um <a> clicável (abre o vídeo
 * no segundo exato) e mostra um tooltip com o timestamp ao passar o mouse.
 * O segmento inteiro é o gatilho de clique — usuário não precisa mirar no chip.
 */

interface Segment {
  startSec: number;
  text: string;
  link: string | null;
}

export function TranscriptViewer({ markdown }: { markdown: string }): React.ReactElement {
  const segments = useMemo(() => parseSegments(markdown), [markdown]);
  const [copied, setCopied] = useState(false);
  const plainText = useMemo(() => segments.map((s) => s.text).join(' '), [segments]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={300}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-200">
          Transcrição
        </h2>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors px-2.5 py-1.5 rounded-md border border-[var(--color-app-border)] hover:border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface)]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" /> Copiado
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copiar tudo
            </>
          )}
        </button>
      </div>
      <article className="prose-voxen">
        <p className="leading-[1.85] text-[15.5px] text-[var(--color-app-subtle)] text-pretty">
          {segments.map((seg, i) => (
            <SegmentSpan key={i} seg={seg} />
          ))}
        </p>
      </article>
    </TooltipProvider>
  );
}

function SegmentSpan({ seg }: { seg: Segment }): React.ReactElement {
  const content = (
    <span className="rounded-sm transition-colors duration-150 hover:bg-violet-500/[0.14] hover:text-zinc-100 focus:outline-none focus-visible:bg-violet-500/[0.18] focus-visible:text-zinc-100">
      {seg.text}
    </span>
  );
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {seg.link ? (
            <a
              href={seg.link}
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer no-underline text-inherit"
            >
              {content}
            </a>
          ) : (
            <span tabIndex={0} className="cursor-default">
              {content}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="p-0">
          {seg.link ? (
            <a
              href={seg.link}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tabular-nums text-violet-300 hover:text-violet-200 transition-colors"
            >
              {formatTimestamp(seg.startSec)}
              <ExternalLink className="h-3 w-3 opacity-70 group-hover:opacity-100 transition-opacity" />
            </a>
          ) : (
            <span className="inline-flex items-center px-3 py-1.5 text-xs font-mono tabular-nums text-[var(--color-app-muted)]">
              {formatTimestamp(seg.startSec)}
            </span>
          )}
        </TooltipContent>
      </Tooltip>{' '}
    </>
  );
}

function formatTimestamp(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function parseSegments(markdown: string): Segment[] {
  let body = markdown;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }
  body = body.replace(/^!\[thumbnail\][^\n]*\n+/, '');
  body = body.replace(/^#\s+[^\n]+\n+/, '');
  body = body.replace(/^>\s+[^\n]+\n+/, '');
  body = body.replace(/^##\s+Transcrição\s*\n+/m, '');

  const lines = body.split('\n').filter((l) => l.trim().length > 0);
  const segments: Segment[] = [];
  const lineRe = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\((https?:\/\/[^)]+)\)\s*(.*)$/;

  for (const line of lines) {
    const m = line.match(lineRe);
    if (m) {
      const [, ts, link, text] = m;
      const startSec = parseTimestamp(ts ?? '0');
      segments.push({ startSec, link: link ?? null, text: (text ?? '').trim() });
    } else if (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (last) last.text += ' ' + line.trim();
    } else {
      segments.push({ startSec: 0, link: null, text: line.trim() });
    }
  }
  return segments;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map((n) => parseInt(n, 10));
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0] ?? 0;
}
