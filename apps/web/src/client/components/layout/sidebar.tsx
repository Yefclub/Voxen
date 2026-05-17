import { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  DollarSign,
  LayoutDashboard,
  ListVideo,
  MessagesSquare,
  PlayCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Settings as SettingsIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MeUser } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useSidebarCollapsed } from '../../lib/sidebar-state';
import { useConversations } from '../../lib/use-conversations';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Painel', Icon: LayoutDashboard },
  { to: '/chat', label: 'Conversar', Icon: MessagesSquare },
  { to: '/jobs', label: 'Transcrever', Icon: PlayCircle },
  { to: '/transcricoes', label: 'Biblioteca', Icon: ListVideo },
  { to: '/admin/usuarios', label: 'Usuários', Icon: ShieldCheck, adminOnly: true },
  { to: '/admin/custos', label: 'Custos', Icon: DollarSign, adminOnly: true },
  { to: '/setup', label: 'Configuração', Icon: SettingsIcon, adminOnly: true },
];

const SIDEBAR_WIDTH = 248;

export function Sidebar({ user }: { user: MeUser }): React.ReactElement {
  const location = useLocation();
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN');
  const { collapsed, toggle } = useSidebarCollapsed();
  const inChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/');

  return (
    <>
      <AnimatePresence>
        {collapsed && (
          <motion.button
            type="button"
            onClick={toggle}
            initial={{ opacity: 0, scale: 0.6, x: -12 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.6, x: -12 }}
            transition={{ type: 'spring', stiffness: 360, damping: 26, delay: 0.18 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="hidden md:flex fixed top-4 left-4 z-50 h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] hover:border-[var(--color-app-border-strong)] transition-colors"
            aria-label="Abrir menu"
            title="Abrir menu"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={{ x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="hidden md:flex fixed top-4 bottom-4 left-4 z-40 flex-col rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 backdrop-blur-xl overflow-hidden"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <SidebarHeader onCollapse={toggle} />
            {inChat ? (
              <ChatModeBody items={items} />
            ) : (
              <NavBody items={items} pathname={location.pathname} />
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarHeader({ onCollapse }: { onCollapse: () => void }): React.ReactElement {
  return (
    <div className="flex items-center h-16 px-4 border-b border-[var(--color-app-border)] shrink-0">
      <div className="relative shrink-0 h-9 w-9">
        <img
          src="/voxen-256.png"
          alt="Voxen"
          width={36}
          height={36}
          draggable={false}
          className="rounded-lg select-none pointer-events-none"
        />
      </div>
      <div className="ml-3 flex flex-col leading-none min-w-0">
        <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] mt-1 truncate">
          base de conhecimento
        </span>
      </div>
      <button
        type="button"
        onClick={onCollapse}
        className="ml-auto flex items-center justify-center h-7 w-7 rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors"
        aria-label="Recolher"
        title="Recolher"
      >
        <PanelLeftClose className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modo normal — nav items
// ---------------------------------------------------------------------------

function NavBody({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}): React.ReactElement {
  return (
    <nav className="flex-1 p-3 overflow-y-auto">
      <ul className="space-y-0.5">
        {items.map(({ to, label, Icon }) => {
          const isActive = pathname === to || pathname.startsWith(to + '/');
          return (
            <li key={to} className="relative">
              {isActive && (
                <motion.div
                  layoutId="sidebar-pill"
                  className="absolute inset-0 rounded-lg bg-[var(--color-app-surface-hover)] border border-[var(--color-app-border-strong)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <NavLink
                to={to}
                className={cn(
                  'relative z-10 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                  'transition-colors duration-150',
                  isActive ? 'text-zinc-100' : 'text-[var(--color-app-muted)] hover:text-zinc-100',
                )}
              >
                <Icon
                  className={cn(
                    'h-[18px] w-[18px] transition-colors shrink-0',
                    isActive ? 'text-emerald-400' : 'text-[var(--color-app-muted)]',
                  )}
                />
                <span className="truncate">{label}</span>
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-dot"
                    className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Modo chat — conversas + nova + menu colapsável
// ---------------------------------------------------------------------------

function ChatModeBody({ items }: { items: NavItem[] }): React.ReactElement {
  const navigate = useNavigate();
  const { conversations, loading, create, remove } = useConversations();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const activeId = useMemo(() => {
    const m = location.pathname.match(/^\/chat\/([^/]+)/);
    return m?.[1] ?? null;
  }, [location.pathname]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(needle));
  }, [conversations, q]);

  async function onNew(): Promise<void> {
    const conv = await create();
    if (!conv) {
      toast.error('Falha ao criar conversa.');
      return;
    }
    navigate(`/chat/${conv.id}`);
  }

  async function onDelete(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (!confirm('Apagar esta conversa? Não dá pra desfazer.')) return;
    const ok = await remove(id);
    if (!ok) {
      toast.error('Falha ao apagar.');
      return;
    }
    if (activeId === id) navigate('/chat', { replace: true });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 flex flex-col gap-3 shrink-0">
        <button
          type="button"
          onClick={() => void onNew()}
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

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && conversations.length === 0 && (
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
                onClick={() => navigate(`/chat/${c.id}`)}
                className="w-full text-left px-3 py-2.5 pr-9 min-w-0"
              >
                <p className="text-[13px] font-medium text-zinc-100 truncate">{c.title}</p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] mt-0.5">
                  {c.messageCount} {c.messageCount === 1 ? 'mensagem' : 'mensagens'}
                </p>
              </button>
              <button
                type="button"
                onClick={(e) => void onDelete(c.id, e)}
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

      {/* Menu colapsável no rodapé */}
      <div className="border-t border-[var(--color-app-border)] shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors"
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', menuOpen ? 'rotate-180' : '')}
          />
          Menu
        </button>
        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden px-3 pb-3 space-y-0.5"
            >
              {items
                .filter((n) => n.to !== '/chat')
                .map(({ to, label, Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </NavLink>
                  </li>
                ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function SidebarSpacer(): React.ReactElement {
  const { collapsed } = useSidebarCollapsed();
  return (
    <motion.div
      className="hidden md:block shrink-0"
      animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH + 32 }}
      initial={false}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      aria-hidden
    />
  );
}
