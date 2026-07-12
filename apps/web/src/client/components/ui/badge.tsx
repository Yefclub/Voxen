import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-app-surface)] text-[var(--color-app-subtle)] border border-[var(--color-app-border)]',
        outline:
          'border border-[var(--color-app-border-strong)] text-[var(--color-app-subtle)] bg-transparent',
        success: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
        warning: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
        danger: 'bg-red-500/10 text-red-300 border border-red-500/30',
        muted:
          'bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)] border border-[var(--color-app-border)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
