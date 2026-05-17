import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, MessagesSquare, Wand2 } from 'lucide-react';
import { Spinner } from '../components/ui/spinner';
import { AnimatedPage } from '../components/motion/animated-page';
import { cn } from '../lib/utils';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: { name: string; preview?: string }[];
}

const STORAGE_KEY = 'voxen:chat:messages';

export function ChatPage(): React.ReactElement {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Msg[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
    } catch {
      // ignora
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const asstId = `a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: asstId, role: 'assistant', content: '', tools: [] }]);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? { ...x, content: `⚠️ ${err.error ?? err.detail ?? 'Erro na requisição.'}` }
              : x,
          ),
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE: separa por \n\n
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!block) continue;
          const eventMatch = block.match(/^event:\s*(.+)$/m);
          const dataMatch = block.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1] ?? '{}') as Record<string, unknown>;

          if (event === 'token') {
            const text = (data.text as string) ?? '';
            setMessages((m) =>
              m.map((x) => (x.id === asstId ? { ...x, content: x.content + text } : x)),
            );
          } else if (event === 'tool_start') {
            const name = (data.name as string) ?? '';
            setMessages((m) =>
              m.map((x) => (x.id === asstId ? { ...x, tools: [...(x.tools ?? []), { name }] } : x)),
            );
          } else if (event === 'tool_end') {
            const name = (data.name as string) ?? '';
            const preview = (data.preview as string) ?? '';
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId
                  ? {
                      ...x,
                      tools: (x.tools ?? []).map((t, i, arr) =>
                        i === arr.length - 1 && t.name === name ? { ...t, preview } : t,
                      ),
                    }
                  : x,
              ),
            );
          } else if (event === 'error') {
            const msg = (data.message as string) ?? 'Erro inesperado.';
            setMessages((m) =>
              m.map((x) => (x.id === asstId ? { ...x, content: x.content + `\n\n⚠️ ${msg}` } : x)),
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha de conexão.';
      setMessages((m) =>
        m.map((x) => (x.id === asstId ? { ...x, content: x.content + `\n\n⚠️ ${msg}` } : x)),
      );
    } finally {
      setStreaming(false);
    }
  }

  function clear(): void {
    setMessages([]);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <AnimatedPage>
      <div className="flex flex-col h-[calc(100vh-4rem)] mx-auto max-w-3xl px-6 py-6">
        <header className="flex items-end justify-between gap-4 mb-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
              <MessagesSquare className="h-3.5 w-3.5 text-violet-400" />
              Conversar
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
              Pergunte ao acervo
            </h1>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="text-xs text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors"
            >
              Limpar conversa
            </button>
          )}
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-4 pr-2 -mr-2 mb-4 scroll-smooth"
        >
          {messages.length === 0 && <EmptyState onPick={(s) => setInput(s)} />}

          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Bubble msg={m} streaming={streaming && m.role === 'assistant' && !m.content} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="relative"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Pergunte algo sobre seus vídeos…"
            rows={2}
            className="w-full resize-none rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/70 backdrop-blur-sm px-4 py-3.5 pr-14 text-[15px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15 transition-colors leading-relaxed"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || input.trim().length === 0}
            className={cn(
              'absolute right-3 bottom-3 h-9 w-9 rounded-lg flex items-center justify-center transition-all',
              streaming || input.trim().length === 0
                ? 'bg-[var(--color-app-surface)] text-[var(--color-app-muted)] cursor-not-allowed'
                : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 active:scale-95',
            )}
            aria-label="Enviar"
          >
            {streaming ? <Spinner /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
          </button>
        </form>
        <p className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] mt-2 text-center">
          Enter para enviar · Shift+Enter para quebrar linha
        </p>
      </div>
    </AnimatedPage>
  );
}

function Bubble({ msg, streaming }: { msg: Msg; streaming: boolean }): React.ReactElement {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold uppercase tracking-wider mt-0.5',
          isUser
            ? 'bg-zinc-100 text-zinc-900'
            : 'bg-gradient-to-br from-emerald-500/40 to-violet-500/40 text-zinc-100 border border-[var(--color-app-border-strong)]',
        )}
      >
        {isUser ? 'Você' : 'V'}
      </div>
      <div
        className={cn(
          'flex flex-col gap-2 min-w-0 max-w-[80%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {/* Tools usadas */}
        {!isUser && msg.tools && msg.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.tools.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-mono text-violet-300"
                title={t.preview ?? ''}
              >
                <Wand2 className="h-2.5 w-2.5" />
                {t.name}
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap',
            isUser
              ? 'bg-zinc-100 text-zinc-900'
              : 'bg-[var(--color-app-surface)] border border-[var(--color-app-border)] text-zinc-100',
          )}
        >
          {streaming && !msg.content ? (
            <span className="inline-flex items-center gap-2 text-[var(--color-app-muted)]">
              <Spinner /> Pensando…
            </span>
          ) : (
            msg.content
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }): React.ReactElement {
  const suggestions = [
    'O que tem no meu acervo?',
    'Resuma o vídeo mais recente que adicionei.',
    'Procure por “produtividade” nos meus vídeos.',
    'Quais são as principais ideias dos últimos 3 vídeos?',
  ];
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-6">
      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
        <MessagesSquare className="h-5 w-5 text-violet-400" />
      </div>
      <div className="space-y-1.5 max-w-md">
        <p className="font-display text-lg font-semibold tracking-tight">Pergunte qualquer coisa</p>
        <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
          O agente consulta suas transcrições usando 5 tools determinísticas. Sem alucinação, tudo
          com fonte e timestamp.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-left text-xs px-3 py-2.5 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/40 text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface)] hover:border-[var(--color-app-border-strong)] hover:text-zinc-100 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
