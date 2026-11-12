import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown } from '@/components/ui/icons';
import { useIsDesktop } from '../../lib/use-media-query';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogClose } from '../ui/dialog';
import { BrainCircuit, KeyRound, User as UserIcon } from '@/components/ui/icons';
import { NavLink } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

const accountSections = [
  { to: '/conta', label: 'account.title', icon: UserIcon, end: true },
  { to: '/conta/mcp', label: 'account.mcp.title', icon: KeyRound, end: false },
  { to: '/conta/ia', label: 'account.ai.title', icon: BrainCircuit, end: false },
] as const;

export function AccountPageNav(): React.ReactElement {
  const { t } = useI18n();

  const desktop = useIsDesktop();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const current =
    [...accountSections]
      .reverse()
      .find((item) =>
        item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
      ) ?? accountSections[0];
  const links = accountSections.map(({ to, label, icon: Icon, end }) => {
    const link = (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) =>
          cn(
            'inline-flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
            isActive
              ? 'bg-[var(--color-accent-primary-soft)] text-[var(--color-accent-primary)]'
              : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {t(label)}
      </NavLink>
    );
    return desktop ? (
      link
    ) : (
      <DialogClose key={to} asChild>
        {link}
      </DialogClose>
    );
  });
  if (!desktop)
    return (
      <nav aria-label={t('account.eyebrow')}>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" className="w-full justify-between">
              <span>{t(current.label)}</span>
              <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>{t('account.eyebrow')}</DialogTitle>
            <div className="flex flex-col gap-1">{links}</div>
          </DialogContent>
        </Dialog>
      </nav>
    );
  return (
    <nav
      aria-label={t('account.eyebrow')}
      className="flex flex-wrap gap-2 border-b border-[var(--color-app-border)] pb-3"
    >
      {links}
    </nav>
  );
}
