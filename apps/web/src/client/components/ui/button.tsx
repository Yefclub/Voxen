import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-lg text-sm font-medium tracking-tight',
    'transition-[transform,background-color,border-color,color] duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-app-bg)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.97]',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-app-inverted)] text-[var(--color-app-inverted-fg)] hover:bg-[var(--color-app-inverted-hover)]',
        primary: 'bg-emerald-500 text-emerald-950 font-semibold hover:bg-emerald-400',
        violet: 'bg-violet-500 text-violet-950 font-semibold hover:bg-violet-400',
        secondary:
          'bg-[var(--color-app-surface)] text-[var(--color-app-fg)] border border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface-hover)]',
        outline:
          'border border-[var(--color-app-border-strong)] bg-transparent text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)]',
        ghost:
          'bg-transparent text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
        destructive: 'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20',
        link: 'text-[var(--color-app-fg)] underline-offset-4 hover:underline px-0 hover:text-emerald-400',
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
