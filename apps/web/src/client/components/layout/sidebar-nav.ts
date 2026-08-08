import {
  Download,
  House,
  KeyRound,
  Link2,
  ListOrdered,
  ListVideo,
  MessageCircle,
  Network,
  Notebook,
  Puzzle,
  ShieldCheck,
  User as UserIcon,
  Workflow,
} from '@/components/ui/icons';
import type { I18nKey } from '../../lib/i18n';

export interface NavItem {
  to: string;
  labelKey: I18nKey;
  Icon: typeof House;
  adminOnly?: boolean;
  scope: 'workspace' | 'personal' | 'admin';
}

export const NAV: NavItem[] = [
  { to: '/', labelKey: 'shell.nav.home', Icon: House, scope: 'workspace' },
  { to: '/chat', labelKey: 'shell.nav.chat', Icon: MessageCircle, scope: 'workspace' },
  { to: '/transcricoes', labelKey: 'shell.nav.library', Icon: ListVideo, scope: 'workspace' },
  { to: '/downloads', labelKey: 'shell.nav.downloads', Icon: Download, scope: 'workspace' },
  { to: '/fila', labelKey: 'shell.nav.queue', Icon: ListOrdered, scope: 'workspace' },
  { to: '/notas', labelKey: 'shell.nav.notes', Icon: Notebook, scope: 'workspace' },
  { to: '/automacoes', labelKey: 'shell.nav.automations', Icon: Workflow, scope: 'workspace' },
  { to: '/grafo', labelKey: 'shell.nav.graph', Icon: Network, scope: 'workspace' },
  { to: '/extensao', labelKey: 'shell.nav.extension', Icon: Puzzle, scope: 'workspace' },
  { to: '/conta', labelKey: 'shell.nav.account', Icon: UserIcon, scope: 'personal' },
  {
    to: '/conta/plataformas',
    labelKey: 'shell.nav.platformAccounts',
    Icon: Link2,
    scope: 'personal',
  },
  { to: '/conta/mcp', labelKey: 'shell.nav.mcpAccess', Icon: KeyRound, scope: 'personal' },
  {
    to: '/admin',
    labelKey: 'shell.nav.administration',
    Icon: ShieldCheck,
    adminOnly: true,
    scope: 'admin',
  },
];

export const NAV_SCOPES = ['workspace', 'personal', 'admin'] as const;
export const NAV_SCOPE_LABELS: Record<(typeof NAV_SCOPES)[number], I18nKey> = {
  workspace: 'shell.navGroup.workspace',
  personal: 'shell.navGroup.personal',
  admin: 'shell.navGroup.admin',
};

export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/' || to === '/conta') return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}
