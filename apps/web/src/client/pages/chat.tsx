import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleStop,
  LoaderCircle,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { play, setEnabled } from 'cuelume';
import { Markdown } from '../components/ui/markdown';
import { apiGet, apiPost } from '../lib/api';
import { cn } from '../lib/utils';

type ToolState = 'running' | 'completed' | 'error' | 'approval-required';
type ToolEvent = {
  id: string;
  name: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
};
type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  kind: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
  content: string;
  tools: ToolEvent[] | null;
  compactedAt: string | null;
  createdAt: string;
};
type Snapshot = { conversation: { id: string; compactionCount: number }; messages: ChatMessage[] };
type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; tool: ToolEvent }
  | { type: 'status'; label: string }
  | { type: 'compaction'; before: number; after: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done'; messageId: string };

function toolSummary(value: unknown): string {
  if (Array.isArray(value))
    return `${value.length} resultado${value.length === 1 ? '' : 's'} encontrado${value.length === 1 ? '' : 's'}.`;
  if (!value || typeof value !== 'object')
    return value == null ? 'Concluída sem resultados.' : String(value).slice(0, 280);
  const result = value as Record<string, unknown>;
  if (typeof result.error === 'string') return result.error.slice(0, 280);
  if (typeof result.title === 'string') return result.title.slice(0, 280);
  return 'Consulta concluída. Os resultados foram usados na resposta.';
}

function approvalId(tool: ToolEvent): string | null {
  if (!tool.output || typeof tool.output !== 'object') return null;
  const value = tool.output as Record<string, unknown>;
  return value.approvalRequired === true && typeof value.approvalId === 'string'
    ? value.approvalId
    : null;
}

function ToolCard({
  tool,
  onApprove,
}: {
  tool: ToolEvent;
  onApprove: (id: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(tool.state !== 'completed');
  const pendingApproval = approvalId(tool);
  const stateLabel: Record<ToolState, string> = {
    running: 'Executando',
    completed: 'Concluída',
    error: 'Falhou',
    'approval-required': 'Aguardando confirmação',
  };
  return (
    <section className="my-3 overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/65">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md',
            tool.state === 'error'
              ? 'bg-rose-500/15 text-rose-300'
              : 'bg-emerald-500/10 text-emerald-300',
          )}
        >
          {tool.state === 'running' ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wrench className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
          {tool.name.replaceAll('_', ' ')}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-app-muted)]">
          {stateLabel[tool.state]}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--color-app-border)] px-3 py-3">
          {tool.input !== undefined && (
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
              Parâmetros recebidos com segurança.
            </p>
          )}
          {pendingApproval ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
              <p className="text-xs leading-relaxed text-amber-100">
                Esta ação altera sua base. Confirme antes de executá-la.
              </p>
              <button
                type="button"
                onClick={() => onApprove(pendingApproval)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-2.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-300"
              >
                <Check className="h-3.5 w-3.5" /> Confirmar
              </button>
            </div>
          ) : tool.output !== undefined ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-app-muted)]">
              {toolSummary(tool.output)}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function ChatPage(): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) => message.compactedAt === null && message.kind !== 'COMPACTION_SUMMARY',
      ),
    [messages],
  );

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const snapshot = await apiGet<Snapshot>('/api/chat');
      setMessages(snapshot.messages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar o chat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const enabled = window.localStorage.getItem('voxen.chat.sounds') === 'true';
    setSoundsEnabled(enabled);
    setEnabled(enabled);
  }, []);

  useEffect(() => {
    if (nearBottom)
      scrollerRef.current?.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: streaming ? 'auto' : 'smooth',
      });
  }, [messages, nearBottom, streaming]);

  function onScroll(): void {
    const element = scrollerRef.current;
    if (!element) return;
    setNearBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 96);
  }

  async function approve(id: string): Promise<void> {
    try {
      const result = await apiPost<{ message: string }>('/api/chat/approve', { approvalId: id });
      toast.success(result.message);
      if (soundsEnabled) play('success');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a ação.');
    }
  }

  async function send(): Promise<void> {
    const content = input.trim();
    if (!content || streaming) return;
    const localUser: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: 'USER',
      kind: 'NORMAL',
      content,
      tools: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
    };
    const localAssistant: ChatMessage = {
      id: `local-assistant-${crypto.randomUUID()}`,
      role: 'ASSISTANT',
      kind: 'NORMAL',
      content: '',
      tools: [],
      compactedAt: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, localUser, localAssistant]);
    setInput('');
    setStreaming(true);
    setStatus('Pensando…');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('Não foi possível iniciar a resposta.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const apply = (event: StreamEvent): void => {
        if (event.type === 'text') {
          setMessages((current) =>
            current.map((message) =>
              message.id === localAssistant.id
                ? { ...message, content: message.content + event.delta }
                : message,
            ),
          );
        } else if (event.type === 'status') {
          setStatus(event.label);
        } else if (event.type === 'tool') {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== localAssistant.id) return message;
              const tools = message.tools ?? [];
              const index = tools.findIndex((tool) => tool.id === event.tool.id);
              return {
                ...message,
                tools:
                  index >= 0
                    ? tools.map((tool, i) => (i === index ? event.tool : tool))
                    : [...tools, event.tool],
              };
            }),
          );
        } else if (event.type === 'compaction') {
          setStatus(
            `Memória resumida: ${event.before.toLocaleString()} → ${event.after.toLocaleString()} tokens.`,
          );
        } else if (event.type === 'error') {
          setStatus(event.message);
          if (soundsEnabled) play('droplet');
        } else if (event.type === 'done' && soundsEnabled) {
          play('success');
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          try {
            apply(JSON.parse(dataLine.slice(6)) as StreamEvent);
          } catch {
            /* ignora frame inválido */
          }
        }
      }
      await refresh();
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(error instanceof Error ? error.message : 'Falha no streaming.');
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setStatus(null);
    }
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-6.5rem)] w-full max-w-5xl flex-col px-3 pb-3 pt-2 md:h-[calc(100dvh-2rem)] md:px-0">
      <header className="flex items-center justify-between border-b border-[var(--color-app-border)] px-2 pb-3">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight text-zinc-100">
            Conversar com Vox
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-app-muted)]">
            Uma conversa contínua, conectada ao seu acervo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {streaming && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {status ?? 'Respondendo'}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !soundsEnabled;
              setSoundsEnabled(next);
              window.localStorage.setItem('voxen.chat.sounds', String(next));
              setEnabled(next);
              if (next) play('success');
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border)] text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)]"
            aria-label={soundsEnabled ? 'Desativar sons do chat' : 'Ativar sons do chat'}
            title={soundsEnabled ? 'Desativar sons do chat' : 'Ativar sons do chat'}
          >
            {soundsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {streaming ? (status ?? 'A Vox está respondendo.') : ''}
      </p>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        role="log"
        aria-live="off"
        aria-label="Histórico da conversa"
        className="relative flex-1 overflow-y-auto scroll-smooth px-1 py-5"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-app-muted)]">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Carregando conversa…
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <Sparkles className="h-6 w-6" />
            </span>
            <h1 className="font-display text-xl font-semibold text-zinc-100">
              O que você quer descobrir?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-app-muted)]">
              Posso pesquisar transcrições, notas e conexões do Brain. Peça uma resposta baseada no
              seu acervo.
            </p>
          </div>
        ) : (
          visibleMessages.map((message) => (
            <article
              key={message.id}
              className={cn('mb-5 flex', message.role === 'USER' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[92%] rounded-2xl px-4 py-3 md:max-w-[78%]',
                  message.role === 'USER'
                    ? 'bg-emerald-500/15 text-zinc-100 ring-1 ring-emerald-400/15'
                    : 'bg-[var(--color-app-surface)]/80 ring-1 ring-[var(--color-app-border)]',
                )}
              >
                {message.content && <Markdown>{message.content}</Markdown>}
                {message.tools?.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} onApprove={(id) => void approve(id)} />
                ))}
              </div>
            </article>
          ))
        )}
        {!nearBottom && (
          <button
            type="button"
            onClick={() => {
              setNearBottom(true);
              scrollerRef.current?.scrollTo({
                top: scrollerRef.current.scrollHeight,
                behavior: 'smooth',
              });
            }}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 py-1.5 text-xs font-medium text-zinc-200 shadow-lg"
          >
            Ir ao mais recente
          </button>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="border-t border-[var(--color-app-border)] pt-3"
      >
        {status && !streaming && <p className="mb-2 text-xs text-amber-200">{status}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] p-2 shadow-lg shadow-black/10 focus-within:border-emerald-400/45">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Pergunte sobre suas transcrições, notas ou Brain…"
            rows={1}
            disabled={streaming}
            className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none placeholder:text-[var(--color-app-muted)] disabled:opacity-60"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
              aria-label="Interromper resposta"
            >
              <CircleStop className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Enviar mensagem"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
