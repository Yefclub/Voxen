import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Copy, MessagesSquare, Wand2 } from 'lucide-react';
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
  tools?: { name: string; preview?: string }[];
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

  const loadActive = useCallback(async (id: string): Promise<void> => {
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
  }, [navigate]);

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

  async function send(): Promise<void> {
    const text = input.trim();
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
      const res = await fetch(`/api/chat/conversations/${convId}/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
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
              m.map((x) =>
                x.id === asstId ? { ...x, tools: [...(x.tools ?? []), { name }] } : x,
              ),
            );
          } else if (ev === 'tool_end') {
            const name = (payload.name as string) ?? '';
            const preview = (payload.preview as string) ?? '';
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
          x.id === asstId
            ? { ...x, pending: false, content: x.content + `\n\n⚠️ ${msg}` }
            : x,
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
                <Bubble msg={m} user={me ?? null} />
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
}: {
  msg: Msg;
  user: { name: string; image?: string | null } | null;
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
      {isUser ? <UserAvatar user={user} /> : <VoxenAvatar />}

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

function VoxenAvatar(): React.ReactElement {
  return (
    <div className="h-7 w-7 shrink-0 mt-0.5 rounded-lg overflow-hidden border border-[var(--color-app-border-strong)] bg-gradient-to-br from-violet-500/40 to-emerald-500/40">
      <img
        src="/voxen-256.png"
        alt="Voxen"
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }): React.ReactElement {
  const suggestions = [
    'O que tem na minha biblioteca?',
    'Resuma o vídeo mais recente.',
    'Quais ideias principais dos últimos 3 vídeos?',
    'Procure por "produtividade" na biblioteca.',
  ];
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
      <div className="h-14 w-14 rounded-2xl overflow-hidden border border-[var(--color-app-border-strong)] bg-gradient-to-br from-violet-500/20 to-emerald-500/20 flex items-center justify-center">
        <img src="/voxen-256.png" alt="Voxen" className="h-full w-full object-cover" />
      </div>
      <div className="space-y-1.5 max-w-md">
        <p className="font-display text-2xl font-semibold tracking-tight">Pergunte qualquer coisa</p>
        <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
          O agente consulta sua biblioteca e pode transcrever vídeos novos. Sem alucinação, tudo
          com fonte e timestamp.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-left text-xs px-3.5 py-3 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/40 text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface)] hover:border-[var(--color-app-border-strong)] hover:text-zinc-100 transition-colors"
          >
            <MessagesSquare className="inline h-3 w-3 mr-1.5 text-violet-400" />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
