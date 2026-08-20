// SEGURANÇA: este renderer recebe conteúdo NÃO-CONFIÁVEL (respostas de
// modelo, transcrições de vídeos, resultados de tools). A postura segura
// depende do Streamdown SEM rehype-raw: HTML embutido fica escapado e
// URLs javascript:/data: são neutralizadas pelo urlTransform padrão.
// NÃO adicionar rehype-raw nem override de urlTransform sem sanitização.
//
// STREAMING: o Streamdown quebra o markdown em blocos memoizados — durante o
// streaming SSE do agente, só o bloco que mudou re-renderiza, então tabelas e
// blocos de código já completos não piscam/reflow. parseIncompleteMarkdown
// stabilizes partial syntax (open fences/links). Mermaid is loaded on demand
// only for complete, validated fences; KaTeX/Shiki remain disabled.
//
// ESTILO: o Streamdown traz componentes default com classes shadcn (border-border,
// bg-background) que não existem no design system do Voxen. Para garantir ZERO
// regressão visual, sobrescrevemos os elementos estruturais com tags simples e
// deixamos o tema zinc ser governado pelos seletores descendentes do wrapper.
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown, type Components, type ExtraProps } from 'streamdown';
import { Check, Copy, Loader2, Workflow } from '@/components/ui/icons';
import type { ChatCitation } from '../../../shared/chat-citations';
import { hasUnsafeMermaidCssUrl, validateMermaidFlow } from '../../../shared/mermaid-flow';
import { citationFromInlineHref, renderInlineCitations } from '../../lib/chat-inline-citations';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-provider';
import { isDarkTheme, type AppTheme } from '../../lib/theme';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { MermaidCanvas } from './mermaid-canvas';

interface MarkdownProps {
  children: string;
  className?: string;
  citations?: readonly ChatCitation[];
  onCitationOpen?: (citation: ChatCitation) => void;
}

type ChatCitationContextValue = {
  citations: readonly ChatCitation[];
  onCitationOpen?: (citation: ChatCitation) => void;
};

const ChatCitationContext = createContext<ChatCitationContextValue>({ citations: [] });
let mermaidRenderQueue: Promise<void> = Promise.resolve();
let mermaidRenderSequence = 0;

function renderMermaid(code: string, theme: AppTheme): Promise<string> {
  const task = mermaidRenderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: isDarkTheme(theme) ? 'dark' : 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    mermaidRenderSequence += 1;
    const rendered = await mermaid.render(`voxen-mermaid-${mermaidRenderSequence}`, code);
    return rendered.svg;
  });
  mermaidRenderQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function assertSafeMermaidSvg(svg: string): string {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = documentNode.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || documentNode.querySelector('parsererror')) {
    throw new Error('MERMAID_SVG_INVALID');
  }
  if (documentNode.querySelector('script, foreignObject, iframe, image, a, object, embed')) {
    throw new Error('MERMAID_SVG_ACTIVE_CONTENT');
  }
  for (const element of Array.from(documentNode.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'src') throw new Error('MERMAID_SVG_ACTIVE_CONTENT');
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) {
        throw new Error('MERMAID_SVG_EXTERNAL_REFERENCE');
      }
      if (name === 'style' && hasUnsafeMermaidCssUrl(value)) {
        throw new Error('MERMAID_SVG_EXTERNAL_REFERENCE');
      }
    }
    if (
      element.nodeName.toLowerCase() === 'style' &&
      (/@import/i.test(element.textContent ?? '') ||
        hasUnsafeMermaidCssUrl(element.textContent ?? ''))
    ) {
      throw new Error('MERMAID_SVG_EXTERNAL_REFERENCE');
    }
  }
  return svg;
}

function MermaidDiagram({ source, fallback }: { source: string; fallback: React.ReactNode }) {
  const validation = useMemo(() => validateMermaidFlow(source), [source]);
  const { theme } = useTheme();
  const { t } = useI18n();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(!validation.ok);

  useEffect(() => {
    if (!validation.ok) {
      setFailed(true);
      setSvg(null);
      return;
    }
    let active = true;
    setFailed(false);
    setSvg(null);
    void renderMermaid(validation.code, theme)
      .then(assertSafeMermaidSvg)
      .then((nextSvg) => {
        if (active) setSvg(nextSvg);
      })
      .catch((error: unknown) => {
        const errorCode =
          error instanceof Error && /^MERMAID_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'MERMAID_RENDER_FAILED';
        console.warn('[markdown] Mermaid render unavailable', { error_code: errorCode });
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [theme, validation]);

  if (failed) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs text-[var(--color-app-warning-fg)]">
          <Workflow className="h-3.5 w-3.5" /> {t('markdown.diagramUnavailable')}
        </p>
        {fallback}
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="my-3 flex min-h-40 items-center justify-center rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-xs text-[var(--color-app-muted)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('markdown.diagramLoading')}
      </div>
    );
  }
  return <MermaidCanvas label={t('markdown.diagramLabel')} sanitizedSvg={svg} />;
}

// Bloco de código fenced (```...```). O Streamdown só roteia fences para `code`
// (inline vai para `inlineCode`), então aqui sempre renderizamos o bloco rico.
function CodeBlock({
  className,
  children,
}: React.ComponentPropsWithoutRef<'code'> & ExtraProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useI18n();
  const raw = String(children ?? '').replace(/\n$/, '');
  const lang = /language-([\w-]+)/.exec(className ?? '')?.[1];

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  const codeFrame = (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-[var(--color-app-border)] bg-[var(--color-app-surface)]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-mono">
          {lang ?? t('markdown.code')}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] transition-colors opacity-0 group-hover:opacity-100"
          aria-label={t('common.copy')}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" /> {t('common.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> {t('common.copy')}
            </>
          )}
        </button>
      </div>
      <pre
        data-horizontal-scroll="true"
        data-drawer-gesture-ignore
        className="touch-pan-x touch-pan-y overflow-x-auto px-4 py-3 text-[13px] leading-relaxed font-mono text-[var(--color-app-subtle)]"
      >
        <code>{raw}</code>
      </pre>
    </div>
  );
  if (lang?.toLowerCase() === 'mermaid') {
    return <MermaidDiagram source={raw} fallback={codeFrame} />;
  }
  return codeFrame;
}

// Código inline (`código`). Quiet — same weight as body text (spec 091).
function InlineCode({
  children,
}: React.ComponentPropsWithoutRef<'code'> & ExtraProps): React.ReactElement {
  return (
    <code className="rounded px-1 py-0.5 text-[0.92em] font-mono text-[var(--color-app-subtle)] bg-[var(--color-app-surface)]/50">
      {children}
    </code>
  );
}

// Links externos: nova aba + rel seguro. O Streamdown já harden-iza a URL.
function InlineCitation({
  citation,
  children,
  onOpen,
}: {
  citation: ChatCitation;
  children: React.ReactNode;
  onOpen?: (citation: ChatCitation) => void;
}) {
  const external = citation.sourceType === 'WEB';
  const className =
    'mx-0.5 inline-flex -translate-y-px items-center rounded-full bg-[var(--color-app-surface)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--color-app-muted)] no-underline transition-colors hover:bg-[var(--color-accent-primary)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onOpen && !external ? (
          <button
            type="button"
            className={className}
            onClick={() => onOpen(citation)}
            aria-label={citation.title}
          >
            {children}
          </button>
        ) : (
          <a
            href={citation.href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className={className}
          >
            {children}
          </a>
        )}
      </TooltipTrigger>
      <TooltipContent className="w-80 p-3" side="bottom" align="start">
        <p className="truncate text-xs font-medium text-[var(--color-app-fg)]">{citation.title}</p>
        <blockquote className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-[var(--color-app-muted)]">
          “{citation.quote}”
        </blockquote>
      </TooltipContent>
    </Tooltip>
  );
}

function Anchor({
  href,
  children,
}: React.ComponentPropsWithoutRef<'a'> & ExtraProps): React.ReactElement {
  const { citations, onCitationOpen } = useContext(ChatCitationContext);
  const citation = citationFromInlineHref(href, citations);
  if (citation)
    return (
      <InlineCitation citation={citation} onOpen={onCitationOpen}>
        {children}
      </InlineCitation>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--color-app-subtle)] underline decoration-[var(--color-app-border-strong)] underline-offset-2 transition-colors hover:text-[var(--color-app-fg)] hover:decoration-[var(--color-app-muted)]"
    >
      {children}
    </a>
  );
}

// Helper: extrai apenas `children`, descartando props (className/style shadcn,
// `node` do hast) que o Streamdown injetaria com classes fora do tema.
function kids(p: { children?: React.ReactNode }): React.ReactNode {
  return p.children;
}

// Componentes estruturais sobrescritos com tags simples para neutralizar as
// classes shadcn default do Streamdown — o tema zinc vem do wrapper.
const structuralComponents: Components = {
  code: CodeBlock,
  inlineCode: InlineCode,
  a: Anchor,
  p: (p) => <p>{kids(p)}</p>,
  ul: (p) => <ul>{kids(p)}</ul>,
  ol: (p) => <ol>{kids(p)}</ol>,
  li: (p) => <li>{kids(p)}</li>,
  blockquote: (p) => <blockquote>{kids(p)}</blockquote>,
  h1: (p) => <h1>{kids(p)}</h1>,
  h2: (p) => <h2>{kids(p)}</h2>,
  h3: (p) => <h3>{kids(p)}</h3>,
  h4: (p) => <h4>{kids(p)}</h4>,
  h5: (p) => <h5>{kids(p)}</h5>,
  h6: (p) => <h6>{kids(p)}</h6>,
  hr: () => <hr />,
  strong: (p) => <strong>{kids(p)}</strong>,
  em: (p) => <em>{kids(p)}</em>,
  // Wrapper com scroll-x: sob `overflow-x: clip` global, tabela larga seria
  // cortada no mobile em vez de rolar.
  table: (p) => (
    <div
      data-horizontal-scroll="true"
      data-drawer-gesture-ignore
      className="my-4 touch-pan-x touch-pan-y overflow-x-auto rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]"
    >
      <table>{kids(p)}</table>
    </div>
  ),
  thead: (p) => <thead>{kids(p)}</thead>,
  tbody: (p) => <tbody>{kids(p)}</tbody>,
  tr: (p) => <tr>{kids(p)}</tr>,
  th: (p) => <th>{kids(p)}</th>,
  td: (p) => <td>{kids(p)}</td>,
};

export const Markdown = memo(function Markdown({
  children,
  className,
  citations = [],
  onCitationOpen,
}: MarkdownProps): React.ReactElement {
  const content = useMemo(() => renderInlineCitations(children, citations), [children, citations]);
  const citationContext = useMemo(
    () => ({ citations, onCitationOpen }),
    [citations, onCitationOpen],
  );
  return (
    <div
      className={cn(
        // break-words: URLs/tokens longos sem espaço estouram a bolha no mobile
        // (sob `overflow-x: clip` global) — força quebra em vez de corte.
        'text-[14.5px] leading-relaxed text-[var(--color-app-fg)] break-words',
        '[&_p+p]:mt-3 [&_p+ul]:mt-3 [&_p+ol]:mt-3 [&_ul+p]:mt-3 [&_ol+p]:mt-3',
        '[&_p]:leading-relaxed',
        '[&_strong]:text-[var(--color-app-fg)] [&_strong]:font-medium',
        '[&_em]:text-[var(--color-app-subtle)]',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1',
        '[&_li]:leading-relaxed',
        '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-app-border-strong)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[var(--color-app-subtle)]',
        '[&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-4',
        '[&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-4',
        '[&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mt-3',
        '[&_hr]:border-[var(--color-app-border)] [&_hr]:my-4',
        '[&_table]:w-full [&_table]:min-w-[520px] [&_table]:text-[13px] [&_table]:border-collapse',
        '[&_thead]:bg-[var(--color-app-bg-elevated)]',
        '[&_tbody_tr:nth-child(even)]:bg-[var(--color-app-bg-elevated)]/35',
        '[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-[var(--color-app-surface-hover)]/70',
        '[&_th]:whitespace-nowrap [&_th]:text-left [&_th]:text-[11px] [&_th]:uppercase [&_th]:tracking-[0.1em] [&_th]:font-medium [&_th]:text-[var(--color-app-muted)] [&_th]:border-b [&_th]:border-[var(--color-app-border-strong)] [&_th]:px-3.5 [&_th]:py-2.5',
        '[&_td]:align-top [&_td]:border-b [&_td]:border-[var(--color-app-border)] [&_td]:px-3.5 [&_td]:py-2.5 [&_td]:text-[var(--color-app-subtle)]',
        '[&_tbody_tr:last-child_td]:border-b-0',
        className,
      )}
    >
      <TooltipProvider delayDuration={120} skipDelayDuration={300} disableHoverableContent>
        <ChatCitationContext.Provider value={citationContext}>
          <Streamdown parseIncompleteMarkdown controls={false} components={structuralComponents}>
            {content}
          </Streamdown>
        </ChatCitationContext.Provider>
      </TooltipProvider>
    </div>
  );
});
