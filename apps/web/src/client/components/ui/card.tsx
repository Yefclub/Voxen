import * as React from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** elevated = leve gradient interno (top → bottom) */
  elevated?: boolean;
  /** hoverable = leve translate no hover + border destacada */
  hoverable?: boolean;
  /** glow mantido por compat, ignorado (sem sombras coloridas) */
  glow?: 'emerald' | 'violet' | null;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated, hoverable, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl text-[var(--color-app-fg)] transition-colors duration-200 ease-out',
        elevated
          ? 'border border-[var(--color-app-border)] bg-gradient-to-b from-[var(--color-app-elevate)] to-[var(--color-app-surface)]'
          : 'border border-[var(--color-app-border)] bg-[var(--color-app-surface)]',
        hoverable && 'hover:border-[var(--color-app-border-strong)]',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-[var(--color-app-muted)] leading-relaxed', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
