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
        'mx-auto min-h-full w-full space-y-6 px-4 py-5 sm:space-y-8 sm:px-7 sm:py-9 xl:px-10',
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
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
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
