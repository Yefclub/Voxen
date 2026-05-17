import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-lg text-sm font-medium tracking-tight',
    'transition-[transform,background-color,border-color,box-shadow,color] duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(72%_0.18_290_/_0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-app-bg)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.97]',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-zinc-100 text-zinc-900 hover:bg-white hover:shadow-[0_4px_18px_-4px_rgba(255,255,255,0.25)]',
        primary: [
          'bg-gradient-to-b from-emerald-400 to-emerald-500 text-emerald-950 font-semibold',
          'shadow-[inset_0_1px_0_oklch(85%_0.18_159_/_0.6),0_1px_2px_rgba(0,0,0,0.4),0_8px_28px_-8px_oklch(73%_0.16_159_/_0.5)]',
          'hover:from-emerald-300 hover:to-emerald-400',
          'hover:shadow-[inset_0_1px_0_oklch(88%_0.18_159_/_0.7),0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-8px_oklch(73%_0.16_159_/_0.7)]',
        ].join(' '),
        violet: [
          'bg-gradient-to-b from-violet-400 to-violet-500 text-violet-950 font-semibold',
          'shadow-[inset_0_1px_0_oklch(85%_0.18_290_/_0.6),0_1px_2px_rgba(0,0,0,0.4),0_8px_28px_-8px_oklch(72%_0.18_290_/_0.5)]',
          'hover:from-violet-300 hover:to-violet-400',
        ].join(' '),
        secondary:
          'bg-[var(--color-app-surface)] text-zinc-100 border border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface-hover)] hover:border-[oklch(48%_0.01_250)]',
        outline:
          'border border-[var(--color-app-border-strong)] bg-transparent text-zinc-100 hover:bg-[var(--color-app-surface)] hover:border-[oklch(50%_0.01_250)]',
        ghost:
          'bg-transparent text-zinc-300 hover:bg-[var(--color-app-surface)] hover:text-zinc-100',
        destructive:
          'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50',
        link: 'text-zinc-100 underline-offset-4 hover:underline px-0 hover:text-emerald-400',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs rounded-md',
        lg: 'h-10 px-5',
        xl: 'h-12 px-7 text-base rounded-xl',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
