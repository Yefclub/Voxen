import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Copy,
  FileText,
  Globe,
  Loader2,
  LoaderCircle,
  Network,
  NotebookPen,
  Paperclip,
  Search,
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
  formatToolDuration,
  hasToolLabel,
  pendingHitlFromTools,
  prettifyToolName,
  toolFamily,
  type PendingHitl,
  type ToolFamily,
} from '../lib/chat-tools';
import {
  applySegmentEvent,
  closeTrailingReasoning,
  segmentsFromPersistedTools,
  segmentsReasoningDuration,
  segmentsRunning,
  type MessageSegment,
  type ToolEvent,
} from '../lib/chat-segments';
import {
  ANCHOR_MOUNT_RETRY_FRAMES,
  canRearmFollow,
  isUserScrollUp,
  nextSpacerHeight,
  planAnchor,
  shouldAnchor,
  shouldReengageFollow,
  type ScrollPhase,
} from '../lib/chat-scroll';
import type { ChatHandoffState } from '../lib/chat-handoff';
import {
  getSoundsEnabled,
  setChatEmpty,
  setChatStreaming,
  useChatShell,
} from '../lib/chat-shell-state';

type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  kind: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
  content: string;
  tools: ToolEvent[] | null;
  compactedAt: string | null;
  createdAt: string;
  /** Segmentos cronológicos persistidos; durante o stream são atualizados localmente. */
  segments?: MessageSegment[];
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
// Linha de ferramenta (ícone por família + label + status discreto + detalhe).
// HITL confirm UI lives above the composer (spec 090) — not here.
// ---------------------------------------------------------------------------
function ToolRow({ tool }: { tool: ToolEvent }) {
  const { t } = useI18n();
  const family = toolFamily(tool.name);
  const Icon = FAMILY_ICON[family];
  const awaitingHitl = tool.state === 'approval-required';
  const expandable = tool.output !== undefined && !awaitingHitl;
  const [open, setOpen] = useState(false);

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
          ) : awaitingHitl ? (
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
              : awaitingHitl
                ? 'text-[var(--color-accent-amber)]'
                : 'text-[var(--color-app-subtle)]',
          )}
        >
          {toolLabel(tool.name, t)}
          {awaitingHitl ? ` · ${t('chat.hitlAwaiting')}` : ''}
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
              <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)] break-words">
                {t('chat.toolParamsSafe')}
              </p>
            )}
            {tool.output !== undefined ? (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-app-muted)] break-words">
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
// Bloco de pensamento — raciocínio e ferramentas num único container
// cronológico (spec 078): "Pensando" (shimmer) enquanto o turno está ao vivo
// (`live`) OU algum segmento ainda roda — e "Pensou por Xs" só ao terminar o
// turno. Gaps entre tools (running=false por milissegundos) NÃO colapsam o
// bloco; isso evitava o flicker compacta/reabre no harness multi-step.
// HITL fica acima do composer (spec 090), não neste bloco.
// ---------------------------------------------------------------------------
function ThinkingBlock({
  segments,
  live,
}: {
  segments: MessageSegment[];
  live: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const running = segmentsRunning(segments);
  // Turno em voo: stream ainda aberto OU algum step de fato em andamento.
  const inFlight = live || running;
  // Timeline aberta enquanto o turno está em voo; recolhe só ao terminar
  // (usuário reabre no header).
  const [expanded, setExpanded] = useState(true);
  // Cronômetro de parede (honesto): conta do 1º evento até terminar. Só há
  // timing em turnos ao vivo; blocos recarregados não exibem duração.
  const startedAtRef = useRef<number | null>(live ? Date.now() : null);
  const [elapsed, setElapsed] = useState(0);
  const [frozen, setFrozen] = useState<number | null>(null);

  useEffect(() => {
    if (!inFlight) {
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
  }, [inFlight, frozen]);

  // `frozen`/`startedAtRef` são estado local — não sobrevivem quando `send()`
  // troca a mensagem pelo snapshot do servidor (a `key` muda pro id real do
  // banco e o React remonta este componente com `live=false`, zerando o
  // cronômetro). Nesse caso, cai pro fallback: a duração derivada dos
  // próprios timestamps dos segments de raciocínio (preservados pelo swap).
  const duration = frozen ?? (inFlight ? elapsed : segmentsReasoningDuration(segments));

  return (
    <section className="mb-2.5 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => !inFlight && setExpanded((v) => !v)}
        disabled={inFlight}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-left"
      >
        {inFlight ? (
          <span className="text-shimmer text-[12.5px] font-medium">{t('chat.thinking')}</span>
        ) : (
          <>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform',
                expanded && 'rotate-90',
              )}
            />
            <span className="text-[12.5px] font-medium text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)]">
              {duration != null
                ? t('chat.thoughtFor', { duration: formatToolDuration(duration) })
                : t('chat.reasoning')}
            </span>
          </>
        )}
      </button>
      <Collapsible open={expanded}>
        <div className="ml-2 flex flex-col gap-2.5 border-l-2 border-[var(--color-app-border)] py-0.5 pl-3">
          {segments.map((segment) =>
            segment.type === 'reasoning' ? (
              <p
                key={segment.id}
                className={cn(
                  'whitespace-pre-wrap text-[12.5px] leading-relaxed',
                  live && segment.endedAt == null
                    ? 'text-shimmer'
                    : 'text-[var(--color-app-muted)]',
                )}
              >
                {segment.text}
              </p>
            ) : (
              <div key={segment.id} className="flex flex-col">
                {segment.tools.map((tool) => (
                  <ToolRow key={tool.id} tool={tool} />
                ))}
              </div>
            ),
          )}
        </div>
      </Collapsible>
    </section>
  );
}

// ---------------------------------------------------------------------------
// HITL sticky acima do composer (spec 090) — padrão de mercado / Cursor.
// ---------------------------------------------------------------------------
function MessageCopyButton({
  text,
  align = 'start',
}: {
  text: string;
  align?: 'start' | 'end';
}): React.ReactElement | null {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmed = text.trim();
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  if (!trimmed) return null;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (permissions / insecure context).
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        'mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--color-app-muted)] transition-opacity hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
        'opacity-70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
        align === 'end' ? 'self-end' : 'self-start',
      )}
      aria-label={t('chat.copyMessage')}
      title={t('chat.copyMessage')}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span>{copied ? t('common.copied') : t('common.copy')}</span>
    </button>
  );
}

function HitlConfirmBar({
  pending,
  onApprove,
}: {
  pending: PendingHitl[];
  onApprove: (id: string) => void;
}): React.ReactElement | null {
  const { t } = useI18n();
  if (pending.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-2" role="region" aria-label={t('chat.hitlRegion')}>
      {pending.map((item) => (
        <div
          key={item.approvalId}
          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--color-app-fg)]">
              {item.title
                ? t('chat.hitlProposeNote', { title: item.title })
                : t('chat.confirmationTitle')}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-app-muted)]">
              {t('chat.hitlConfirmHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onApprove(item.approvalId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent-amber)] px-3 py-1.5 text-xs font-semibold text-[var(--color-app-bg)] hover:opacity-90"
          >
            <Check className="h-3.5 w-3.5" /> {t('chat.confirm')}
          </button>
        </div>
      ))}
    </div>
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
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

export function ChatPage(): React.ReactElement {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
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
  const contentWrapRef = useRef<HTMLDivElement>(null);
  const spacerNodeRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingAssistantId = useRef<string | null>(null);
  const pendingAnchorIdRef = useRef<string | null>(null);
  /** Handoff one-shot de outras páginas (detalhe de transcrição, etc.). */
  const pendingAutoSendRef = useRef<string | null>(null);
  const autoSendConsumedRef = useRef(false);
  const scrollPhaseRef = useRef<ScrollPhase>('free');
  const spacerHeightRef = useRef(0);
  const reserveEndRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  /**
   * Gate do reengage da âncora (spec 092): durante o stream, só libera quando
   * a resposta final já tem texto. Tools/raciocínio sozinhos não devem
   * desancorar e voltar pro stick-to-bottom. Lido no ResizeObserver via ref
   * (o observer é montado uma vez; closure stale).
   */
  const allowAnchorReengageRef = useRef(true);
  const { clearSignal } = useChatShell();
  const lastClearSignal = useRef(clearSignal);
  // MutableRefObject: React 19 RefObject.current is readonly and control-flow
  // narrows after `= null`, which breaks later reads in the same function.
  // Espelha os segments ao vivo até o snapshot final persistido chegar.
  const liveSegmentsRef = useRef<MessageSegment[] | null>(null) as {
    current: MessageSegment[] | null;
  };

  function applySpacerHeight(px: number): void {
    spacerHeightRef.current = px;
    if (spacerNodeRef.current) spacerNodeRef.current.style.height = `${Math.max(0, px)}px`;
  }

  function markProgrammaticScroll(): void {
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }

  function scrollToBottom(smooth: boolean): void {
    const element = scrollerRef.current;
    if (!element) return;
    scrollPhaseRef.current = 'free';
    applySpacerHeight(0);
    reserveEndRef.current = 0;
    setNearBottom(true);
    markProgrammaticScroll();
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  function anchorUserMessage(messageId: string, retriesLeft: number): void {
    const container = scrollerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!el) {
      if (retriesLeft > 0) {
        requestAnimationFrame(() => anchorUserMessage(messageId, retriesLeft - 1));
        return;
      }
      pendingAnchorIdRef.current = null;
      scrollToBottom(false);
      return;
    }

    // Composer sits outside the scroller in Voxen — visible band is the scroller itself.
    const composerHeight = 0;
    if (
      !shouldAnchor({
        messageHeight: el.getBoundingClientRect().height,
        clientHeight: container.clientHeight,
        composerHeight,
      })
    ) {
      pendingAnchorIdRef.current = null;
      scrollToBottom(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const plan = planAnchor({
      messageTop: container.scrollTop + (elRect.top - containerRect.top),
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      currentSpacerHeight: spacerHeightRef.current,
    });

    applySpacerHeight(plan.spacerHeight);
    reserveEndRef.current = plan.reserveEnd;
    scrollPhaseRef.current = 'anchor';
    setNearBottom(false);
    pendingAnchorIdRef.current = null;
    markProgrammaticScroll();
    container.scrollTo({ top: plan.targetScrollTop, behavior: 'auto' });
    prevScrollTopRef.current = plan.targetScrollTop;
  }

  function handleContentGrowth(): void {
    if (scrollPhaseRef.current !== 'anchor') return;
    const container = scrollerRef.current;
    const content = contentWrapRef.current;
    if (!container || !content) return;

    const next = nextSpacerHeight({
      reserveEnd: reserveEndRef.current,
      scrollHeight: container.scrollHeight,
      currentSpacerHeight: spacerHeightRef.current,
    });
    if (next !== spacerHeightRef.current) applySpacerHeight(next);

    const contentRect = content.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (
      shouldReengageFollow({
        contentBottomViewport: contentRect.bottom,
        containerBottomViewport: containerRect.bottom,
        composerHeight: 0,
        clientHeight: container.clientHeight,
        spacerHeight: spacerHeightRef.current,
        allowReengage: allowAnchorReengageRef.current,
      })
    ) {
      scrollPhaseRef.current = 'free';
      applySpacerHeight(0);
      reserveEndRef.current = 0;
      setNearBottom(true);
    }
  }

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) => message.compactedAt === null && message.kind !== 'COMPACTION_SUMMARY',
      ),
    [messages],
  );
  const pendingHitl = useMemo(() => {
    const seen = new Set<string>();
    const pending: PendingHitl[] = [];
    for (const message of visibleMessages) {
      if (message.role === 'USER') continue;
      const tools =
        message.segments?.flatMap((segment) =>
          segment.type === 'tool-group' ? segment.tools : [],
        ) ??
        message.tools ??
        [];
      for (const item of pendingHitlFromTools(tools)) {
        if (seen.has(item.approvalId)) continue;
        seen.add(item.approvalId);
        pending.push(item);
      }
    }
    return pending;
  }, [visibleMessages]);
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

  // Captura handoff (autoSend) do location.state e limpa a history entry.
  useEffect(() => {
    if (autoSendConsumedRef.current) return;
    const handoff = (location.state as ChatHandoffState | null)?.autoSend?.trim();
    if (!handoff) return;
    autoSendConsumedRef.current = true;
    pendingAutoSendRef.current = handoff;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location.pathname, location.search, location.state, navigate]);

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

  // Dispara o handoff assim que o snapshot carregou e o chat está livre.
  useEffect(() => {
    if (loading || streaming) return;
    const pending = pendingAutoSendRef.current;
    if (!pending) return;
    pendingAutoSendRef.current = null;
    void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot handoff after load
  }, [loading, streaming]);

  // Abre já no fim (sem animação) na primeira renderização com conteúdo.
  useLayoutEffect(() => {
    if (loading || didInitialScroll.current || visibleMessages.length === 0) return;
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    didInitialScroll.current = true;
    prevScrollTopRef.current = element.scrollTop;
  }, [loading, visibleMessages.length]);

  // After send: pin the new user bubble near the top (spec 092 / Orbital).
  useLayoutEffect(() => {
    const id = pendingAnchorIdRef.current;
    if (!id || loading) return;
    requestAnimationFrame(() => anchorUserMessage(id, ANCHOR_MOUNT_RETRY_FRAMES));
  }, [messages, loading]);

  // Legacy stick-to-bottom only in free phase (disabled while anchored).
  useEffect(() => {
    if (!didInitialScroll.current) return;
    if (scrollPhaseRef.current === 'anchor') return;
    if (!nearBottom) return;
    const element = scrollerRef.current;
    if (!element) return;
    markProgrammaticScroll();
    element.scrollTo({
      top: element.scrollHeight,
      behavior: streaming ? 'auto' : 'smooth',
    });
  }, [messages, nearBottom, streaming]);

  // Shrink spacer as the assistant reply grows during an anchored turn.
  // Re-attach when the scroller mounts (loading/empty → conversation view).
  useEffect(() => {
    if (loading || isEmpty) return;
    const content = contentWrapRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => handleContentGrowth());
    observer.observe(content);
    return () => observer.disconnect();
  }, [loading, isEmpty]);

  function onScroll(): void {
    const element = scrollerRef.current;
    if (!element) return;
    const scrollTop = element.scrollTop;
    const distanceToBottom = element.scrollHeight - scrollTop - element.clientHeight;

    if (programmaticScrollRef.current) {
      prevScrollTopRef.current = scrollTop;
      return;
    }

    if (
      scrollPhaseRef.current === 'anchor' &&
      isUserScrollUp(prevScrollTopRef.current, scrollTop)
    ) {
      scrollPhaseRef.current = 'free';
      applySpacerHeight(0);
      reserveEndRef.current = 0;
      setNearBottom(false);
      prevScrollTopRef.current = scrollTop;
      return;
    }

    if (
      canRearmFollow({
        distanceToBottom,
        spacerHeight: spacerHeightRef.current,
      })
    ) {
      setNearBottom(true);
    } else if (distanceToBottom >= 96) {
      setNearBottom(false);
    }
    prevScrollTopRef.current = scrollTop;
  }

  async function approve(id: string): Promise<void> {
    try {
      const result = await apiPost<{ message: string }>('/api/chat/approve', { approvalId: id });
      toast.success(result.message);
      if (getSoundsEnabled()) play('success');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.approveError'));
    } finally {
      // Always reload: success clears the card; stale/already-used heals ghosts.
      await refresh().catch(() => undefined);
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

  async function send(override?: string): Promise<void> {
    const content = (override ?? input).trim();
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
    liveSegmentsRef.current = null;
    pendingAnchorIdRef.current = localUser.id;
    // Bloqueia reengage até chegar texto final (tools/raciocínio não desancoram).
    allowAnchorReengageRef.current = false;
    scrollPhaseRef.current = 'free';
    setMessages((current) => [...current, localUser, localAssistant]);
    setInput('');
    setNearBottom(false);
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
          // Texto final: libera reengage se o conteúdo preencher o viewport.
          allowAnchorReengageRef.current = true;
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== localAssistant.id) return message;
              // Texto final encerra o raciocínio em aberto (se houver) — a
              // partir daqui esse segmento não recebe mais deltas.
              const segments = closeTrailingReasoning(message.segments ?? [], Date.now());
              liveSegmentsRef.current = segments;
              return { ...message, content: message.content + event.delta, segments };
            }),
          );
        } else if (event.type === 'reasoning') {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== localAssistant.id) return message;
              const segments = applySegmentEvent(message.segments ?? [], event, Date.now());
              liveSegmentsRef.current = segments;
              return { ...message, segments };
            }),
          );
        } else if (event.type === 'status') {
          setStatus(event.label);
        } else if (event.type === 'tool') {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== localAssistant.id) return message;
              const segments = applySegmentEvent(message.segments ?? [], event, Date.now());
              liveSegmentsRef.current = segments;
              return { ...message, segments };
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
      // Turno termina com raciocínio ainda aberto (ex.: sem chamada de
      // ferramenta nem texto final) — fecha pra não ficar "Pensando" pra sempre.
      if (liveSegmentsRef.current) {
        liveSegmentsRef.current = closeTrailingReasoning(liveSegmentsRef.current, Date.now());
      }
      const snapshot = await apiGet<Snapshot>('/api/chat');
      setMessages(snapshot.messages);
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(error instanceof Error ? error.message : t('chat.streamError'));
    } finally {
      abortRef.current = null;
      streamingAssistantId.current = null;
      liveSegmentsRef.current = null;
      // Turno acabou: se o conteúdo já encheu a reserva, pode colar no fundo.
      allowAnchorReengageRef.current = true;
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
            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-5 pt-12 md:py-5"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col">
              <div ref={contentWrapRef} className="flex flex-col">
                {visibleMessages.map((message) => {
                  const isStreamingAssistant =
                    streaming && message.id === streamingAssistantId.current;
                  if (message.role === 'USER') {
                    return (
                      <article
                        key={message.id}
                        data-message-id={message.id}
                        className="group mb-5 flex flex-col items-end"
                      >
                        <div className="max-w-[85%] break-words rounded-2xl rounded-br-md bg-[var(--color-accent-primary-soft)] px-4 py-2.5 text-[14.5px] leading-relaxed text-[var(--color-app-fg)] ring-1 ring-[var(--color-accent-primary)]/15">
                          {message.content}
                        </div>
                        <MessageCopyButton text={message.content} align="end" />
                      </article>
                    );
                  }
                  const segments = message.segments ?? segmentsFromPersistedTools(message.tools);
                  return (
                    <article key={message.id} className="group mb-6 flex flex-col">
                      {segments.length > 0 && (
                        <ThinkingBlock segments={segments} live={isStreamingAssistant} />
                      )}
                      {message.content && (
                        <>
                          <div className="text-[15px] leading-relaxed text-[var(--color-app-fg)]">
                            <Markdown>{message.content}</Markdown>
                          </div>
                          {!isStreamingAssistant && (
                            <MessageCopyButton text={message.content} align="start" />
                          )}
                        </>
                      )}
                      {isStreamingAssistant && !message.content && segments.length === 0 && (
                        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-app-muted)]">
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          {status ?? t('chat.thinking')}
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
              {/* Anchor spacer (spec 092): makes the sent message scrollable to the top;
                  height is applied via DOM to avoid re-render churn while streaming. */}
              <div ref={spacerNodeRef} aria-hidden="true" />

              {!nearBottom && (
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className="sticky bottom-3 self-center rounded-full border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--color-app-fg)] shadow-lg"
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
              <HitlConfirmBar pending={pendingHitl} onApprove={(id) => void approve(id)} />
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
