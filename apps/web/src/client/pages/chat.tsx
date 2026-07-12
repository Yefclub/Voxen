import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileText,
  Globe,
  Loader2,
  LoaderCircle,
  Network,
  NotebookPen,
  Paperclip,
  Search,
  Send,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { play } from 'cuelume';
import { Markdown } from '../components/ui/markdown';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import { useI18n, type I18nKey, type TranslateFn } from '../lib/i18n';
import { cn } from '../lib/utils';
import { uploadMedia } from '../lib/upload';
import {
  CHAT_UPLOAD_ACCEPT,
  attachmentKind,
  completedToolCount,
  formatToolDuration,
  hasToolLabel,
  prettifyToolName,
  summarizeFamilies,
  toolBlockState,
  toolFamily,
  type ToolFamily,
} from '../lib/chat-tools';
import {
  getSoundsEnabled,
  setChatEmpty,
  setChatStreaming,
  useChatShell,
} from '../lib/chat-shell-state';

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

const FAMILY_ICON: Record<ToolFamily, typeof Search> = {
  search: Search,
  read: FileText,
  notes: NotebookPen,
  brain: Network,
  web: Globe,
  transcript: Video,
  other: Wrench,
};

const FAMILY_LABEL_KEY: Record<ToolFamily, I18nKey> = {
  search: 'chat.family.search',
  read: 'chat.family.read',
  notes: 'chat.family.notes',
  brain: 'chat.family.brain',
  web: 'chat.family.web',
  transcript: 'chat.family.transcript',
  other: 'chat.family.other',
};

function toolLabel(name: string, t: TranslateFn): string {
  return hasToolLabel(name) ? t(`tools.${name}` as I18nKey) : prettifyToolName(name);
}

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

// ---------------------------------------------------------------------------
// Colapsável (motion grid-template-rows 0fr↔1fr) — respeita reduced-motion via CSS
// ---------------------------------------------------------------------------
function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="chat-collapsible" data-open={open ? 'true' : 'false'} aria-hidden={!open}>
      <div className="chat-collapsible-inner">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha de ferramenta (ícone por família + label + status discreto + detalhe)
// ---------------------------------------------------------------------------
function ToolRow({ tool, onApprove }: { tool: ToolEvent; onApprove: (id: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const family = toolFamily(tool.name);
  const Icon = FAMILY_ICON[family];
  const pendingApproval = approvalId(tool);
  const expandable = tool.output !== undefined || pendingApproval != null;

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors',
          expandable && 'hover:bg-[var(--color-app-surface-hover)]',
        )}
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {tool.state === 'running' ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-app-subtle)]" />
          ) : tool.state === 'approval-required' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-amber)]" />
          ) : tool.state === 'error' ? (
            <span className="text-[11px] font-bold leading-none text-[var(--color-accent-rose)]">
              !
            </span>
          ) : (
            <Check className="h-3 w-3 text-[var(--color-app-subtle)]" />
          )}
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-app-muted)]" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12.5px] font-medium',
            tool.state === 'error'
              ? 'text-[var(--color-accent-rose)]'
              : 'text-[var(--color-app-subtle)]',
          )}
        >
          {toolLabel(tool.name, t)}
        </span>
        {expandable && (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-[var(--color-app-muted)] transition-transform',
              open && 'rotate-180',
            )}
          />
        )}
      </button>
      {expandable && (
        <Collapsible open={open}>
          <div className="ml-[26px] mb-1 mt-0.5 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] px-3 py-2">
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
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent-amber)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-app-bg)] hover:opacity-90"
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
        </Collapsible>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolblock — agrupa as ferramentas de uma resposta; roda → resumo colapsável
// ---------------------------------------------------------------------------
function ToolBlock({
  tools,
  live,
  onApprove,
}: {
  tools: ToolEvent[];
  live: boolean;
  onApprove: (id: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const blockState = toolBlockState(tools);
  const running = blockState === 'running';
  // Timeline aberta enquanto roda; recolhe ao terminar (usuário reabre no header).
  const [expanded, setExpanded] = useState(true);
  // Cronômetro de parede (honesto): conta do 1º evento até terminar. Só há
  // timing em turnos ao vivo; blocos recarregados não exibem duração.
  const startedAtRef = useRef<number | null>(live ? Date.now() : null);
  const [elapsed, setElapsed] = useState(0);
  const [frozen, setFrozen] = useState<number | null>(null);

  useEffect(() => {
    if (!running) {
      setExpanded(false);
      if (startedAtRef.current != null && frozen == null) {
        setFrozen(Date.now() - startedAtRef.current);
      }
      return;
    }
    setExpanded(true);
    if (startedAtRef.current == null) startedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      if (startedAtRef.current != null) setElapsed(Date.now() - startedAtRef.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [running, frozen]);

  const total = tools.length;
  const done = completedToolCount(tools);
  const families = useMemo(() => summarizeFamilies(tools), [tools]);
  const duration = frozen ?? (running ? elapsed : null);

  return (
    <section className="my-1.5">
      <button
        type="button"
        onClick={() => !running && setExpanded((v) => !v)}
        disabled={running}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
          !running && 'hover:bg-[var(--color-app-surface-hover)]',
        )}
      >
        {running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-app-subtle)]" />
            <span className="text-[12.5px] font-medium text-[var(--color-app-subtle)]">
              {t('chat.working')}
            </span>
            <span className="text-[11.5px] tabular-nums text-[var(--color-app-muted)]">
              · {done}/{total}
            </span>
          </>
        ) : (
          <>
            <Wrench className="h-3.5 w-3.5 shrink-0 text-[var(--color-app-muted)]" />
            <span className="text-[12.5px] font-medium text-[var(--color-app-subtle)]">
              {t('chat.actionsCount', { count: total })}
            </span>
            <span className="flex items-center gap-2.5 pl-1">
              {families.map(({ family, count }) => {
                const FIcon = FAMILY_ICON[family];
                return (
                  <span
                    key={family}
                    className="flex items-center gap-1 text-[11px] text-[var(--color-app-muted)]"
                    title={t(FAMILY_LABEL_KEY[family])}
                  >
                    <FIcon className="h-3 w-3" />
                    {count}
                  </span>
                );
              })}
            </span>
            {duration != null && (
              <span className="text-[11.5px] tabular-nums text-[var(--color-app-muted)]">
                · {formatToolDuration(duration)}
              </span>
            )}
            <ChevronDown
              className={cn(
                'ml-auto h-3.5 w-3.5 shrink-0 text-[var(--color-app-muted)] transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </>
        )}
      </button>
      <Collapsible open={expanded}>
        <div className="mt-0.5 flex flex-col">
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} onApprove={onApprove} />
          ))}
        </div>
      </Collapsible>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Raciocínio — shimmer "Pensando" ao vivo → botão "Pensou por Xs" colapsável
// ---------------------------------------------------------------------------
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
    setOpen(streaming);
  }, [streaming]);

  if (!text && !streaming) return null;

  return (
    <section className="mb-2.5 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-left"
      >
        {streaming ? (
          <span className="text-shimmer text-[12.5px] font-medium">{t('chat.thinking')}</span>
        ) : (
          <>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform',
                open && 'rotate-90',
              )}
            />
            <span className="text-[12.5px] font-medium text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)]">
              {durationMs != null && durationMs > 0
                ? t('chat.thoughtFor', { duration: formatToolDuration(durationMs) })
                : t('chat.reasoning')}
            </span>
          </>
        )}
      </button>
      <Collapsible open={open && Boolean(text)}>
        <p className="ml-2 whitespace-pre-wrap border-l-2 border-[var(--color-app-border)] py-0.5 pl-3 text-[12.5px] leading-relaxed text-[var(--color-app-muted)]">
          {text}
        </p>
      </Collapsible>
      {streaming && !text && <div className="ml-1 mt-0.5 h-3 w-28 rounded shimmer" aria-hidden />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Anexo do composer — upload independente para o acervo (ingestão via jobs)
// ---------------------------------------------------------------------------
type Attachment = {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
  controller: AbortController;
};

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  function patch(id: string, next: Partial<Attachment>): void {
    setAttachments((current) => current.map((a) => (a.id === id ? { ...a, ...next } : a)));
  }

  async function startUpload(file: File): Promise<void> {
    const kind = attachmentKind(file.name, file.type);
    if (!kind) {
      toast.error(t('chat.attachUnsupported'));
      return;
    }
    const id = crypto.randomUUID();
    const controller = new AbortController();
    setAttachments((current) => [
      ...current,
      { id, name: file.name, status: 'uploading', progress: 0, controller },
    ]);
    try {
      await uploadMedia(file, {
        signal: controller.signal,
        onProgress: (percent) => patch(id, { progress: percent }),
      });
      patch(id, { status: 'done', progress: 100 });
      toast.success(t('chat.attachQueued', { name: file.name }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setAttachments((current) => current.filter((a) => a.id !== id));
        return;
      }
      const message =
        err instanceof ApiError
          ? err.status === 413
            ? t('jobs.error.uploadTooLarge')
            : err.message
          : t('jobs.error.unexpected');
      patch(id, { status: 'error', error: message });
      toast.error(t('chat.attachError', { name: file.name }));
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((current) => {
      const target = current.find((a) => a.id === id);
      if (target?.status === 'uploading') target.controller.abort();
      return current.filter((a) => a.id !== id);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
      className={cn('w-full', className)}
    >
      <div className="flex flex-col gap-1.5 rounded-2xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] p-2 shadow-lg shadow-black/10 transition-colors focus-within:border-[var(--color-accent-primary)]/50">
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
          className="max-h-40 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--color-app-fg)] outline-none placeholder:text-[var(--color-app-muted)] disabled:opacity-60"
        />

        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            {attachments.map((a) => (
              <span
                key={a.id}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium',
                  a.status === 'error'
                    ? 'border-[var(--color-accent-rose)]/40 bg-[var(--color-accent-rose)]/5 text-[var(--color-accent-rose)]'
                    : 'border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-subtle)]',
                )}
              >
                {a.status === 'uploading' ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--color-app-muted)]" />
                ) : a.status === 'done' ? (
                  <Check className="h-3 w-3 shrink-0 text-[var(--color-accent-primary)]" />
                ) : (
                  <X className="h-3 w-3 shrink-0" />
                )}
                <span className="max-w-[160px] truncate">{a.name}</span>
                {a.status === 'uploading' && (
                  <span className="tabular-nums text-[var(--color-app-muted)]">{a.progress}%</span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="grid h-4 w-4 place-items-center rounded text-[var(--color-app-muted)] hover:text-[var(--color-accent-rose)]"
                  aria-label={t('common.close')}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept={CHAT_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void startUpload(file);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={streaming}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--color-app-border)] text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] disabled:opacity-50"
            aria-label={t('chat.attach')}
            title={t('chat.attach')}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <span className="flex-1" />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-rose)]/15 text-[var(--color-accent-rose)] transition-colors hover:bg-[var(--color-accent-rose)]/25"
              aria-label={t('chat.stop')}
            >
              <CircleStop className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-primary)] text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('chat.send')}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
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
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingAssistantId = useRef<string | null>(null);
  const { clearSignal } = useChatShell();
  const lastClearSignal = useRef(clearSignal);
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

  // Publica streaming/isEmpty pro shell (topbar lê pra habilitar/mostrar botões).
  useEffect(() => {
    setChatStreaming(streaming);
  }, [streaming]);
  useEffect(() => {
    setChatEmpty(isEmpty);
  }, [isEmpty]);
  useEffect(() => {
    return () => {
      setChatStreaming(false);
      setChatEmpty(true);
    };
  }, []);

  // Pedido de limpar conversa vindo do topbar (via signal do store).
  useEffect(() => {
    if (clearSignal !== lastClearSignal.current) {
      lastClearSignal.current = clearSignal;
      if (!streaming && !isEmpty) setClearOpen(true);
    }
  }, [clearSignal, streaming, isEmpty]);

  // Abre já no fim (sem animação) na primeira renderização com conteúdo.
  useLayoutEffect(() => {
    if (loading || didInitialScroll.current || visibleMessages.length === 0) return;
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    didInitialScroll.current = true;
  }, [loading, visibleMessages.length]);

  useEffect(() => {
    if (!didInitialScroll.current) return;
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
      if (getSoundsEnabled()) play('success');
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
    setNearBottom(true);
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
          if (getSoundsEnabled()) play('droplet');
        } else if (event.type === 'done' && getSoundsEnabled()) {
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <p className="sr-only" aria-live="polite">
        {streaming ? (status ?? t('chat.responding')) : ''}
      </p>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-app-muted)]">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> {t('chat.loading')}
        </div>
      ) : isEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-10">
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
          {/* Scroller full-width: a barra de rolagem fica na borda do main; só o
              conteúdo é centralizado (mx-auto). Recentraliza sozinho quando a
              sidebar abre/fecha, pois a largura do main muda. */}
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            role="log"
            aria-live="off"
            aria-label={t('chat.historyLabel')}
            className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col">
              {visibleMessages.map((message) => {
                const isStreamingAssistant =
                  streaming && message.id === streamingAssistantId.current;
                if (message.role === 'USER') {
                  return (
                    <article key={message.id} className="mb-5 flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent-primary-soft)] px-4 py-2.5 text-[14.5px] leading-relaxed text-[var(--color-app-fg)] ring-1 ring-[var(--color-accent-primary)]/15">
                        {message.content}
                      </div>
                    </article>
                  );
                }
                return (
                  <article key={message.id} className="mb-6 flex flex-col">
                    {(message.reasoning || isStreamingAssistant) && (
                      <ReasoningBlock
                        text={message.reasoning ?? ''}
                        streaming={Boolean(isStreamingAssistant && !message.reasoningEndedAt)}
                        startedAt={message.reasoningStartedAt}
                        endedAt={message.reasoningEndedAt}
                      />
                    )}
                    {message.tools && message.tools.length > 0 && (
                      <ToolBlock
                        tools={message.tools}
                        live={isStreamingAssistant}
                        onApprove={(id) => void approve(id)}
                      />
                    )}
                    {message.content && (
                      <div className="text-[15px] leading-relaxed text-[var(--color-app-fg)]">
                        <Markdown>{message.content}</Markdown>
                      </div>
                    )}
                    {isStreamingAssistant && !message.content && !message.reasoning && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-app-muted)]">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        {status ?? t('chat.thinking')}
                      </span>
                    )}
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
          </div>

          <div className="shrink-0 px-4 pb-4 pt-2">
            <div className="mx-auto w-full max-w-3xl">
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
    </div>
  );
}
