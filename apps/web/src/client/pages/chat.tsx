import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Library,
  ListVideo,
  Network,
  Search,
  Sparkles,
  StickyNote,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '../components/ui/spinner';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Markdown } from '../components/ui/markdown';
import {
  PromptBox,
  type LibraryMentionItem,
  type PromptBoxHandle,
} from '../components/ui/prompt-box';
import { useMe } from '../lib/hooks';
import { cn } from '../lib/utils';
import {
  type ConvSummary,
  createConversation,
  patchLocalConversation,
  refreshConversations,
} from '../lib/use-conversations';
import { useChatContextState } from '../lib/chat-context-ctx';
import { useI18n, type TranslateFn, type I18nKey } from '../lib/i18n';

interface ToolSource {
  url: string;
  title: string;
}

// Execução de tool exibida na mensagem (ver .specs/026). Mensagens antigas
// só têm {name, preview} — todos os campos extras são opcionais.
interface ChatTool {
  name: string;
  args?: Record<string, unknown>;
  preview?: string;
  sources?: ToolSource[];
  actionSummary?: string;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind?: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
  content: string;
  // `actionSummary` é populado quando a tool é request_user_confirmation —
  // o backend envia o resumo cru no SSE pra UI renderizar o banner HITL
  // sem precisar parsear o JSON do preview (que pode estar truncado).
  tools?: ChatTool[];
  pending?: boolean;
  // Raciocínio em streaming (thinking mode). Renderizado num bloco
  // colapsável antes do content final.
  reasoning?: string;
}

interface CompactionInfo {
  summary: string;
  tokens_before: number;
  tokens_after: number;
  limit: number;
  cost_usd: string;
}

const THINKING_KEY = 'voxen:chat:thinking';
const DOCUMENT_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

interface UploadJobResponse {
  jobId: string;
  kind: 'media' | 'image' | 'document';
}

interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind?: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
  content: string;
  tools?: unknown;
}

interface ChatPrefillState {
  text: string;
  mentions?: LibraryMentionItem[];
}

export function ChatPage(): React.ReactElement {
  const { id: routeId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { t } = useI18n();

  const [active, setActive] = useState<ConvSummary | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<LibraryMentionItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  // Contexto/compactação — atualizado via SSE events. Modal mostra o
  // último resumo de compactação.
  // Estado de contexto/compactação fica em ChatContextProvider — Topbar
  // consome direto pra mostrar a barrinha ao lado do avatar do user.
  const {
    setUsage: setContextUsage,
    lastCompaction,
    setLastCompaction,
    openSummarySignal,
  } = useChatContextState();
  const [compactionModalOpen, setCompactionModalOpen] = useState(false);
  // Quando user clica "Ver resumo" no Topbar, abre o modal aqui.
  useEffect(() => {
    if (openSummarySignal > 0) setCompactionModalOpen(true);
  }, [openSummarySignal]);
  // Limpa o usage quando a página /chat desmonta — senão fica residual em
  // outras páginas.
  useEffect(() => {
    return () => {
      setContextUsage(null);
    };
  }, [setContextUsage]);
  // Vision: imagem anexada (data URL). Quando setada, é enviada no body do
  // send → chat service usa default_vision_model. Limpa após envio.
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [documentEnabled, setDocumentEnabled] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  useEffect(() => {
    // Detecta se o admin configurou modelo de visão pra habilitar o botão
    fetch('/api/capabilities', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { vision?: boolean; document?: boolean }) => {
        setVisionEnabled(!!d.vision);
        setDocumentEnabled(!!d.document);
      })
      .catch(() => {
        setVisionEnabled(false);
        setDocumentEnabled(false);
      });
  }, []);
  const [thinking, setThinking] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(THINKING_KEY) === '1';
    } catch {
      return false;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<PromptBoxHandle>(null);

  const loadActive = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(`/api/chat/conversations/${id}`, { credentials: 'include' });
      if (!res.ok) {
        toast.error(t('chat.notFound'));
        navigate('/chat', { replace: true });
        return;
      }
      const data = (await res.json()) as {
        conversation: {
          id: string;
          title: string;
          thinking: boolean;
          updatedAt: string;
          createdAt: string;
          compactionCount?: number;
        };
        messages: {
          id: string;
          role: 'user' | 'assistant' | 'system';
          kind?: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
          content: string;
          tools?: unknown;
          createdAt: string;
        }[];
        contextUsage?: { tokens: number; limit: number };
      };
      // Popula o ContextBar do Topbar IMEDIATAMENTE com a estimativa
      // server-side — não espera o user mandar nova msg (SSE context_usage).
      if (data.contextUsage) {
        setContextUsage(data.contextUsage);
      }
      setActive({
        id: data.conversation.id,
        title: data.conversation.title,
        thinking: data.conversation.thinking,
        updatedAt: data.conversation.updatedAt,
        createdAt: data.conversation.createdAt,
        messageCount: data.messages.length,
      });
      setThinking(data.conversation.thinking);
      // Mensagens role=system kind=COMPACTION_SUMMARY são meta — não viram bubble.
      // A mais recente alimenta `lastCompaction` pra o botão "Ver resumo".
      const summaries = data.messages.filter((m) => m.kind === 'COMPACTION_SUMMARY');
      const latestSummary = summaries[summaries.length - 1];
      if (latestSummary) {
        setLastCompaction({
          summary: latestSummary.content,
          tokens_before: 0,
          tokens_after: 0,
          limit: 0,
          cost_usd: '0',
        });
      } else {
        setLastCompaction(null);
      }
      setMessages(
        data.messages
          .filter((m) => m.kind !== 'COMPACTION_SUMMARY')
          .map((m) => ({
            id: m.id,
            role: m.role,
            kind: m.kind,
            content: m.content,
            tools: (m.tools as ChatTool[] | null) ?? undefined,
          })),
      );
    },
    [navigate, t],
  );

  useEffect(() => {
    if (!routeId) {
      setActive(null);
      setMessages([]);
      return;
    }
    void loadActive(routeId);
  }, [routeId, loadActive]);

  useEffect(() => {
    const state = location.state as { prefill?: ChatPrefillState } | null;
    const prefill = state?.prefill;
    if (!prefill) return;
    setInput(prefill.text);
    setSelectedMentions((prefill.mentions ?? []).slice(0, 8));
    requestAnimationFrame(() => promptRef.current?.focus());
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THINKING_KEY, thinking ? '1' : '0');
    } catch {
      // ignora
    }
  }, [thinking]);

  async function toggleThinking(): Promise<void> {
    const next = !thinking;
    setThinking(next);
    if (active) {
      patchLocalConversation(active.id, { thinking: next });
      await fetch(`/api/chat/conversations/${active.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thinking: next }),
      }).catch(() => undefined);
    }
  }

  // HITL: clique nos botões do ConfirmationPrompt envia uma mensagem com
  // flag hitl=true. Backend marca kind=HITL_RESPONSE; UI renderiza como
  // chip "✓ Aprovado" / "✗ Cancelado" em vez de bubble cheio.
  async function respondToConfirmation(approved: boolean): Promise<void> {
    if (streaming) return;
    const reply = approved ? t('chat.hitlApproveMessage') : t('chat.hitlRejectMessage');
    void send(reply, { hitl: true });
  }

  async function send(overrideText?: string, options?: { hitl?: boolean }): Promise<void> {
    const text = (overrideText ?? input).trim();
    // Permite enviar só imagem com texto curto ou apenas imagem (vision)
    if (!text && !attachedImage) return;
    if (streaming) return;

    let convId = active?.id;
    if (!convId) {
      const created = await createConversation(text.slice(0, 60));
      if (!created) {
        toast.error(t('chat.startError'));
        return;
      }
      setActive(created);
      convId = created.id;
      window.history.replaceState(null, '', `/chat/${convId}`);
    }

    const userMsg: Msg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      kind: options?.hitl ? 'HITL_RESPONSE' : 'NORMAL',
    };
    const asstId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      userMsg,
      { id: asstId, role: 'assistant', content: '', tools: [], pending: true },
    ]);
    setInput('');
    setStreaming(true);

    try {
      // Intl detecta o timezone IANA do user (ex: "America/Sao_Paulo"). Server
      // encaminha pro chat service injetar no system prompt (data/hora real).
      const userTz =
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
      const sentImage = attachedImage;
      const sentMentions = selectedMentions.filter((m) => text.includes(`@${m.label}`));
      // Limpa o anexo local antes do request — UX: imagem some assim que
      // user envia, sem precisar esperar streaming terminar.
      setAttachedImage(null);
      setSelectedMentions([]);
      const res = await fetch(`/api/chat/conversations/${convId}/send`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-User-Timezone': userTz,
        },
        body: JSON.stringify({
          content: text,
          ...(sentImage ? { image_data_url: sentImage } : {}),
          ...(sentMentions.length > 0 ? { mentions: sentMentions } : {}),
          ...(options?.hitl ? { hitl: true } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? { ...x, pending: false, content: `⚠️ ${err.error ?? t('chat.requestError')}` }
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
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!block) continue;
          const ev = block.match(/^event:\s*(.+)$/m)?.[1];
          const data = block.match(/^data:\s*(.+)$/m)?.[1];
          if (!ev || !data) continue;
          const payload = JSON.parse(data) as Record<string, unknown>;
          if (ev === 'token') {
            const t = (payload.text as string) ?? '';
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId ? { ...x, pending: false, content: x.content + t } : x,
              ),
            );
          } else if (ev === 'reasoning_token') {
            // Raciocínio do modelo (thinking mode). Renderiza num bloco
            // colapsável dentro da bubble, antes do content final.
            const t = (payload.text as string) ?? '';
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId ? { ...x, pending: false, reasoning: (x.reasoning ?? '') + t } : x,
              ),
            );
          } else if (ev === 'tool_start') {
            const name = (payload.name as string) ?? '';
            const args = (payload.args as Record<string, unknown> | undefined) ?? undefined;
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId ? { ...x, tools: [...(x.tools ?? []), { name, args }] } : x,
              ),
            );
          } else if (ev === 'tool_end') {
            const name = (payload.name as string) ?? '';
            const preview = (payload.preview as string) ?? '';
            const actionSummary = (payload.action_summary as string | undefined) ?? undefined;
            const sources = (payload.sources as ToolSource[] | undefined) ?? undefined;
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId
                  ? {
                      ...x,
                      tools: (x.tools ?? []).map((t, i, arr) =>
                        i === arr.length - 1 && t.name === name
                          ? { ...t, preview, actionSummary, sources }
                          : t,
                      ),
                    }
                  : x,
              ),
            );
          } else if (ev === 'error') {
            const msg = (payload.message as string) ?? t('chat.unexpectedError');
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId
                  ? { ...x, pending: false, content: x.content + `\n\n⚠️ ${msg}` }
                  : x,
              ),
            );
          } else if (ev === 'context_usage') {
            setContextUsage({
              tokens: Number(payload.tokens ?? 0),
              limit: Number(payload.limit ?? 0),
            });
          } else if (ev === 'compaction_done') {
            const info: CompactionInfo = {
              summary: String(payload.summary ?? ''),
              tokens_before: Number(payload.tokens_before ?? 0),
              tokens_after: Number(payload.tokens_after ?? 0),
              limit: Number(payload.limit ?? 0),
              cost_usd: String(payload.cost_usd ?? '0'),
            };
            setLastCompaction(info);
            setContextUsage({ tokens: info.tokens_after, limit: info.limit });
            toast.success(t('chat.compacted'), {
              description: t('chat.compactedDescription', {
                before: info.tokens_before.toLocaleString(),
                after: info.tokens_after.toLocaleString(),
              }),
              action: {
                label: t('chat.viewSummary'),
                onClick: () => setCompactionModalOpen(true),
              },
            });
          } else if (ev === 'compaction_failed') {
            // Tentou compactar mas falhou — provavelmente vai estourar contexto
            // na próxima chamada ao modelo. Avisa o user.
            toast.warning(t('chat.compactionFailed'), {
              description: (payload.error as string) ?? t('chat.compactionFailedDescription'),
            });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('chat.connectionError');
      setMessages((m) =>
        m.map((x) =>
          x.id === asstId ? { ...x, pending: false, content: x.content + `\n\n⚠️ ${msg}` } : x,
        ),
      );
    } finally {
      setStreaming(false);
      void refreshConversations();
    }
  }

  const empty = messages.length === 0 && !active;

  // === Drag-and-drop de imagens ===
  // Aceita só image/* (PNG/JPEG/WEBP/GIF) com no máx 5MB pra bater com o cap
  // do backend (apps/web/src/routes/chat.ts). Pinta um overlay durante drag.
  const [isDragging, setIsDragging] = useState(false);

  function handleImageFile(file: File): void {
    if (!visionEnabled) {
      toast.error(t('chat.visionDisabled'));
      return;
    }
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      toast.error(t('chat.unsupportedFormat'), {
        description: t('chat.acceptedImages'),
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('chat.imageTooLarge'), { description: t('chat.imageLimit') });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') setAttachedImage(result);
    };
    reader.onerror = () => toast.error(t('chat.readFileError'));
    reader.readAsDataURL(file);
  }

  async function uploadFileFromChat(file: File): Promise<void> {
    if (streaming || uploadingFile) return;
    if (!documentEnabled) {
      toast.error(t('chat.documentsDisabled'), {
        description: t('chat.documentsDisabledDescription'),
      });
      return;
    }
    if (file.size > DOCUMENT_UPLOAD_LIMIT_BYTES) {
      toast.error(t('chat.documentTooLarge'), { description: t('chat.documentLimit') });
      return;
    }

    let convId = active?.id;
    if (!convId) {
      const created = await createConversation(`Upload: ${file.name}`.slice(0, 60));
      if (!created) {
        toast.error(t('chat.startError'));
        return;
      }
      setActive(created);
      convId = created.id;
      window.history.replaceState(null, '', `/chat/${convId}`);
    }

    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append('media', file);
      const uploadRes = await fetch('/api/jobs/upload', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const uploadBody = (await uploadRes.json().catch(() => ({}))) as
        | UploadJobResponse
        | { error?: string };
      if (!uploadRes.ok || !('jobId' in uploadBody)) {
        const error = 'error' in uploadBody ? uploadBody.error : undefined;
        toast.error(error ?? t('chat.documentSendError'));
        return;
      }

      const msgRes = await fetch(`/api/chat/conversations/${convId}/file-message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          jobId: uploadBody.jobId,
          kind: uploadBody.kind,
        }),
      });
      const msgBody = (await msgRes.json().catch(() => ({}))) as {
        messages?: PersistedChatMessage[];
        error?: string;
      };
      if (!msgRes.ok || !Array.isArray(msgBody.messages)) {
        toast.error(msgBody.error ?? t('chat.documentRegisterError'));
        return;
      }
      setMessages((items) => [
        ...items,
        ...msgBody.messages!.map((m) => ({
          id: m.id,
          role: m.role,
          kind: m.kind,
          content: m.content,
          tools: (m.tools as ChatTool[] | null) ?? undefined,
        })),
      ]);
      toast.success(t('chat.documentSent'), {
        action: {
          label: t('chat.openQueue'),
          onClick: () => navigate(`/jobs/${uploadBody.jobId}`),
        },
      });
      void refreshConversations();
    } catch (err) {
      toast.error(t('chat.documentUploadError'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setUploadingFile(false);
    }
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      if (!isDragging) setIsDragging(true);
    }
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    // Só apaga quando o leave for do container raiz, não de filhos
    if (e.currentTarget === e.target) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      handleImageFile(file);
      return;
    }
    void uploadFileFromChat(file);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="flex flex-col h-full relative"
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <motion.div
          key={routeId ?? 'empty'}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl px-6 py-8 space-y-5"
        >
          {empty && <EmptyState onPick={(s) => promptRef.current?.setValue(s)} t={t} />}
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Bubble
                  msg={m}
                  user={me?.user ?? null}
                  t={t}
                  onConfirmAction={(approved) => void respondToConfirmation(approved)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="shrink-0 bg-gradient-to-t from-[var(--color-app-bg)] via-[var(--color-app-bg)]/95 to-transparent pt-4"
      >
        <div className="mx-auto max-w-3xl px-6 pb-4">
          <PromptBox
            ref={promptRef}
            value={input}
            onChange={setInput}
            onSubmit={() => void send()}
            disabled={streaming}
            loading={streaming}
            thinking={thinking}
            onToggleThinking={() => void toggleThinking()}
            attachedImage={attachedImage}
            onAttachImage={(d) => setAttachedImage(d)}
            onClearImage={() => setAttachedImage(null)}
            visionEnabled={visionEnabled}
            uploadEnabled={documentEnabled}
            uploadingFile={uploadingFile}
            onUploadFile={(file) => void uploadFileFromChat(file)}
            selectedMentions={selectedMentions}
            onMentionSelect={(item) =>
              setSelectedMentions((items) => {
                if (items.some((x) => x.type === item.type && x.id === item.id)) return items;
                return [...items, item].slice(-8);
              })
            }
            onMentionRemove={(item) => {
              setSelectedMentions((items) =>
                items.filter((x) => !(x.type === item.type && x.id === item.id)),
              );
              setInput((current) => current.replace(`@${item.label}`, '').replace(/\s{2,}/g, ' '));
            }}
          />
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] mt-2 text-center">
            {t('chat.inputHint')}
          </p>
        </div>
      </motion.div>

      {/* Modal de resumo da última compactação */}
      <CompactionModal
        open={compactionModalOpen}
        onOpenChange={setCompactionModalOpen}
        info={lastCompaction}
        t={t}
      />

      {/* Overlay durante drag-and-drop de imagem/documento */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-violet-500/10 backdrop-blur-sm"
          >
            <div className="rounded-2xl border-2 border-dashed border-violet-400/60 bg-zinc-950/80 px-8 py-6 text-center">
              <p className="text-base font-medium text-violet-200">{t('chat.dropTitle')}</p>
              <p className="text-xs text-zinc-400 mt-1">{t('chat.dropDescription')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CompactionModal({
  open,
  onOpenChange,
  info,
  t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  info: CompactionInfo | null;
  t: TranslateFn;
}): React.ReactElement | null {
  if (!info) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] rounded-2xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] overflow-hidden flex flex-col"
          >
            <header className="px-6 py-4 border-b border-[var(--color-app-border)] flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  {t('chat.summaryTitle')}
                </h2>
                <p className="text-[11px] text-[var(--color-app-muted)] tabular-nums">
                  {info.tokens_before.toLocaleString()} → {info.tokens_after.toLocaleString()}{' '}
                  tokens
                  {' · '}
                  {t('chat.summaryCost', { cost: formatCost(info.cost_usd) })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors"
                aria-label={t('common.close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              <Markdown>{info.summary}</Markdown>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function formatCost(usd: string): string {
  const n = parseFloat(usd);
  if (!isFinite(n) || n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function Bubble({
  msg,
  user,
  t,
  onConfirmAction,
}: {
  msg: Msg;
  user: { name: string; image?: string | null } | null;
  t: TranslateFn;
  onConfirmAction?: (approved: boolean) => void;
}): React.ReactElement {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = useState(false);

  // HITL response: clique nos botões do ConfirmationPrompt. Renderiza como
  // chip compacto à direita em vez de bubble cheio — evita poluir a conversa
  // com texto "Sim, pode prosseguir...".
  if (msg.kind === 'HITL_RESPONSE') {
    const lowerContent = msg.content.toLowerCase();
    const approved = lowerContent.startsWith('sim') || lowerContent.startsWith('yes');
    return (
      <div className="flex justify-end pr-1 -my-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border',
            approved
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
          )}
          title={msg.content}
        >
          {approved ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          {approved ? t('chat.approved') : t('chat.cancelled')}
        </span>
      </div>
    );
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {isUser ? <UserAvatar user={user} /> : <VoxAvatar />}

      <div
        className={cn(
          'flex flex-col gap-2 min-w-0 max-w-[85%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {!isUser && msg.tools && msg.tools.length > 0 && (
          <ToolActivity tools={msg.tools} pending={!!msg.pending} t={t} />
        )}

        <div
          className={cn(
            'group rounded-2xl leading-relaxed',
            // User mantém bubble visual com fundo claro; IA fica sem fundo,
            // só texto puro — pedido do owner pra reduzir poluição visual.
            isUser ? 'bg-zinc-100 text-zinc-900 text-[14.5px] px-4 py-3' : 'text-zinc-100 py-1',
          )}
        >
          {msg.pending && !msg.content ? (
            <span className="inline-flex items-center gap-2 text-[var(--color-app-muted)] text-[14px]">
              <Spinner /> {t('chat.thinking')}
            </span>
          ) : isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <>
              {/* HITL: tool request_user_confirmation gera banner. Backend
                  envia `action_summary` cru no payload SSE — não dependemos
                  do preview (truncado) pra renderizar. Fallback de parse só
                  se actionSummary ausente (compat com server antigo). */}
              {(() => {
                const conf = (msg.tools ?? []).find((t) => t.name === 'request_user_confirmation');
                if (!conf) return null;
                let action = conf.actionSummary ?? '';
                if (!action && conf.preview) {
                  try {
                    const parsed = JSON.parse(conf.preview) as { action_summary?: string };
                    action = parsed.action_summary ?? '';
                  } catch {
                    // preview truncado/inválido — ignora
                  }
                }
                if (!action) return null;
                return (
                  <ConfirmationPrompt
                    action={action}
                    onConfirm={() => onConfirmAction?.(true)}
                    onReject={() => onConfirmAction?.(false)}
                    t={t}
                  />
                );
              })()}
              {msg.reasoning && msg.reasoning.length > 0 && (
                <ReasoningBlock text={msg.reasoning} streaming={!!msg.pending} t={t} />
              )}
              <Markdown>{msg.content}</Markdown>
              <SourcesSection tools={msg.tools} t={t} />
              {msg.content.length > 0 && (
                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-[var(--color-app-border)] opacity-60 hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors px-2 py-0.5 rounded-md hover:bg-[var(--color-app-surface-hover)]"
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Atividade de tools + fontes (ver .specs/026)
// ----------------------------------------------------------------------------

const TOOL_ICONS: Record<string, typeof Wand2> = {
  web_search: Globe,
  scrape_url: Globe,
  search_transcripts: Search,
  search_notes: Search,
  brain_search: Network,
  brain_neighbors: Network,
  brain_sources: Network,
  brain_path: Network,
  list_transcripts: ListVideo,
  transcribe_video: Video,
  read_transcript: FileText,
  read_transcript_section: FileText,
  read_transcript_summary: FileText,
  get_metadata: FileText,
  list_notes: StickyNote,
  read_note: StickyNote,
  create_note: StickyNote,
  edit_note: StickyNote,
  delete_note: StickyNote,
};

const TOOL_LABEL_KEYS: Record<string, I18nKey> = {
  web_search: 'tools.web_search',
  scrape_url: 'tools.scrape_url',
  search_transcripts: 'tools.search_transcripts',
  search_notes: 'tools.search_notes',
  brain_search: 'tools.brain_search',
  brain_neighbors: 'tools.brain_neighbors',
  brain_sources: 'tools.brain_sources',
  brain_path: 'tools.brain_path',
  list_transcripts: 'tools.list_transcripts',
  transcribe_video: 'tools.transcribe_video',
  read_transcript: 'tools.read_transcript',
  read_transcript_section: 'tools.read_transcript_section',
  read_transcript_summary: 'tools.read_transcript_summary',
  get_metadata: 'tools.get_metadata',
  list_notes: 'tools.list_notes',
  read_note: 'tools.read_note',
  create_note: 'tools.create_note',
  edit_note: 'tools.edit_note',
  delete_note: 'tools.delete_note',
};

// Resumo curto do argumento principal pro header do card (query da pesquisa,
// URL do vídeo, etc). Tools sem arg "humano" não mostram resumo.
function toolArgSummary(tool: ChatTool): string | null {
  const args = tool.args ?? {};
  const candidate =
    args.query ?? args.url ?? args.title ?? args.transcript_id ?? args.note_id ?? args.source_id;
  if (typeof candidate !== 'string') return null;
  const text = candidate.trim();
  if (!text) return null;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function ToolActivity({
  tools,
  pending,
  t,
}: {
  tools: ChatTool[];
  pending: boolean;
  t: TranslateFn;
}): React.ReactElement | null {
  // HITL tem banner próprio (ConfirmationPrompt) — fica fora da atividade.
  const visible = tools.filter((tool) => tool.name !== 'request_user_confirmation');
  if (visible.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-1">
      {visible.map((tool, i) => (
        <ToolActivityCard
          key={i}
          tool={tool}
          running={pending && tool.preview === undefined && i === visible.length - 1}
          t={t}
        />
      ))}
    </div>
  );
}

function ToolActivityCard({
  tool,
  running,
  t,
}: {
  tool: ChatTool;
  running: boolean;
  t: TranslateFn;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[tool.name] ?? Wand2;
  const labelKey = TOOL_LABEL_KEYS[tool.name];
  const label = labelKey ? t(labelKey) : tool.name;
  const summary = toolArgSummary(tool);
  const hasDetails = !!tool.preview || (tool.sources?.length ?? 0) > 0;
  return (
    <div className="w-full max-w-md rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/60 text-[12px]">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
          hasDetails
            ? 'cursor-pointer hover:bg-[var(--color-app-surface-hover)]/50'
            : 'cursor-default',
          'rounded-lg transition-colors',
        )}
        aria-expanded={hasDetails ? open : undefined}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        <span className="shrink-0 font-medium text-zinc-200">{label}</span>
        {summary && <span className="truncate text-[var(--color-app-muted)]">{summary}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {running ? (
            <Spinner size={12} className="text-[var(--color-app-muted)]" />
          ) : hasDetails ? (
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform',
                open && 'rotate-180',
              )}
            />
          ) : null}
        </span>
      </button>
      {open && hasDetails && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-app-border)] px-2.5 py-2">
          {tool.sources && tool.sources.length > 0 && (
            <ul className="flex flex-col gap-1">
              {tool.sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-zinc-300 transition-colors hover:text-zinc-50"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0 text-[var(--color-app-muted)]" />
                    <span className="truncate">{s.title}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-app-muted)]">
                      {hostnameOf(s.url)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {tool.preview && (
            <pre className="max-h-40 overflow-auto rounded bg-[var(--color-app-bg)]/60 p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-[var(--color-app-subtle)]">
              {tool.preview}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SourcesSection({
  tools,
  t,
}: {
  tools?: ChatTool[];
  t: TranslateFn;
}): React.ReactElement | null {
  const all = (tools ?? []).flatMap((tool) => tool.sources ?? []);
  if (all.length === 0) return null;
  const seen = new Set<string>();
  const unique: ToolSource[] = [];
  for (const s of all) {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      unique.push(s);
    }
  }
  return (
    <div className="mt-3 border-t border-[var(--color-app-border)] pt-2">
      <div className="mb-1.5 text-[11px] font-medium tracking-wider uppercase text-[var(--color-app-muted)]">
        {t('chat.sources')}
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {unique.map((s, i) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-xs items-center gap-1.5 rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/60 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-[var(--color-app-border-strong)] hover:text-zinc-50"
            >
              <span className="text-[var(--color-app-muted)]">{i + 1}.</span>
              <span className="truncate">{s.title}</span>
              <span className="shrink-0 text-[10px] text-[var(--color-app-muted)]">
                {hostnameOf(s.url)}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UserAvatar({
  user,
}: {
  user: { name: string; image?: string | null } | null;
}): React.ReactElement {
  const initials = (user?.name ?? 'U')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Avatar className="h-7 w-7 shrink-0 mt-0.5 bg-zinc-100 border border-[var(--color-app-border-strong)]">
      {user?.image && (
        <AvatarPrimitive.Image
          src={user.image}
          alt={user.name}
          className="h-full w-full object-cover"
        />
      )}
      <AvatarFallback className="bg-zinc-100 text-zinc-900 text-[10px] font-bold tracking-wider">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

function VoxAvatar(): React.ReactElement {
  // Logo Voxen oficial — mesma do empty state e do favicon, sem fundo.
  return (
    <img
      src="/voxen-256.png"
      alt="Vox"
      draggable={false}
      className="h-7 w-7 shrink-0 mt-0.5 select-none pointer-events-none"
      style={{ height: 28, width: 28 }}
    />
  );
}

function ConfirmationPrompt({
  action,
  onConfirm,
  onReject,
  t,
}: {
  action: string;
  onConfirm: () => void;
  onReject: () => void;
  t: TranslateFn;
}): React.ReactElement {
  return (
    <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 not-prose">
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 h-7 w-7 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider font-medium text-amber-300/90 mb-1">
            {t('chat.confirmationTitle')}
          </p>
          <p className="text-[13.5px] text-zinc-100 leading-snug">{action}</p>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-100 text-[12px] font-medium hover:bg-emerald-500/30 transition-colors"
            >
              <Check className="h-3 w-3" />
              {t('chat.confirm')}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-500/15 border border-rose-500/40 text-rose-100 text-[12px] font-medium hover:bg-rose-500/25 transition-colors"
            >
              <X className="h-3 w-3" />
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReasoningBlock({
  text,
  streaming,
  t,
}: {
  text: string;
  streaming: boolean;
  t: TranslateFn;
}): React.ReactElement {
  const [open, setOpen] = useState(streaming);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="not-prose mb-3 rounded-xl border border-violet-500/25 bg-violet-500/5 overflow-hidden"
    >
      <summary className="px-3 py-2 text-[11px] uppercase tracking-wider text-violet-300 cursor-pointer select-none flex items-center gap-2 hover:bg-violet-500/10">
        <Sparkles className="h-3 w-3" />
        {streaming ? t('chat.thinking') : t('chat.reasoning')}
        <span className="ml-auto text-[10px] text-violet-300/60 font-mono">
          {t('chat.charCount', { count: text.length.toLocaleString() })}
        </span>
      </summary>
      <pre className="text-[12.5px] text-violet-100/80 px-3 py-2 whitespace-pre-wrap font-mono leading-relaxed border-t border-violet-500/20 max-h-72 overflow-y-auto">
        {text}
      </pre>
    </details>
  );
}

function EmptyState({
  onPick,
  t,
}: {
  onPick: (s: string) => void;
  t: TranslateFn;
}): React.ReactElement {
  // 4 atalhos com ícones temáticos diferentes — sugestões fixas viraram cards
  // categorizados pra reduzir poluição visual e dar afford clara de "exemplo".
  const cards: {
    icon: typeof Sparkles;
    title: string;
    hint: string;
    prompt: string;
    accent: 'violet' | 'emerald' | 'amber' | 'rose';
  }[] = [
    {
      icon: Library,
      title: t('chat.card.library.title'),
      hint: t('chat.card.library.hint'),
      prompt: t('chat.card.library.prompt'),
      accent: 'violet',
    },
    {
      icon: Sparkles,
      title: t('chat.card.summary.title'),
      hint: t('chat.card.summary.hint'),
      prompt: t('chat.card.summary.prompt'),
      accent: 'emerald',
    },
    {
      icon: ListVideo,
      title: t('chat.card.ideas.title'),
      hint: t('chat.card.ideas.hint'),
      prompt: t('chat.card.ideas.prompt'),
      accent: 'amber',
    },
    {
      icon: Search,
      title: t('chat.card.search.title'),
      hint: t('chat.card.search.hint'),
      prompt: t('chat.card.search.prompt'),
      accent: 'rose',
    },
  ];

  const accentMap = {
    violet: 'from-violet-500/30 to-violet-500/5 border-violet-500/40 text-violet-300',
    emerald: 'from-emerald-500/30 to-emerald-500/5 border-emerald-500/40 text-emerald-300',
    amber: 'from-amber-500/30 to-amber-500/5 border-amber-500/40 text-amber-300',
    rose: 'from-rose-500/30 to-rose-500/5 border-rose-500/40 text-rose-300',
  } as const;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-8">
      <div className="space-y-4">
        <img
          src="/voxen-256.png"
          alt="Voxen"
          width={88}
          height={88}
          draggable={false}
          className="mx-auto h-22 w-22 select-none pointer-events-none drop-shadow-[0_0_40px_rgba(139,92,246,0.25)]"
          style={{ height: 88, width: 88 }}
        />
        <div className="space-y-1.5 max-w-md mx-auto">
          <p className="font-display text-2xl font-semibold tracking-tight">
            {t('chat.emptyTitle', { name: 'Vox' })}
          </p>
          <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
            {t('chat.emptyDescription')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl">
        {cards.map(({ icon: Icon, title, hint, prompt, accent }) => (
          <button
            key={title}
            type="button"
            onClick={() => onPick(prompt)}
            className="group relative text-left rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/50 backdrop-blur-sm p-3.5 transition-all hover:border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface)] hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'shrink-0 h-9 w-9 rounded-lg border bg-gradient-to-br flex items-center justify-center transition-transform group-hover:scale-110',
                  accentMap[accent],
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-zinc-100 leading-tight">{title}</p>
                <p className="text-[11px] text-[var(--color-app-muted)] mt-0.5 truncate">{hint}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
