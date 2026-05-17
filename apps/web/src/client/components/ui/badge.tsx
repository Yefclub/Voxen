import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-zinc-800 text-zinc-200 border border-zinc-700/60',
        outline: 'border border-zinc-700 text-zinc-300 bg-transparent',
        success: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
        warning: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
        danger: 'bg-red-500/10 text-red-300 border border-red-500/30',
        muted: 'bg-zinc-900 text-zinc-400 border border-zinc-800',
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
