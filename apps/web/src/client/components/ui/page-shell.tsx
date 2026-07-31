import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
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
import { ICON_CUE_DURATION, ICON_CUE_PAGE_DELAY_MS, useIconCueGroup } from '../../lib/icon-cue';
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
  animate = true,
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
            { autoAlpha: 0, y: 10 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.38,
              stagger: 0.055,
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
        'mx-auto min-h-full w-full space-y-6 px-4 pb-5 pt-0 sm:space-y-8 sm:px-7 sm:pb-9 sm:pt-0 xl:px-10',
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
  eyebrow: ReactNode;
  icon: AnimatedIcon;
  iconClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  icon: EyebrowIcon,
  iconClassName,
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const { registerIcon, playCue } = useIconCueGroup(!reduceMotion);

  // Ao abrir a página, o ícone que nomeia a página se desenha uma vez, logo
  // depois do cabeçalho terminar de subir na timeline do PageShell. É a única
  // deixa de ícone da página — animar todos a cada navegação vira ruído.
  useEffect(() => {
    playCue(ICON_CUE_PAGE_DELAY_MS);
  }, [playCue]);

  return (
    <header
      data-page-reveal
      className={cn(
        'flex flex-col gap-5 border-b border-[var(--color-app-border)] pb-6 lg:flex-row lg:items-end lg:justify-between',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-2.5">
        {eyebrow && (
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
            <EyebrowIcon
              ref={registerIcon('eyebrow')}
              isAnimated
              duration={ICON_CUE_DURATION}
              aria-hidden
              className={cn('h-3.5 w-3.5 text-[var(--color-accent-primary)]', iconClassName)}
            />
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-3xl font-semibold tracking-[-0.035em] text-[var(--color-app-fg)] sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--color-app-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
