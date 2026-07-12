import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleStop,
  Eraser,
  LoaderCircle,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { play, setEnabled } from 'cuelume';
import { Markdown } from '../components/ui/markdown';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
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
  /** Live-only reasoning stream; not persisted. */
  reasoning?: string;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
};
type Snapshot = { conversation: { id: string; compactionCount: number }; messages: ChatMessage[] };
type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
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

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds}s`;
}

function ToolBlock({
  tool,
  onApprove,
}: {
  tool: ToolEvent;
  onApprove: (id: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(tool.state === 'running' || tool.state === 'approval-required');
  const pendingApproval = approvalId(tool);
  const stateLabel: Record<ToolState, string> = {
    running: t('chat.toolRunning'),
    completed: t('chat.toolCompleted'),
    error: t('chat.toolError'),
    'approval-required': t('chat.toolApproval'),
  };

  useEffect(() => {
    if (tool.state === 'running' || tool.state === 'approval-required') setOpen(true);
    else if (tool.state === 'completed') setOpen(false);
  }, [tool.state]);

  return (
    <section className="my-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 py-1 text-left"
      >
        <span className="flex h-4 w-4 items-center justify-center text-[var(--color-app-muted)]">
          {tool.state === 'running' ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--color-accent-emerald)]" />
          ) : tool.state === 'completed' ? (
            <Check className="h-3.5 w-3.5 text-[var(--color-accent-emerald)]" />
          ) : tool.state === 'error' ? (
            <span className="text-[10px] font-semibold text-[var(--color-accent-rose)]">!</span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-amber)]" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-app-muted)]">
          {tool.name.replaceAll('_', ' ')}
        </span>
        <span className="text-[10px] text-[var(--color-app-muted)]/80">
          {stateLabel[tool.state]}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 text-[var(--color-app-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="ml-[22px] border-l border-[var(--color-app-border)] pl-3 py-1.5">
          {tool.input !== undefined && (
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
              {t('chat.toolParamsSafe')}
            </p>
          )}
          {pendingApproval ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-accent-amber)]/25 bg-[var(--color-accent-amber)]/5 p-2.5">
              <p className="text-xs leading-relaxed text-[var(--color-app-subtle)]">
                {t('chat.hitlConfirmHint')}
              </p>
              <button
                type="button"
                onClick={() => onApprove(pendingApproval)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-amber)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-app-bg)] hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" /> {t('chat.confirm')}
              </button>
            </div>
          ) : tool.output !== undefined ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-app-muted)]">
              {toolSummary(tool.output)}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ReasoningBlock({
  text,
  streaming,
  startedAt,
  endedAt,
}: {
  text: string;
  streaming: boolean;
  startedAt?: number;
  endedAt?: number;
}): React.ReactElement | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(streaming);
  const durationMs =
    startedAt != null ? (endedAt ?? (streaming ? Date.now() : startedAt)) - startedAt : null;

  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);

  if (!text && !streaming) return null;

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 py-1 text-left"
      >
        {streaming ? (
          <span className="text-[12px] font-medium text-[var(--color-app-muted)] animate-pulse">
            {t('chat.thinking')}
          </span>
        ) : (
          <>
            <span className="text-[12px] text-[var(--color-app-muted)]">{t('chat.reasoning')}</span>
            {durationMs != null && durationMs > 0 && (
              <span className="text-[10px] text-[var(--color-app-muted)]/70">
                {t('chat.thinkingDuration', { duration: formatDuration(durationMs) })}
              </span>
            )}
          </>
        )}
        <ChevronDown
          className={cn(
            'ml-auto h-3 w-3 text-[var(--color-app-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && text && (
        <div className="ml-0.5 border-l border-[var(--color-app-border)] pl-3 py-1">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-app-muted)]">
            {text}
          </p>
        </div>
      )}
      {streaming && !text && <div className="ml-0.5 mt-1 h-3 w-28 rounded shimmer" aria-hidden />}
    </section>
  );
}

function Composer({
  input,
  setInput,
  streaming,
  onSend,
  onStop,
  autoFocus,
  className,
}: {
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  autoFocus?: boolean;
  className?: string;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
      className={cn('w-full', className)}
    >
      <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] p-2 shadow-lg shadow-black/10 focus-within:border-[var(--color-accent-emerald)]/40">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={t('prompt.placeholder')}
          rows={1}
          disabled={streaming}
          autoFocus={autoFocus}
          className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[var(--color-app-fg)] outline-none placeholder:text-[var(--color-app-muted)] disabled:opacity-60"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-rose)]/15 text-[var(--color-accent-rose)] hover:bg-[var(--color-accent-rose)]/25"
            aria-label={t('chat.stop')}
          >
            <CircleStop className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-emerald)] text-[var(--color-app-bg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('chat.send')}
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </form>
  );
}

export function ChatPage(): React.ReactElement {
  const { t } = useI18n();
  const { data: me } = useMe();
  const firstName = me?.user?.name?.split(' ')[0] ?? t('dashboard.fallbackName');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingAssistantId = useRef<string | null>(null);
  type LiveReasoning = { text: string; startedAt?: number; endedAt?: number };
  // MutableRefObject: React 19 RefObject.current is readonly and control-flow
  // narrows after `= null`, which breaks later reads in the same function.
  const liveReasoningRef = useRef<LiveReasoning | null>(null) as {
    current: LiveReasoning | null;
  };

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) => message.compactedAt === null && message.kind !== 'COMPACTION_SUMMARY',
      ),
    [messages],
  );
  const isEmpty = !loading && visibleMessages.length === 0;

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const snapshot = await apiGet<Snapshot>('/api/chat');
      setMessages(snapshot.messages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.loadError'));
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
      toast.error(error instanceof Error ? error.message : t('chat.approveError'));
    }
  }

  async function clearHistory(): Promise<void> {
    setClearing(true);
    try {
      await apiDelete<{ ok: true }>('/api/chat');
      setMessages([]);
      setStatus(null);
      toast.success(t('chat.cleared'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('shell.deleteConversationError'));
      throw error;
    } finally {
      setClearing(false);
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
    streamingAssistantId.current = localAssistant.id;
    liveReasoningRef.current = null;
    setMessages((current) => [...current, localUser, localAssistant]);
    setInput('');
    setStreaming(true);
    setStatus(t('chat.thinking'));
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
      if (!response.ok || !response.body) throw new Error(t('chat.streamStartError'));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const apply = (event: StreamEvent): void => {
        if (event.type === 'text') {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== localAssistant.id) return message;
              const next = {
                ...message,
                content: message.content + event.delta,
                reasoningEndedAt:
                  message.reasoning && !message.reasoningEndedAt
                    ? Date.now()
                    : message.reasoningEndedAt,
              };
              if (next.reasoning) {
                liveReasoningRef.current = {
                  text: next.reasoning,
                  startedAt: next.reasoningStartedAt,
                  endedAt: next.reasoningEndedAt,
                };
              }
              return next;
            }),
          );
        } else if (event.type === 'reasoning') {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== localAssistant.id) return message;
              const next = {
                ...message,
                reasoning: (message.reasoning ?? '') + event.delta,
                reasoningStartedAt: message.reasoningStartedAt ?? Date.now(),
              };
              liveReasoningRef.current = {
                text: next.reasoning ?? '',
                startedAt: next.reasoningStartedAt,
                endedAt: next.reasoningEndedAt,
              };
              return next;
            }),
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
            t('chat.compactionStatus', {
              before: event.before.toLocaleString(),
              after: event.after.toLocaleString(),
            }),
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
            /* ignore invalid frame */
          }
        }
      }
      const liveReasoning = liveReasoningRef.current as LiveReasoning | null;
      if (liveReasoning && liveReasoning.endedAt == null) {
        liveReasoningRef.current = {
          ...liveReasoning,
          endedAt: Date.now(),
        };
      }
      const snapshot = await apiGet<Snapshot>('/api/chat');
      const preserved = liveReasoningRef.current as LiveReasoning | null;
      setMessages(
        snapshot.messages.map((message, index, list) => {
          if (
            preserved &&
            message.role === 'ASSISTANT' &&
            index === list.length - 1 &&
            !message.reasoning
          ) {
            return {
              ...message,
              reasoning: preserved.text,
              reasoningStartedAt: preserved.startedAt,
              reasoningEndedAt: preserved.endedAt,
            };
          }
          return message;
        }),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(error instanceof Error ? error.message : t('chat.streamError'));
    } finally {
      abortRef.current = null;
      streamingAssistantId.current = null;
      liveReasoningRef.current = null;
      setStreaming(false);
      setStatus(null);
    }
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      {streaming && (
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-[var(--color-accent-emerald)]">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {status ?? t('chat.responding')}
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border)] text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)]"
        aria-label={soundsEnabled ? t('chat.soundsOff') : t('chat.soundsOn')}
        title={soundsEnabled ? t('chat.soundsOff') : t('chat.soundsOn')}
      >
        {soundsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => setClearOpen(true)}
        disabled={streaming || isEmpty}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border)] text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('chat.clearConversation')}
        title={t('chat.clearConversation')}
      >
        <Eraser className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-3 md:px-0">
      <header className="flex shrink-0 items-center justify-end gap-2 px-1 py-2 md:py-3">
        {headerActions}
      </header>

      <p className="sr-only" aria-live="polite">
        {streaming ? (status ?? t('chat.responding')) : ''}
      </p>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-app-muted)]">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> {t('chat.loading')}
        </div>
      ) : isEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 pb-8">
          <h1 className="font-display mb-8 text-center text-2xl font-semibold tracking-tight text-[var(--color-app-fg)] md:text-3xl">
            {t('home.greeting', { name: firstName })}
          </h1>
          <Composer
            input={input}
            setInput={setInput}
            streaming={streaming}
            onSend={() => void send()}
            onStop={() => abortRef.current?.abort()}
            autoFocus
            className="w-full max-w-2xl"
          />
        </div>
      ) : (
        <>
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            role="log"
            aria-live="off"
            aria-label={t('chat.historyLabel')}
            className="relative min-h-0 flex-1 overflow-y-auto scroll-smooth px-1 py-3"
          >
            {visibleMessages.map((message) => {
              const isStreamingAssistant = streaming && message.id === streamingAssistantId.current;
              return (
                <article
                  key={message.id}
                  className={cn(
                    'mb-5 flex',
                    message.role === 'USER' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[92%] rounded-2xl px-4 py-3 md:max-w-[85%]',
                      message.role === 'USER'
                        ? 'bg-[var(--color-accent-emerald-soft)] text-[var(--color-app-fg)] ring-1 ring-[var(--color-accent-emerald)]/15'
                        : 'bg-transparent',
                    )}
                  >
                    {message.role === 'ASSISTANT' &&
                      (message.reasoning || isStreamingAssistant) && (
                        <ReasoningBlock
                          text={message.reasoning ?? ''}
                          streaming={Boolean(isStreamingAssistant && !message.reasoningEndedAt)}
                          startedAt={message.reasoningStartedAt}
                          endedAt={message.reasoningEndedAt}
                        />
                      )}
                    {message.tools?.map((tool) => (
                      <ToolBlock key={tool.id} tool={tool} onApprove={(id) => void approve(id)} />
                    ))}
                    {message.content && <Markdown>{message.content}</Markdown>}
                    {isStreamingAssistant && !message.content && !message.reasoning && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-app-muted)]">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        {status ?? t('chat.thinking')}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
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
                className="sticky bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--color-app-fg)] shadow-lg"
              >
                {t('chat.scrollLatest')}
              </button>
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--color-app-border)] px-1 pt-3 pb-3 md:pb-4">
            {status && !streaming && (
              <p className="mb-2 text-xs text-[var(--color-accent-amber)]">{status}</p>
            )}
            <Composer
              input={input}
              setInput={setInput}
              streaming={streaming}
              onSend={() => void send()}
              onStop={() => abortRef.current?.abort()}
            />
          </div>
        </>
      )}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('shell.deleteConversationTitle')}
        description={t('shell.deleteConversationDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        loading={clearing}
        onConfirm={clearHistory}
      />
    </main>
  );
}
