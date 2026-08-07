import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, NotebookPen } from '@/components/ui/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { useI18n } from '../../lib/i18n';
import { resolveTranscriptCitationRange } from '../../lib/transcript-citation-anchor';

/**
 * Texto contínuo da transcrição. Cada segmento é um <a> clicável (abre o vídeo
 * no segundo exato) e mostra um tooltip com o timestamp ao passar o mouse.
 * O segmento inteiro é o gatilho de clique — usuário não precisa mirar no chip.
 */

interface Segment {
  startSec: number;
  text: string;
  link: string | null;
  line: number;
}

export interface TranscriptAnchorSelection {
  startLine: number;
  endLine: number;
  startSec: number;
  endSec: number;
  selectedQuote: string;
}

export function TranscriptViewer({
  markdown,
  onCreateAnnotation,
}: {
  markdown: string;
  onCreateAnnotation?: (selection: TranscriptAnchorSelection) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const segments = useMemo(() => parseSegments(markdown), [markdown]);
  const [anchor, setAnchor] = useState(() => window.location.hash);
  const citationRange = useMemo(
    () => resolveTranscriptCitationRange(segments, anchor),
    [anchor, segments],
  );
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plainText = useMemo(() => segments.map((s) => s.text).join(' '), [segments]);
  const articleRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<TranscriptAnchorSelection | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    const updateAnchor = () => setAnchor(window.location.hash);
    window.addEventListener('hashchange', updateAnchor);
    updateAnchor();
    return () => window.removeEventListener('hashchange', updateAnchor);
  }, []);

  useEffect(() => {
    if (citationRange !== null) {
      document
        .getElementById(`citation-l-${citationRange.startLine}`)
        ?.scrollIntoView({ block: 'center' });
    }
  }, [citationRange]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  function captureSelection(): void {
    if (!onCreateAnnotation || !articleRef.current) return;
    const selected = window.getSelection();
    const quote = selected?.toString().trim() ?? '';
    if (!selected || selected.rangeCount === 0 || !quote) {
      setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) return;
    const startElement = closestSegment(range.startContainer);
    const endElement = closestSegment(range.endContainer);
    if (!startElement || !endElement) return;
    const startLine = Number(startElement.dataset.transcriptLine);
    const endLine = Number(endElement.dataset.transcriptLine);
    const startSec = Number(startElement.dataset.transcriptSec);
    const endSec = Number(endElement.dataset.transcriptSec);
    if (![startLine, endLine, startSec, endSec].every(Number.isFinite)) return;
    setSelection({
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
      startSec: Math.min(startSec, endSec),
      endSec: Math.max(startSec, endSec),
      selectedQuote: quote.slice(0, 20_000),
    });
  }

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={300}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--color-app-subtle)]">
          {t('transcript.title')}
        </h2>
        <div className="flex items-center gap-2">
          {selection && onCreateAnnotation && (
            <button
              type="button"
              onClick={() => onCreateAnnotation(selection)}
              className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/15"
            >
              <NotebookPen className="h-3 w-3" />
              {t('transcript.annotateSelection')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] transition-colors px-2.5 py-1.5 rounded-md border border-[var(--color-app-border)] hover:border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface)]"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" /> {t('common.copied')}
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> {t('transcript.copyAll')}
              </>
            )}
          </button>
        </div>
      </div>
      <article
        ref={articleRef}
        className="prose-voxen"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        <p className="leading-[1.85] text-[15.5px] text-[var(--color-app-subtle)] text-pretty break-words">
          {segments.map((seg, i) => (
            <SegmentSpan
              key={i}
              seg={seg}
              highlighted={
                citationRange !== null &&
                seg.line >= citationRange.startLine &&
                seg.line <= citationRange.endLine
              }
            />
          ))}
        </p>
      </article>
    </TooltipProvider>
  );
}

function SegmentSpan({
  seg,
  highlighted,
}: {
  seg: Segment;
  highlighted: boolean;
}): React.ReactElement {
  const content = (
    <span
      id={`citation-l-${seg.line}`}
      data-transcript-line={seg.line}
      data-transcript-sec={seg.startSec}
      className={`rounded-sm transition-colors duration-150 hover:bg-violet-500/[0.14] hover:text-[var(--color-app-fg)] focus:outline-none focus-visible:bg-violet-500/[0.18] focus-visible:text-[var(--color-app-fg)]${highlighted ? ' bg-emerald-500/20 text-[var(--color-app-fg)]' : ''}`}
    >
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

function closestSegment(node: Node): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>('[data-transcript-line]') ?? null;
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
  const lines = markdown.split('\n');
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end >= 0) start = end + 1;
  }
  while (start < lines.length) {
    const line = lines[start]?.trim() ?? '';
    if (
      !line ||
      /^!\[thumbnail\]/.test(line) ||
      /^#\s+/.test(line) ||
      /^>\s+/.test(line) ||
      /^##\s+(Transcrição|Transcript)\s*$/i.test(line)
    ) {
      start++;
      continue;
    }
    break;
  }
  const segments: Segment[] = [];
  const lineRe = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\](?:\((https?:\/\/[^)]+)\))?\s*(.*)$/;

  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (!line.trim()) continue;
    const m = line.match(lineRe);
    if (m) {
      const [, ts, link, text] = m;
      const startSec = parseTimestamp(ts ?? '0');
      segments.push({ startSec, link: link ?? null, text: (text ?? '').trim(), line: index + 1 });
    } else if (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (last) last.text += ' ' + line.trim();
    } else {
      segments.push({ startSec: 0, link: null, text: line.trim(), line: index + 1 });
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
