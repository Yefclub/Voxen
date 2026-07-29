// SEGURANÇA: este renderer recebe conteúdo NÃO-CONFIÁVEL (respostas de
// modelo, transcrições de vídeos, resultados de tools). A postura segura
// depende do Streamdown SEM rehype-raw: HTML embutido fica escapado e
// URLs javascript:/data: são neutralizadas pelo urlTransform padrão.
// NÃO adicionar rehype-raw nem override de urlTransform sem sanitização.
//
// STREAMING: o Streamdown quebra o markdown em blocos memoizados — durante o
// streaming SSE do agente, só o bloco que mudou re-renderiza, então tabelas e
// blocos de código já completos não piscam/reflow. parseIncompleteMarkdown
// estabiliza sintaxe parcial (fences/links ainda abertos). Mermaid/KaTeX/Shiki
// são plugins opt-in e ficam DESLIGADOS (não passamos `plugins`) — bundle leve.
//
// ESTILO: o Streamdown traz componentes default com classes shadcn (border-border,
// bg-background) que não existem no design system do Voxen. Para garantir ZERO
// regressão visual, sobrescrevemos os elementos estruturais com tags simples e
// deixamos o tema zinc ser governado pelos seletores descendentes do wrapper.
import { memo, useEffect, useRef, useState } from 'react';
import { Streamdown, type Components, type ExtraProps } from 'streamdown';
import { Check, Copy } from '@/components/ui/icons';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';

interface MarkdownProps {
  children: string;
  className?: string;
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

  return (
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
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed font-mono text-[var(--color-app-subtle)]">
        <code>{raw}</code>
      </pre>
    </div>
  );
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
function Anchor({
  href,
  children,
}: React.ComponentPropsWithoutRef<'a'> & ExtraProps): React.ReactElement {
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
const components: Components = {
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
    <div className="my-4 overflow-x-auto rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]">
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
}: MarkdownProps): React.ReactElement {
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
      <Streamdown parseIncompleteMarkdown controls={false} components={components}>
        {children}
      </Streamdown>
    </div>
  );
});
