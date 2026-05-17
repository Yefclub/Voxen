import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';

interface MarkdownProps {
  children: string;
  className?: string;
}

function CodeBlock({
  inline,
  className,
  children,
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const raw = String(children ?? '').replace(/\n$/, '');
  const lang = /language-([\w-]+)/.exec(className ?? '')?.[1];

  if (inline) {
    return (
      <code className="rounded bg-[var(--color-app-surface)] border border-[var(--color-app-border)] px-1.5 py-0.5 text-[0.85em] font-mono text-emerald-300">
        {children}
      </code>
    );
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-zinc-950/60">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-[var(--color-app-border)] bg-zinc-900/60">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-mono">
          {lang ?? 'código'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Copiar"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" /> Copiado
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copiar
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed font-mono text-zinc-200">
        <code>{raw}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({
  children,
  className,
}: MarkdownProps): React.ReactElement {
  return (
    <div
      className={cn(
        'text-[14.5px] leading-relaxed text-zinc-100',
        '[&>*+*]:mt-3',
        '[&_p]:leading-relaxed',
        '[&_strong]:text-zinc-50 [&_strong]:font-semibold',
        '[&_em]:text-zinc-200',
        '[&_a]:text-violet-300 [&_a]:underline [&_a]:decoration-violet-500/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-violet-300',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1',
        '[&_li]:leading-relaxed',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-violet-500/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[var(--color-app-subtle)]',
        '[&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-4',
        '[&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-4',
        '[&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mt-3',
        '[&_hr]:border-[var(--color-app-border)] [&_hr]:my-4',
        '[&_table]:w-full [&_table]:text-[13px] [&_table]:border-collapse',
        '[&_th]:text-left [&_th]:font-semibold [&_th]:text-zinc-200 [&_th]:border-b [&_th]:border-[var(--color-app-border-strong)] [&_th]:px-2 [&_th]:py-1.5',
        '[&_td]:border-b [&_td]:border-[var(--color-app-border)] [&_td]:px-2 [&_td]:py-1.5',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
