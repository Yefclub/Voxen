import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check,
  Copy,
  MessagesSquare,
  Plus,
  Search,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '../components/ui/spinner';
import { AnimatedPage } from '../components/motion/animated-page';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Markdown } from '../components/ui/markdown';
import { PromptBox, type PromptBoxHandle } from '../components/ui/prompt-box';
import { useMe } from '../lib/hooks';
import { cn } from '../lib/utils';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: { name: string; preview?: string }[];
  pending?: boolean;
}

interface ConvSummary {
  id: string;
  title: string;
  thinking: boolean;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

const THINKING_KEY = 'voxen:chat:thinking';

export function ChatPage(): React.ReactElement {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: me } = useMe();

  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [active, setActive] = useState<ConvSummary | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [thinking, setThinking] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(THINKING_KEY) === '1';
    } catch {
      return false;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<PromptBoxHandle>(null);

  const loadList = useCallback(async (): Promise<ConvSummary[]> => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/chat/conversations', { credentials: 'include' });
      const data = (await res.json()) as { conversations: ConvSummary[] };
      setConversations(data.conversations);
      return data.conversations;
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!routeId) {
      setActive(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/chat/conversations/${routeId}`, { credentials: 'include' });
      if (!res.ok) {
        toast.error('Conversa não encontrada.');
        navigate('/chat', { replace: true });
        return;
      }
      const data = (await res.json()) as {
        conversation: { id: string; title: string; thinking: boolean; updatedAt: string; createdAt: string };
        messages: { id: string; role: 'user' | 'assistant'; content: string; tools?: unknown; createdAt: string }[];
      };
      if (cancelled) return;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId, navigate]);

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

  async function newConversation(): Promise<void> {
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      toast.error('Falha ao criar conversa.');
      return;
    }
    const data = (await res.json()) as { conversation: ConvSummary };
    setConversations((prev) => [data.conversation, ...prev]);
    navigate(`/chat/${data.conversation.id}`);
  }

  async function deleteConversation(id: string): Promise<void> {
    if (!confirm('Apagar esta conversa? Não dá pra desfazer.')) return;
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      toast.error('Falha ao apagar conversa.');
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (routeId === id) navigate('/chat', { replace: true });
  }

  async function toggleThinking(): Promise<void> {
    const next = !thinking;
    setThinking(next);
    if (active) {
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
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text.slice(0, 60) }),
      });
      if (!res.ok) {
        toast.error('Falha ao iniciar conversa.');
        return;
      }
      const data = (await res.json()) as { conversation: ConvSummary };
      setConversations((prev) => [data.conversation, ...prev]);
      setActive(data.conversation);
      convId = data.conversation.id;
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
      void loadList();
    }
  }

  const empty = messages.length === 0 && !active;

  return (
    <AnimatedPage>
      <div className="flex h-[calc(100vh-4rem)]">
        <ConversationsSidebar
          conversations={conversations}
          loading={loadingList}
          activeId={routeId ?? null}
          onNew={() => void newConversation()}
          onPick={(id) => navigate(`/chat/${id}`)}
          onDelete={(id) => void deleteConversation(id)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-6 py-8 space-y-5">
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
            </div>
          </div>

          <div className="border-t border-[var(--color-app-border)] bg-[var(--color-app-bg)]/60 backdrop-blur-md">
            <div className="mx-auto max-w-3xl px-6 py-4">
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
          </div>
        </div>
      </div>
    </AnimatedPage>
  );
}

function ConversationsSidebar({
  conversations,
  loading,
  activeId,
  onNew,
  onPick,
  onDelete,
}: {
  conversations: ConvSummary[];
  loading: boolean;
  activeId: string | null;
  onNew: () => void;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(needle));
  }, [conversations, q]);

  return (
    <aside className="hidden lg:flex w-72 flex-col border-r border-[var(--color-app-border)] bg-[var(--color-app-bg)]/40 backdrop-blur-sm">
      <div className="p-3 flex flex-col gap-3">
        <button
          type="button"
          onClick={onNew}
          className="flex items-center justify-center gap-2 h-10 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] text-sm font-medium text-zinc-100 hover:border-violet-500/40 hover:bg-violet-500/5 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nova conversa
        </button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-app-muted)] pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversas…"
            className="w-full h-9 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/60 pl-8 pr-3 text-[13px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {loading && (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-app-muted)]">
            Carregando…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-app-muted)]">
            {q ? 'Nada encontrado.' : 'Nenhuma conversa ainda.'}
          </div>
        )}
        {filtered.map((c) => {
          const isActive = c.id === activeId;
          return (
            <div
              key={c.id}
              className={cn(
                'group relative rounded-lg transition-colors',
                isActive
                  ? 'bg-[var(--color-app-surface-hover)] border border-[var(--color-app-border-strong)]'
                  : 'border border-transparent hover:bg-[var(--color-app-surface)]',
              )}
            >
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className="w-full text-left px-3 py-2.5 pr-9 min-w-0"
              >
                <p className="text-[13px] font-medium text-zinc-100 truncate">{c.title}</p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] mt-0.5">
                  {c.messageCount} {c.messageCount === 1 ? 'mensagem' : 'mensagens'}
                </p>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-[var(--color-app-muted)] opacity-0 group-hover:opacity-100 hover:text-rose-300 hover:bg-rose-500/10 transition-all flex items-center justify-center"
                aria-label="Apagar conversa"
                title="Apagar conversa"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
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

function UserAvatar({ user }: { user: { name: string; image?: string | null } | null }): React.ReactElement {
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
        <AvatarPrimitive.Image src={user.image} alt={user.name} className="h-full w-full object-cover" />
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
      <img src="/voxen-256.png" alt="Voxen" className="h-full w-full object-cover" draggable={false} />
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
          O agente consulta sua biblioteca usando tools determinísticas. Sem alucinação, tudo com
          fonte e timestamp.
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
