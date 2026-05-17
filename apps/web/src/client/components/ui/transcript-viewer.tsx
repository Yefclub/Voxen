import { useMemo, useState, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink } from 'lucide-react';

/**
 * Renderiza a transcrição como texto contínuo (justified prose). Cada segmento
 * vira um <span> que mostra um tooltip flutuante com a minutagem clicável
 * ao passar o mouse. Sem timestamps poluindo o corpo, sem links inline.
 */

interface Segment {
  startSec: number;
  text: string;
  link: string | null;
}

export function TranscriptViewer({ markdown }: { markdown: string }): React.ReactElement {
  const segments = useMemo(() => parseSegments(markdown), [markdown]);
  return (
    <div className="prose-voxen relative">
      <p className="leading-[1.85] text-[15.5px] text-[var(--color-app-subtle)] text-pretty">
        {segments.map((seg, i) => (
          <SegmentSpan key={i} seg={seg} />
        ))}
      </p>
    </div>
  );
}

function SegmentSpan({ seg }: { seg: Segment }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.top - 8 + window.scrollY,
    });
  }, [open]);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        className="relative cursor-default rounded-sm transition-colors duration-150 hover:bg-violet-500/[0.12] hover:text-zinc-100 focus:outline-none focus:bg-violet-500/[0.18] focus:text-zinc-100"
      >
        {seg.text}
      </span>{' '}
      <AnimatePresence>
        {open && pos && (
          <TooltipPortal>
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                transform: 'translate(-50%, -100%)',
                pointerEvents: seg.link ? 'auto' : 'none',
                zIndex: 100,
              }}
            >
              {seg.link ? (
                <a
                  href={seg.link}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-2 rounded-lg border border-violet-400/40 bg-zinc-950/95 backdrop-blur-md px-3 py-1.5 text-xs font-mono tabular-nums text-violet-300 hover:text-violet-200 hover:border-violet-300/70 shadow-lg shadow-black/40 transition-colors"
                  onMouseEnter={() => setOpen(true)}
                  onMouseLeave={() => setOpen(false)}
                >
                  {formatTimestamp(seg.startSec)}
                  <ExternalLink className="h-3 w-3 opacity-70 group-hover:opacity-100 transition-opacity" />
                </a>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-app-border-strong)] bg-zinc-950/95 backdrop-blur-md px-3 py-1.5 text-xs font-mono tabular-nums text-[var(--color-app-muted)] shadow-lg shadow-black/40">
                  {formatTimestamp(seg.startSec)}
                </span>
              )}
              <span
                aria-hidden
                className="block w-2 h-2 mx-auto -mt-1 rotate-45 bg-zinc-950/95 border-r border-b border-[var(--color-app-border-strong)]"
              />
            </motion.div>
          </TooltipPortal>
        )}
      </AnimatePresence>
    </>
  );
}

function TooltipPortal({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
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

/**
 * Parser do .md no formato canônico:
 *   [hh:mm:ss](https://youtu.be/<id>?t=<sec>) texto livre...
 *
 * Em cada linha que começa com `[`, extraímos timestamp e link, e juntamos
 * o texto até a próxima linha que também começa com `[`.
 */
function parseSegments(markdown: string): Segment[] {
  // Tira frontmatter
  let body = markdown;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }
  // Tira cabeçalho duplicado (![thumbnail], #title, > meta, ## Transcrição)
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
      // Linha de continuação (texto sem timestamp) — anexa ao último segmento
      const last = segments[segments.length - 1];
      if (last) last.text += ' ' + line.trim();
    } else {
      // Antes de qualquer timestamp — provavelmente cabeçalho não-removido
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
