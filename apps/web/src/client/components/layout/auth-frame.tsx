import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Download, Network, House, Sun, Moon } from '@/components/ui/icons';
import { useTheme } from '../../lib/theme-provider';
import { useI18n } from '../../lib/i18n';
import { Logo } from '../ui/logo';

/** Shared public entrance. The story describes capabilities, never private documents. */
export function AuthFrame({
  children,
  story = true,
}: {
  children: ReactNode;
  story?: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const { theme, toggleAppearance } = useTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-app-bg)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-10 lg:px-14">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
        <Logo size={36} />
        <button
          type="button"
          aria-label={t(theme === 'light' ? 'theme.switchToDark' : 'theme.switchToLight')}
          onClick={() => void toggleAppearance()}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface)]"
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>
      </header>
      <main
        className={cn(
          'mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 py-10 lg:py-16',
          story && 'lg:grid-cols-[1.15fr_1fr] lg:gap-20',
        )}
      >
        <div
          className={cn(
            'order-1 mx-auto w-full space-y-7',
            story
              ? 'max-w-[26rem] lg:order-2 lg:max-w-none lg:border-l lg:border-[var(--color-app-border)] lg:pl-12'
              : 'max-w-2xl',
          )}
        >
          {children}
        </div>
        {story && (
          <aside className="order-2 hidden space-y-12 lg:order-1 lg:block">
            <div className="max-w-xl space-y-6">
              <h2 className="font-display text-[clamp(2.5rem,4.4vw,4.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-balance">
                {t('design.storyTitle')}
              </h2>
              <p className="max-w-md text-lg leading-relaxed text-[var(--color-app-muted)]">
                {t('design.storyDescription')}
              </p>
            </div>
            <ul className="max-w-md divide-y divide-[var(--color-app-border)]">
              {(
                [
                  [Download, 'design.capture', 'design.captureDescription'],
                  [Network, 'design.find', 'design.findDescription'],
                  [House, 'design.own', 'design.ownDescription'],
                ] as const
              ).map(([Icon, title, description]) => (
                <li key={title} className="flex gap-4 py-5">
                  <Icon
                    className="mt-1 h-5 w-5 shrink-0 text-[var(--color-accent-primary)]"
                    aria-hidden
                  />
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold">{t(title)}</h3>
                    <p className="text-sm leading-relaxed text-[var(--color-app-muted)]">
                      {t(description)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>
      <footer className="mx-auto w-full max-w-7xl text-xs text-[var(--color-app-muted)]">
        {t('design.footer')}
      </footer>
    </div>
  );
}

export function AuthFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-[var(--color-app-fg)]">
      {children}
    </label>
  );
}

export function AuthInputFrame({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] transition-colors focus-within:border-[var(--color-accent-primary)] focus-within:ring-2 focus-within:ring-[var(--color-accent-primary-soft)]">
      {children}
    </div>
  );
}
