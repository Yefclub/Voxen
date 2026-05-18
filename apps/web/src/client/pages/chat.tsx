import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Check,
  Copy,
  Library,
  ListVideo,
  Search,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '../components/ui/spinner';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Markdown } from '../components/ui/markdown';
import { PromptBox, type PromptBoxHandle } from '../components/ui/prompt-box';
import { useMe } from '../lib/hooks';
import { cn } from '../lib/utils';
import {
  type ConvSummary,
  createConversation,
  patchLocalConversation,
  refreshConversations,
} from '../lib/use-conversations';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // `actionSummary` é populado quando a tool é request_user_confirmation —
  // o backend envia o resumo cru no SSE pra UI renderizar o banner HITL
  // sem precisar parsear o JSON do preview (que pode estar truncado).
  tools?: { name: string; preview?: string; actionSummary?: string }[];
  pending?: boolean;
}

const THINKING_KEY = 'voxen:chat:thinking';

export function ChatPage(): React.ReactElement {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: me } = useMe();

  const [active, setActive] = useState<ConvSummary | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
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
        toast.error('Conversa não encontrada.');
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
        };
        messages: {
          id: string;
          role: 'user' | 'assistant';
          content: string;
          tools?: unknown;
          createdAt: string;
        }[];
      };
      setActive({
        id: data.conversation.id,
        title: data.conversation.title,
        thinking: data.conversation.thinking,
        updatedAt: data.conversation.updatedAt,
        createdAt: data.conversation.createdAt,
        messageCount: data.messages.length,
      });
      setThinking(data.conversation.thinking);
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          tools: (m.tools as { name: string; preview?: string }[] | null) ?? undefined,
        })),
      );
    },
    [navigate],
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

  // HITL: clique nos botões do ConfirmationPrompt envia mensagem automática
  // de aprovação/negação na conversa, que o agente lê e prossegue/aborta.
  async function respondToConfirmation(approved: boolean): Promise<void> {
    if (streaming) return;
    const reply = approved
      ? 'Sim, pode prosseguir com a ação proposta.'
      : 'Não, cancele essa ação.';
    void send(reply);
  }

  async function send(overrideText?: string): Promise<void> {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;

    let convId = active?.id;
    if (!convId) {
      const created = await createConversation(text.slice(0, 60));
      if (!created) {
        toast.error('Falha ao iniciar conversa.');
        return;
      }
      setActive(created);
      convId = created.id;
      window.history.replaceState(null, '', `/chat/${convId}`);
    }

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: text };
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
      const res = await fetch(`/api/chat/conversations/${convId}/send`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-User-Timezone': userTz,
        },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? { ...x, pending: false, content: `⚠️ ${err.error ?? 'Erro na requisição.'}` }
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
          } else if (ev === 'tool_start') {
            const name = (payload.name as string) ?? '';
            setMessages((m) =>
              m.map((x) => (x.id === asstId ? { ...x, tools: [...(x.tools ?? []), { name }] } : x)),
            );
          } else if (ev === 'tool_end') {
            const name = (payload.name as string) ?? '';
            const preview = (payload.preview as string) ?? '';
            const actionSummary = (payload.action_summary as string | undefined) ?? undefined;
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId
                  ? {
                      ...x,
                      tools: (x.tools ?? []).map((t, i, arr) =>
                        i === arr.length - 1 && t.name === name
                          ? { ...t, preview, actionSummary }
                          : t,
                      ),
                    }
                  : x,
              ),
            );
          } else if (ev === 'error') {
            const msg = (payload.message as string) ?? 'Erro inesperado.';
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId
                  ? { ...x, pending: false, content: x.content + `\n\n⚠️ ${msg}` }
                  : x,
              ),
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha de conexão.';
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col h-full"
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <motion.div
          key={routeId ?? 'empty'}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl px-6 py-8 space-y-5"
        >
          {empty && <EmptyState onPick={(s) => promptRef.current?.setValue(s)} />}
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
          />
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] mt-2 text-center">
            Enter envia · Shift+Enter quebra linha · Microfone transcreve fala
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Bubble({
  msg,
  user,
  onConfirmAction,
}: {
  msg: Msg;
  user: { name: string; image?: string | null } | null;
  onConfirmAction?: (approved: boolean) => void;
}): React.ReactElement {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = useState(false);

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
            'group rounded-2xl px-4 py-3 leading-relaxed',
            isUser
              ? 'bg-zinc-100 text-zinc-900 text-[14.5px]'
              : 'bg-[var(--color-app-surface)] border border-[var(--color-app-border)] text-zinc-100',
          )}
        >
          {msg.pending && !msg.content ? (
            <span className="inline-flex items-center gap-2 text-[var(--color-app-muted)] text-[14px]">
              <Spinner /> Pensando…
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
                  />
                );
              })()}
              <Markdown>{msg.content}</Markdown>
              {msg.content.length > 0 && (
                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-[var(--color-app-border)] opacity-60 hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors px-2 py-0.5 rounded-md hover:bg-[var(--color-app-surface-hover)]"
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
              )}
            </>
          )}
        </div>
      </div>
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
  // Avatar SVG inline da Vox — V estilizado em gradient violet→emerald.
  // Independente de asset externo pra evitar 404 antes do build de imagens.
  return (
    <div className="h-7 w-7 shrink-0 mt-0.5 rounded-lg overflow-hidden border border-[var(--color-app-border-strong)] bg-gradient-to-br from-violet-500/40 to-emerald-500/40 flex items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Vox"
      >
        <defs>
          <linearGradient id="vox-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(72% 0.18 290)" />
            <stop offset="100%" stopColor="oklch(73% 0.16 159)" />
          </linearGradient>
        </defs>
        <path d="M4 5l6 14 4-10 6-4" stroke="url(#vox-grad)" />
      </svg>
    </div>
  );
}

function ConfirmationPrompt({
  action,
  onConfirm,
  onReject,
}: {
  action: string;
  onConfirm: () => void;
  onReject: () => void;
}): React.ReactElement {
  return (
    <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 not-prose">
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 h-7 w-7 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider font-medium text-amber-300/90 mb-1">
            A Vox pede confirmação
          </p>
          <p className="text-[13.5px] text-zinc-100 leading-snug">{action}</p>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-100 text-[12px] font-medium hover:bg-emerald-500/30 transition-colors"
            >
              <Check className="h-3 w-3" />
              Confirmar
            </button>
            <button
              type="button"
              onClick={onReject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-500/15 border border-rose-500/40 text-rose-100 text-[12px] font-medium hover:bg-rose-500/25 transition-colors"
            >
              <X className="h-3 w-3" />
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }): React.ReactElement {
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
      title: 'Explorar biblioteca',
      hint: 'Veja o que está indexado',
      prompt: 'O que tem na minha biblioteca?',
      accent: 'violet',
    },
    {
      icon: Sparkles,
      title: 'Resumo do último',
      hint: 'Síntese rápida',
      prompt: 'Resuma o conteúdo mais recente da minha biblioteca.',
      accent: 'emerald',
    },
    {
      icon: ListVideo,
      title: 'Ideias dos últimos 3',
      hint: 'Conexões e padrões',
      prompt: 'Quais ideias principais dos últimos 3 conteúdos?',
      accent: 'amber',
    },
    {
      icon: Search,
      title: 'Procurar tema',
      hint: 'Busca FTS por palavra-chave',
      prompt: 'Busque "produtividade" na minha biblioteca.',
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
        <div className="mx-auto h-14 w-14 rounded-2xl overflow-hidden border border-[var(--color-app-border-strong)] bg-gradient-to-br from-violet-500/30 to-emerald-500/30 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Vox"
          >
            <defs>
              <linearGradient id="vox-grad-lg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="oklch(72% 0.18 290)" />
                <stop offset="100%" stopColor="oklch(73% 0.16 159)" />
              </linearGradient>
            </defs>
            <path d="M4 5l6 14 4-10 6-4" stroke="url(#vox-grad-lg)" />
          </svg>
        </div>
        <div className="space-y-1.5 max-w-md mx-auto">
          <p className="font-display text-2xl font-semibold tracking-tight">
            Oi, sou a <span className="text-violet-accent">Vox</span>
          </p>
          <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
            Consulto sua base de conhecimento, indexo conteúdo novo e crio notas. Tudo com fonte e
            timestamp — sem alucinação.
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
