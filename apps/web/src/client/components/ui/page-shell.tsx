import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  PAGE_SHELL_WIDTHS,
  resetAnimationStyles,
  safelyRunAnimation,
  shouldAnimateDecoration,
} from '../../lib/interface-foundation';
import type { AnimatedIcon } from './icons';

gsap.registerPlugin(useGSAP);

interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  width?: keyof typeof PAGE_SHELL_WIDTHS;
  animate?: boolean;
}

/**
 * Área de conteúdo responsiva. Elementos com `data-page-reveal` entram em uma
 * timeline única, evitando animações concorrentes e saltos de layout.
 */
export function PageShell({
  width = 'workspace',
  animate = false,
  className,
  children,
  ...props
}: PageShellProps): React.ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useGSAP(
    () => {
      if (!shouldAnimateDecoration(reduceMotion, animate)) return;
      const directChildren = root.current
        ? Array.from(root.current.children as HTMLCollectionOf<HTMLElement>)
        : [];
      const contentRoot =
        directChildren.length === 1 && directChildren[0]?.hasAttribute('data-page-content')
          ? directChildren[0]
          : null;
      const targets = contentRoot
        ? Array.from(contentRoot.children as HTMLCollectionOf<HTMLElement>)
        : directChildren;
      if (!targets?.length) return;

      safelyRunAnimation(
        () => {
          gsap.fromTo(
            targets,
            { y: 6 },
            {
              y: 0,
              duration: 0.22,
              stagger: 0,
              ease: 'power3.out',
              clearProps: 'opacity,transform,visibility',
            },
          );
        },
        () => resetAnimationStyles(targets),
      );
    },
    { scope: root, dependencies: [animate, reduceMotion], revertOnUpdate: true },
  );

  return (
    <div
      ref={root}
      className={cn(
        'mx-auto min-h-full w-full space-y-7 px-5 py-6 sm:space-y-8 sm:px-8 sm:py-8 xl:px-10',
        PAGE_SHELL_WIDTHS[width],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode;
  icon?: AnimatedIcon;
  iconClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow: _eyebrow,
  icon: _icon,
  iconClassName: _iconClassName,
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
  return (
    <header
      data-page-reveal
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}
      {...props}
    >
      <div className="min-w-0 space-y-2.5">
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-[-0.025em] text-[var(--color-app-fg)] sm:text-[34px]">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--color-app-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
