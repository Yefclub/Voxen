import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleStop,
  Copy,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  LoaderCircle,
  Music2,
  Network,
  NotebookPen,
  Paperclip,
  Search,
  Video,
  Wrench,
  X,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { play } from 'cuelume';
import { Markdown } from '../components/ui/markdown';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import { isTransientStreamDisconnect } from '../lib/chat-stream-errors';
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
  parseMessageSegments,
  resolveThinkingTiming,
  segmentsFromPersistedTools,
  segmentsToolCount,
  thinkingInFlight,
  type MessageSegment,
  type ToolEvent,
} from '../lib/chat-segments';
import { useThinkingDisclosure } from '../lib/thinking-disclosure';
import {
  MAX_MESSAGE_ATTACHMENTS,
  type MessageAttachment,
} from '../../lib/chat/message-attachments';
import {
  ANCHOR_MOUNT_RETRY_FRAMES,
  SCROLL_LATEST_SHOW_DISTANCE_PX,
  canRearmFollow,
  isUserScrollUp,
  nextScrollLatestVisibility,
  nextSpacerHeight,
  planAnchor,
  shouldAnchor,
  shouldReengageFollow,
  type ScrollPhase,
} from '../lib/chat-scroll';
import type { ChatHandoffState } from '../lib/chat-handoff';
import { mergeChatMessagePages } from '../lib/chat-pagination';
import {
  planBranchRollback,
  planSend,
  truncateTrailFrom,
  type MessageVersions,
} from '../lib/chat-versions';
import { MessageEditForm, UserMessageActions } from '../components/chat/message-versioning';
import { claimPendingId, reconcileChatStart, sameActiveTurn } from '../lib/chat-reconciliation';
import {
  getSoundsEnabled,
  setChatEmpty,
  setChatStreaming,
  useChatShell,
} from '../lib/chat-shell-state';
import { chatStatusI18nKey, type ChatStatusCode } from '../../shared/chat-status';

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
  /** Anexos vinculados à mensagem do usuário (spec 126). */
  attachments?: MessageAttachment[];
  /**
   * Posição entre as versões irmãs — só vem preenchido em ponto de
   * ramificação, e só em mensagem do usuário (spec 127).
   */
  versions?: MessageVersions | null;
};
/**
 * Alvo de um reenvio versionado (spec 127): a mensagem editada e os anexos que
 * a versão nova herda dela.
 */
type BranchTarget = { messageId: string; attachments: MessageAttachment[] };

type ActiveTurn = {
  id: string;
  status: 'PENDING' | 'RUNNING';
  assistantMessageId: string;
  updatedAt: string;
};
type Snapshot = {
  conversation: { id: string; compactionCount: number };
  messages: ChatMessage[];
  hasOlder: boolean;
  nextCursor: string | null;
  activeTurn: ActiveTurn | null;
};

/**
 * `segments` chega do snapshot apenas *tipado* como `MessageSegment[]` — a
 * coluna é JSONB e o backend não valida a forma. Normaliza na fronteira para
 * que nenhum render toque em campo cru (spec 126).
 */
function normalizeSnapshotMessage(message: ChatMessage): ChatMessage {
  const segments = parseMessageSegments(message.segments);
  return { ...message, segments: segments ?? undefined };
}

type StreamEvent =
  | {
      type: 'start';
      turnId: string;
      userMessageId: string;
      assistantMessageId: string;
      startedAt: string;
    }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool'; tool: ToolEvent }
  | { type: 'status'; label: string; code?: ChatStatusCode }
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

/**
 * Rótulo compacto do bloco recolhido (spec 126): duração do raciocínio e/ou
 * quantidade de ferramentas usadas. Sem nenhum dos dois, cai no rótulo neutro.
 */
function thinkingSummaryLabel(duration: number | null, toolCount: number, t: TranslateFn): string {
  const parts: string[] = [];
  if (duration != null)
    parts.push(t('chat.thoughtFor', { duration: formatToolDuration(duration) }));
  if (toolCount > 0) {
    parts.push(
      toolCount === 1 ? t('chat.toolsUsedOne') : t('chat.toolsUsedMany', { count: toolCount }),
    );
  }
  return parts.length > 0 ? parts.join(' · ') : t('chat.reasoning');
}

// ---------------------------------------------------------------------------
// Bloco de pensamento — raciocínio e ferramentas num único container
// cronológico (spec 078): "Pensando" (shimmer) enquanto o turno está em voo e
// resumo compacto ("Pensou por Xs · N ferramentas") assim que a resposta final
// começa (spec 126). Segmentos persistidos abertos não reativam um turno
// encerrado nem iniciam cronômetro após reload.
// HITL fica acima do composer (spec 090), não neste bloco.
// ---------------------------------------------------------------------------
function ThinkingBlock({
  segments,
  live,
  answering,
  startedAt,
}: {
  segments: MessageSegment[];
  live: boolean;
  /** A resposta final já começou a chegar neste turno. */
  answering: boolean;
  startedAt: number;
}): React.ReactElement {
  const { t } = useI18n();
  // Abertura dirigida por `live` (spec 130): o turno abre o bloco uma vez e o
  // recolhe uma vez, com atraso, quando o stream fecha. Amarrar isso a
  // `inFlight` fazia o bloco piscar a cada ida-e-volta de ferramenta.
  const { expanded, toggle } = useThinkingDisclosure(live);
  // Cronômetro de parede apenas durante o turno ao vivo. Mensagens concluídas
  // usam exclusivamente timestamps persistidos, portanto nunca "envelhecem"
  // ao remontar ou ao voltar para a conversa.
  const startedAtRef = useRef<number>(startedAt);
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  const { inFlight, duration } = resolveThinkingTiming(
    segments,
    thinkingInFlight(segments, live, answering),
    startedAt,
    elapsed,
  );
  const toolCount = segmentsToolCount(segments);

  useEffect(() => {
    if (!inFlight) return;
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [inFlight]);

  return (
    <section className="mb-2.5 flex max-w-3xl flex-col gap-1">
      {/*
        Clicável também durante o turno: a spec 130 exige que o usuário possa
        assumir o controle no meio do voo, e `disabled` tirava isso dele.
      */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
        {inFlight ? (
          <span className="text-shimmer text-[12.5px] font-medium">{t('chat.thinking')}</span>
        ) : (
          <span className="text-[12.5px] font-medium text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)]">
            {thinkingSummaryLabel(duration, toolCount, t)}
          </span>
        )}
      </button>
      <Collapsible open={expanded}>
        <div className="ml-2 flex flex-col gap-2.5 border-l-2 border-[var(--color-app-border)] py-0.5 pl-3">
          {segments.map((segment) =>
            segment.type === 'reasoning' ? (
              // Raciocínio emitido pelo provedor (spec 126). Vive dentro do
              // bloco recolhível: quem quiser acompanhar, expande. Sem texto
              // (provedor que só sinaliza a etapa), cai no resumo operacional.
              <p
                key={segment.id}
                className={cn(
                  'whitespace-pre-wrap text-[12.5px] leading-relaxed',
                  live && segment.endedAt == null
                    ? 'text-shimmer'
                    : 'text-[var(--color-app-muted)]',
                )}
              >
                {segment.text.trim().length > 0
                  ? segment.text
                  : segment.endedAt == null
                    ? t('chat.reasoningInProgress')
                    : t('chat.reasoningCompleted')}
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
  /**
   * `row` = já está dentro da linha de ações da mensagem do usuário, que cuida
   * do espaçamento e do alinhamento (spec 127). `standalone` é o copiar
   * sozinho embaixo da resposta do assistente.
   */
  layout = 'standalone',
}: {
  text: string;
  align?: 'start' | 'end';
  layout?: 'standalone' | 'row';
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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--color-app-muted)] transition-opacity hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
        'opacity-70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
        layout === 'standalone' && 'mt-1.5',
        layout === 'standalone' && (align === 'end' ? 'self-end' : 'self-start'),
      )}
      aria-label={t('chat.copyMessage')}
      title={t('chat.copyMessage')}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span>{copied ? t('common.copied') : t('common.copy')}</span>
    </button>
  );
}

const ATTACHMENT_ICON: Record<MessageAttachment['kind'], typeof FileText> = {
  document: FileText,
  image: ImageIcon,
  media: Music2,
};

/**
 * Anexos vinculados à mensagem do usuário (spec 126). Vêm do snapshot, então
 * continuam visíveis depois de recarregar a página.
 */
function MessageAttachments({
  attachments,
}: {
  attachments?: MessageAttachment[];
}): React.ReactElement | null {
  const { t } = useI18n();
  if (!attachments?.length) return null;
  return (
    <ul
      className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5"
      aria-label={t('chat.attachmentsLabel')}
    >
      {attachments.map((attachment) => {
        const Icon = ATTACHMENT_ICON[attachment.kind];
        return (
          <li
            key={attachment.jobId}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--color-app-subtle)]"
          >
            <Icon className="h-3 w-3 shrink-0 text-[var(--color-app-muted)]" />
            <span className="max-w-[180px] truncate" title={attachment.name}>
              {attachment.name}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function HitlConfirmBar({
  pending,
  approving,
  onApprove,
}: {
  pending: PendingHitl[];
  approving: ReadonlySet<string>;
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
            disabled={approving.has(item.approvalId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent-amber)] px-3 py-1.5 text-xs font-semibold text-[var(--color-app-bg)] hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {approving.has(item.approvalId) ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}{' '}
            {t('chat.confirm')}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anexo do composer — o arquivo continua indo pro acervo (job de ingestão),
// mas agora o job também é vinculado à mensagem enviada (spec 126).
// ---------------------------------------------------------------------------
type Attachment = {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
  /** Job de ingestão criado pelo upload — é o que vincula o anexo à mensagem. */
  jobId?: string;
  controller: AbortController;
};

/** Ids de job dos anexos prontos, na ordem em que o usuário anexou. */
function readyAttachmentJobIds(attachments: readonly Attachment[]): string[] {
  const ids: string[] = [];
  for (const item of attachments) {
    if (item.status !== 'done' || !item.jobId) continue;
    ids.push(item.jobId);
    if (ids.length === MAX_MESSAGE_ATTACHMENTS) break;
  }
  return ids;
}

/** Altura máxima do composer antes de rolar internamente (spec 126). */
const COMPOSER_MAX_HEIGHT_PX = 200;
/**
 * ...mas nunca mais que esta fração da viewport. Num celular com o teclado
 * aberto sobram ~300px de área útil: 200px fixos engoliriam quase tudo,
 * deixando a conversa invisível enquanto se digita.
 */
const COMPOSER_MAX_HEIGHT_VH = 0.3;

function composerMaxHeight(): number {
  const viewport = window.visualViewport?.height ?? window.innerHeight;
  if (!Number.isFinite(viewport) || viewport <= 0) return COMPOSER_MAX_HEIGHT_PX;
  return Math.min(COMPOSER_MAX_HEIGHT_PX, viewport * COMPOSER_MAX_HEIGHT_VH);
}

function Composer({
  input,
  setInput,
  streaming,
  busy = false,
  onSend,
  onStop,
  attachments,
  onAttachFile,
  onRemoveAttachment,
  autoFocus,
  className,
}: {
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  /**
   * Ocupado sem ter turno para interromper — hoje só a troca de trilha
   * (spec 127). Trava o envio como `streaming`, mas NÃO troca o botão por
   * "parar": não há nada a parar, e oferecer o botão mentiria.
   */
  busy?: boolean;
  onSend: () => void;
  onStop: () => void;
  attachments: Attachment[];
  onAttachFile: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
  autoFocus?: boolean;
  className?: string;
}): React.ReactElement {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cresce com o conteúdo até o teto e só então rola internamente. Medir
  // exige zerar a altura antes de ler `scrollHeight`, senão o valor fica
  // preso na altura anterior e o composer nunca encolhe (mesmo padrão do
  // dock de transcrição). O teclado virtual muda a viewport sem mudar o
  // texto, então o resize também remede.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    function measure(): void {
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, composerMaxHeight())}px`;
    }
    measure();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', measure);
    window.addEventListener('resize', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, [input]);

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
          ref={textareaRef}
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
          disabled={streaming || busy}
          autoFocus={autoFocus}
          style={{
            maxHeight: `min(${COMPOSER_MAX_HEIGHT_PX}px, ${COMPOSER_MAX_HEIGHT_VH * 100}dvh)`,
          }}
          className="min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-sm text-[var(--color-app-fg)] outline-none placeholder:text-[var(--color-app-muted)] disabled:opacity-60"
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
                  onClick={() => onRemoveAttachment(a.id)}
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
              if (file) onAttachFile(file);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={streaming || busy}
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
              disabled={!input.trim() || busy}
              className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-primary)] text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('chat.send')}
            >
              <ChevronUp className="h-4 w-4" />
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
  const [activeTurn, setActiveTurn] = useState<ActiveTurn | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [approvingHitl, setApprovingHitl] = useState<ReadonlySet<string>>(new Set());
  // Versionamento (spec 127): qual mensagem está aberta para edição e se uma
  // troca de trilha está em voo. Só o id vive aqui — o rascunho pertence ao
  // formulário, que nasce com o texto atual da mensagem.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [switchingVersion, setSwitchingVersion] = useState(false);
  // Anexos vivem na página (não no Composer) porque `send()` precisa deles
  // para vincular os jobs à mensagem enviada (spec 126).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const approvingHitlRef = useRef(new Set<string>());
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
  const returningToEndRef = useRef(false);
  const userScrollIntentUntilRef = useRef(0);
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
    returningToEndRef.current = smooth;
    userScrollIntentUntilRef.current = 0;
    setNearBottom(true);
    setShowScrollLatest(false);
    markProgrammaticScroll();
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  function markUserScrollIntent(): void {
    // Wheel, touch e drag podem emitir vários scrolls depois do evento inicial.
    userScrollIntentUntilRef.current = Date.now() + 750;
    returningToEndRef.current = false;
    programmaticScrollRef.current = false;
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

  function patchAttachment(id: string, next: Partial<Attachment>): void {
    setAttachments((current) => current.map((a) => (a.id === id ? { ...a, ...next } : a)));
  }

  async function startUpload(file: File): Promise<void> {
    const kind = attachmentKind(file.name, file.type);
    if (!kind) {
      toast.error(t('chat.attachUnsupported'));
      return;
    }
    if (attachments.length >= MAX_MESSAGE_ATTACHMENTS) {
      toast.error(t('chat.attachTooMany', { max: MAX_MESSAGE_ATTACHMENTS }));
      return;
    }
    const id = crypto.randomUUID();
    const controller = new AbortController();
    setAttachments((current) => [
      ...current,
      { id, name: file.name, status: 'uploading', progress: 0, controller },
    ]);
    try {
      const uploaded = await uploadMedia(file, {
        signal: controller.signal,
        onProgress: (percent) => patchAttachment(id, { progress: percent }),
      });
      // O jobId é o que amarra este arquivo à próxima mensagem enviada.
      patchAttachment(id, { status: 'done', progress: 100, jobId: uploaded.jobId });
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
      patchAttachment(id, { status: 'error', error: message });
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

  function applySnapshot(snapshot: Snapshot, replace = false): void {
    // Funil único de mensagens vindas do servidor: normaliza aqui para que o
    // render nunca receba `segments` cru do JSONB (ver parseMessageSegments).
    const messages = snapshot.messages.map(normalizeSnapshotMessage);
    setMessages((current) => {
      if (replace) return messages;
      return mergeChatMessagePages(
        current.filter((message) => !message.id.startsWith('local-')),
        messages,
      );
    });
    setHasOlder(snapshot.hasOlder);
    setNextCursor(snapshot.nextCursor);
    setActiveTurn((current) =>
      sameActiveTurn(current, snapshot.activeTurn) ? current : snapshot.activeTurn,
    );
  }

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const snapshot = await apiGet<Snapshot>('/api/chat');
      applySnapshot(snapshot, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.loadError'));
    } finally {
      setLoading(false);
    }
  };

  async function loadOlderMessages(): Promise<void> {
    if (!nextCursor || loadingOlder) return;
    const scroller = scrollerRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const snapshot = await apiGet<Snapshot>(
        `/api/chat?before=${encodeURIComponent(nextCursor)}&limit=60`,
      );
      applySnapshot(snapshot);
      requestAnimationFrame(() => {
        if (!scroller) return;
        scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.loadError'));
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // A conexão SSE é um observador, não a posse do turno. Em reload, retorno do
  // background ou troca de rede, acompanha o estado persistido até terminar.
  useEffect(() => {
    if (!activeTurn) return;
    streamingAssistantId.current = activeTurn.assistantMessageId;
    setStreaming(true);
    setStatus(t('chat.recovering'));
    let disposed = false;
    let polling = false;
    const poll = async (): Promise<void> => {
      if (disposed || polling) return;
      polling = true;
      try {
        const snapshot = await apiGet<Snapshot>('/api/chat');
        if (disposed) return;
        applySnapshot(snapshot);
        if (!snapshot.activeTurn) {
          streamingAssistantId.current = null;
          setStreaming(false);
          setStatus(null);
        }
      } catch {
        // Offline/background: o próximo tick, `online` ou visibilitychange retoma.
      } finally {
        polling = false;
      }
    };
    const onResume = (): void => {
      if (document.visibilityState === 'visible' || navigator.onLine) void poll();
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    window.addEventListener('online', onResume);
    window.addEventListener('pageshow', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('online', onResume);
      window.removeEventListener('pageshow', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [activeTurn?.id]);

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
      behavior: 'auto',
    });
  }, [messages, nearBottom]);

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
    const userScrolledUp =
      Date.now() <= userScrollIntentUntilRef.current &&
      isUserScrollUp(prevScrollTopRef.current, scrollTop);

    setShowScrollLatest((current) =>
      nextScrollLatestVisibility({
        current,
        distanceToBottom,
        userScrolledUp,
        returningToEnd: returningToEndRef.current,
      }),
    );

    if (returningToEndRef.current) {
      if (distanceToBottom < SCROLL_LATEST_SHOW_DISTANCE_PX) {
        returningToEndRef.current = false;
      }
      prevScrollTopRef.current = scrollTop;
      return;
    }

    if (programmaticScrollRef.current) {
      prevScrollTopRef.current = scrollTop;
      return;
    }

    if (scrollPhaseRef.current === 'anchor' && userScrolledUp) {
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
    if (!claimPendingId(approvingHitlRef.current, id)) return;
    setApprovingHitl(new Set(approvingHitlRef.current));
    try {
      const result = await apiPost<{ message: string }>('/api/chat/approve', { approvalId: id });
      toast.success(result.message);
      if (getSoundsEnabled()) play('success');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.approveError'));
    } finally {
      // Always reload: success clears the card; stale/already-used heals ghosts.
      await refresh().catch(() => undefined);
      approvingHitlRef.current.delete(id);
      setApprovingHitl(new Set(approvingHitlRef.current));
    }
  }

  /**
   * Troca a trilha exibida para a que passa por esta versão (spec 127). Não
   * gera resposta: o servidor só reposiciona o ponteiro de folha ativa, e o
   * snapshot seguinte traz a trilha inteira.
   *
   * `replace`, não mesclagem: a trilha nova e a antiga compartilham só o
   * prefixo até o ponto de ramificação, e mesclar deixaria o ramo abandonado
   * na tela junto com o escolhido.
   */
  async function switchVersion(messageId: string): Promise<void> {
    if (streaming || switchingVersion) return;
    setEditingMessageId(null);
    setSwitchingVersion(true);
    try {
      await apiPost(`/api/chat/messages/${encodeURIComponent(messageId)}/activate`);
      applySnapshot(await apiGet<Snapshot>('/api/chat'), true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.versionSwitchError'));
    } finally {
      setSwitchingVersion(false);
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

  async function send(override?: string, branch?: BranchTarget): Promise<void> {
    const content = (override ?? input).trim();
    // `switchingVersion` no guarda: a troca de trilha grava a folha ativa e só
    // depois relê o snapshot. Um envio que entre nessa janela cria o turno
    // entre as duas operações, e o `replace` da troca apaga as bolhas otimistas
    // dele — `reconcileChatStart` só renomeia o que já está na lista, então a
    // pergunta e a resposta ficariam invisíveis até o turno acabar.
    if (!content || streaming || switchingVersion) return;
    // Espelho otimista dos anexos: o servidor devolve a forma canônica no
    // snapshot, mas a bolha já nasce com o vínculo visível.
    //
    // Reenvio de versão não mexe no composer: a versão carrega os anexos da
    // mensagem editada (os mesmos jobs, re-vinculados pelo servidor com escopo
    // de workspace), não os arquivos que o usuário deixou preparados embaixo
    // para a próxima mensagem. Sem isso, editar uma pergunta perderia em
    // silêncio o PDF que a acompanhava.
    const localAttachments: MessageAttachment[] = branch
      ? branch.attachments
      : attachments
          .filter((item) => item.status === 'done' && item.jobId)
          .slice(0, MAX_MESSAGE_ATTACHMENTS)
          .map((item) => ({
            jobId: item.jobId as string,
            name: item.name,
            kind: attachmentKind(item.name, '') ?? 'document',
          }));
    const plan = planSend({ branch, composerJobIds: readyAttachmentJobIds(attachments) });
    const attachmentJobIds = plan.attachmentJobIds;
    // Lista exibida ANTES do corte, para desfazê-lo se o turno não nascer. O
    // snapshot não serve de rollback: ele devolve só os últimos 60 da trilha
    // (`getChatSnapshot`), então numa conversa longa a mesclagem com o prefixo
    // cortado deixaria um buraco no meio da conversa.
    const trailBeforeBranch = branch ? messages : null;
    /**
     * O servidor aceitou o reenvio — a partir daqui a versão EXISTE no banco e
     * o corte não pode mais ser desfeito. A rota cria o turno antes de abrir o
     * stream, então o 2xx é o sinal exato; esperar o evento `start` deixaria
     * uma janela em que a versão já existe e um rollback empilharia as duas
     * versões da mesma pergunta na tela.
     */
    let versionCreated = false;
    /**
     * Desfaz o corte quando NENHUM snapshot pôde ser lido (offline de verdade).
     * Sem isso a tela fica com o prefixo cortado mais duas bolhas otimistas
     * órfãs, e nada se auto-cura: `persistedActiveTurn` é nulo, o poll de
     * recuperação não liga, e o histórico só volta num reload.
     *
     * A decisão de restaurar (ou não, quando o turno já nasceu) mora em
     * `planBranchRollback`, testável sem montar a página inteira.
     */
    function restoreBranchTrail(): void {
      setMessages(
        (current) => planBranchRollback({ trailBeforeBranch, current, versionCreated }) ?? current,
      );
    }
    const localStartedAt = new Date().toISOString();
    const localUser: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: 'USER',
      kind: 'NORMAL',
      content,
      tools: null,
      attachments: localAttachments,
      compactedAt: null,
      createdAt: localStartedAt,
    };
    const localAssistant: ChatMessage = {
      id: `local-assistant-${crypto.randomUUID()}`,
      role: 'ASSISTANT',
      kind: 'NORMAL',
      content: '',
      tools: [],
      compactedAt: null,
      createdAt: localStartedAt,
    };
    let liveUserMessageId = localUser.id;
    let liveAssistantMessageId = localAssistant.id;
    streamingAssistantId.current = localAssistant.id;
    liveSegmentsRef.current = null;
    pendingAnchorIdRef.current = localUser.id;
    // Bloqueia reengage até chegar texto final (tools/raciocínio não desancoram).
    allowAnchorReengageRef.current = false;
    scrollPhaseRef.current = 'free';
    // Reenvio de versão recorta a trilha no ponto de ramificação: a mensagem
    // editada e tudo que veio depois dela saem da tela, porque a versão nova
    // nasce IRMÃ dela e o snapshot seguinte não as traz de volta.
    setMessages((current) => [
      ...(branch ? truncateTrailFrom(current, branch.messageId) : current),
      localUser,
      localAssistant,
    ]);
    if (plan.clearsComposer) setInput('');
    // Chips que saem do composer QUANDO o servidor aceitar a mensagem: os
    // prontos (foram vinculados) e os que falharam (erro já avisado por
    // toast). Uploads em andamento seguem no composer e valem para a próxima
    // mensagem. Limpar aqui, antes do POST, perdia os anexos em 409 (turno
    // ocupado), 429 (rate limit) ou queda de rede — a mensagem não era criada
    // e não há como re-vincular um job existente, restando subir o arquivo de
    // novo. Guardamos os ids em vez de filtrar por status depois, para não
    // levar junto um anexo que o usuário adicionou durante a requisição.
    const consumedAttachmentIds = new Set<string>(
      plan.clearsComposer
        ? attachments.filter((item) => item.status !== 'uploading').map((item) => item.id)
        : [],
    );
    setNearBottom(false);
    setShowScrollLatest(false);
    setStreaming(true);
    setStatus(t('chat.thinking'));
    const controller = new AbortController();
    abortRef.current = controller;
    let persistedActiveTurn: ActiveTurn | null = null;

    try {
      const response = await fetch(plan.endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          attachmentJobIds.length > 0 ? { content, attachmentJobIds } : { content },
        ),
        signal: controller.signal,
      });
      // Antes da checagem de corpo, de propósito: um 2xx sem `body` ainda
      // significa turno criado, e marcar depois deixaria o rollback achar que
      // a versão não existe.
      versionCreated = response.ok;
      if (!response.ok || !response.body) throw new Error(t('chat.streamStartError'));
      // Mensagem aceita: só agora os chips consumidos saem do composer.
      setAttachments((current) => current.filter((item) => !consumedAttachmentIds.has(item.id)));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const apply = (event: StreamEvent): void => {
        if (event.type === 'start') {
          const previousUserMessageId = liveUserMessageId;
          const previousAssistantMessageId = liveAssistantMessageId;
          liveUserMessageId = event.userMessageId;
          liveAssistantMessageId = event.assistantMessageId;
          streamingAssistantId.current = event.assistantMessageId;
          if (pendingAnchorIdRef.current === previousUserMessageId)
            pendingAnchorIdRef.current = event.userMessageId;
          setMessages((current) =>
            reconcileChatStart(current, previousUserMessageId, previousAssistantMessageId, event),
          );
        } else if (event.type === 'text') {
          // Texto final: libera reengage se o conteúdo preencher o viewport.
          allowAnchorReengageRef.current = true;
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== liveAssistantMessageId) return message;
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
              if (message.id !== liveAssistantMessageId) return message;
              const segments = applySegmentEvent(message.segments ?? [], event, Date.now());
              liveSegmentsRef.current = segments;
              return { ...message, segments };
            }),
          );
        } else if (event.type === 'status') {
          const statusKey = chatStatusI18nKey(event.code);
          setStatus(statusKey ? t(statusKey) : event.label);
        } else if (event.type === 'tool') {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== liveAssistantMessageId) return message;
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
      persistedActiveTurn = snapshot.activeTurn;
      applySnapshot(snapshot);
    } catch (error) {
      // Desconexão de transporte (Bun idle / proxy / rede) ≠ falha do turno.
      // Tenta recuperar o estado canônico antes de alarmar o usuário.
      //
      // Num reenvio, o snapshot de recuperação entra como `replace`, nunca
      // mesclado. Aqui não dá para saber se a versão chegou a ser criada: se
      // foi, mesclar traria a mensagem editada de volta ao lado da versão nova;
      // se não foi, mesclar com o prefixo cortado abre um buraco, porque o
      // snapshot é só uma janela da trilha. Substituir acerta nos dois casos —
      // a janela é sempre contígua e `hasOlder`/`nextCursor` vêm com ela.
      if (!controller.signal.aborted) {
        try {
          const snapshot = await apiGet<Snapshot>('/api/chat');
          persistedActiveTurn = snapshot.activeTurn;
          applySnapshot(snapshot, Boolean(branch));
          if (snapshot.activeTurn) {
            // Turno ainda roda no servidor — sem toast de erro; UI mostra recovering.
          } else if (isTransientStreamDisconnect(error)) {
            toast.error(t('chat.streamDisconnected'));
          } else {
            toast.error(error instanceof Error ? error.message : t('chat.streamError'));
          }
        } catch {
          restoreBranchTrail();
          if (isTransientStreamDisconnect(error)) {
            toast.error(t('chat.streamDisconnected'));
          } else {
            toast.error(error instanceof Error ? error.message : t('chat.streamError'));
          }
        }
      } else {
        try {
          const snapshot = await apiGet<Snapshot>('/api/chat');
          persistedActiveTurn = snapshot.activeTurn;
          applySnapshot(snapshot, Boolean(branch));
        } catch {
          // Offline: o turno continua durável e será restaurado no próximo acesso.
          restoreBranchTrail();
        }
      }
    } finally {
      abortRef.current = null;
      liveSegmentsRef.current = null;
      // Turno acabou: se o conteúdo já encheu a reserva, pode colar no fundo.
      allowAnchorReengageRef.current = true;
      if (persistedActiveTurn) {
        streamingAssistantId.current = persistedActiveTurn.assistantMessageId;
        setStreaming(true);
        setStatus(t('chat.recovering'));
      } else {
        streamingAssistantId.current = null;
        setStreaming(false);
        setStatus(null);
      }
    }
  }

  async function stopStreaming(): Promise<void> {
    await apiPost('/api/chat/cancel').catch(() => undefined);
    abortRef.current?.abort();
    try {
      const snapshot = await apiGet<Snapshot>('/api/chat');
      applySnapshot(snapshot);
    } catch {
      // A confirmação visual será reconciliada no próximo refresh.
    }
    streamingAssistantId.current = null;
    setActiveTurn(null);
    setStreaming(false);
    setStatus(null);
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
            onStop={() => void stopStreaming()}
            attachments={attachments}
            onAttachFile={(file) => void startUpload(file)}
            onRemoveAttachment={removeAttachment}
            autoFocus
            className="w-full max-w-3xl"
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
            onWheelCapture={markUserScrollIntent}
            onTouchMoveCapture={markUserScrollIntent}
            onKeyDownCapture={(event) => {
              if (
                event.key === 'ArrowUp' ||
                event.key === 'PageUp' ||
                event.key === 'Home' ||
                (event.key === ' ' && event.shiftKey)
              ) {
                markUserScrollIntent();
              }
            }}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.right - event.clientX <= 24) markUserScrollIntent();
            }}
            role="log"
            aria-live="off"
            aria-label={t('chat.historyLabel')}
            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-5 pt-12 md:py-5"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col">
              <div ref={contentWrapRef} className="flex flex-col">
                {hasOlder && (
                  <button
                    type="button"
                    onClick={() => void loadOlderMessages()}
                    disabled={loadingOlder}
                    className="mb-5 inline-flex min-h-11 self-center items-center gap-2 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-4 py-2 text-xs font-medium text-[var(--color-app-subtle)] transition-colors hover:text-[var(--color-app-fg)] disabled:opacity-60"
                  >
                    {loadingOlder && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    {loadingOlder ? t('chat.loadingOlder') : t('chat.loadOlder')}
                  </button>
                )}
                {visibleMessages.map((message) => {
                  const isStreamingAssistant =
                    streaming && message.id === streamingAssistantId.current;
                  if (message.role === 'USER') {
                    // Bolha ainda otimista não tem id no banco: versionar iria
                    // para um 404. Some assim que o evento `start` reconcilia.
                    const unpersisted = message.id.startsWith('local-');
                    return (
                      <article
                        key={message.id}
                        data-message-id={message.id}
                        className="group mb-5 flex flex-col items-end"
                      >
                        {editingMessageId === message.id ? (
                          <MessageEditForm
                            initialText={message.content}
                            disabled={streaming || switchingVersion}
                            onCancel={() => setEditingMessageId(null)}
                            onSubmit={(content) => {
                              setEditingMessageId(null);
                              void send(content, {
                                messageId: message.id,
                                attachments: message.attachments ?? [],
                              });
                            }}
                            t={t}
                          />
                        ) : (
                          <>
                            <div className="max-w-[85%] break-words rounded-2xl rounded-br-md bg-[var(--color-accent-primary-soft)] px-4 py-2.5 text-[14.5px] leading-relaxed text-[var(--color-app-fg)] ring-1 ring-[var(--color-accent-primary)]/15">
                              {message.content}
                            </div>
                            <MessageAttachments attachments={message.attachments} />
                            <div className="mt-1.5 flex items-center gap-0.5 self-end">
                              <UserMessageActions
                                versions={message.versions}
                                streaming={streaming}
                                pending={switchingVersion || unpersisted}
                                onEdit={() => setEditingMessageId(message.id)}
                                onNavigate={(id) => void switchVersion(id)}
                                t={t}
                              />
                              <MessageCopyButton text={message.content} align="end" layout="row" />
                            </div>
                          </>
                        )}
                      </article>
                    );
                  }
                  const segments = message.segments ?? segmentsFromPersistedTools(message.tools);
                  return (
                    <article key={message.id} className="group mb-6 flex flex-col">
                      {segments.length > 0 && (
                        <ThinkingBlock
                          segments={segments}
                          live={isStreamingAssistant}
                          answering={message.content.length > 0}
                          startedAt={Date.parse(message.createdAt)}
                        />
                      )}
                      {message.content && (
                        <>
                          <div className="text-[15px] leading-relaxed text-[var(--color-app-fg)]">
                            <Markdown className="chat-response-markdown [&_p]:max-w-3xl [&_ul]:max-w-3xl [&_ol]:max-w-3xl [&_blockquote]:max-w-3xl">
                              {message.content}
                            </Markdown>
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

              {showScrollLatest && (
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
              <HitlConfirmBar
                pending={pendingHitl}
                approving={approvingHitl}
                onApprove={(id) => void approve(id)}
              />
              <Composer
                input={input}
                setInput={setInput}
                streaming={streaming}
                busy={switchingVersion}
                onSend={() => void send()}
                onStop={() => void stopStreaming()}
                attachments={attachments}
                onAttachFile={(file) => void startUpload(file)}
                onRemoveAttachment={removeAttachment}
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
