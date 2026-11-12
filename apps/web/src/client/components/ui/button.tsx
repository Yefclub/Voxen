import * as React from 'react';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
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
    'active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-app-inverted)] text-[var(--color-app-inverted-fg)] hover:bg-[var(--color-app-inverted-hover)]',
        primary:
          'bg-[var(--color-accent-primary)] text-[var(--color-app-bg)] font-semibold hover:brightness-110',
        violet:
          'bg-[var(--color-accent-primary)] text-[var(--color-app-bg)] font-semibold hover:brightness-110',
        secondary:
          'bg-[var(--color-app-surface)] text-[var(--color-app-fg)] border border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface-hover)]',
        outline:
          'border border-[var(--color-app-border-strong)] bg-transparent text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)]',
        ghost:
          'bg-transparent text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
        disclosure:
          'rounded-none bg-transparent text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] active:scale-100 focus-visible:ring-inset focus-visible:ring-offset-0',
        destructive:
          'bg-rose-500/10 text-[var(--color-app-danger)] border border-rose-500/30 hover:bg-rose-500/20',
        link: 'text-[var(--color-app-fg)] underline-offset-4 hover:underline px-0 hover:text-emerald-400',
      },
      size: {
        default: 'min-h-10 px-4 py-2 [@media(pointer:coarse)]:min-h-11',
        sm: 'min-h-9 px-3 py-1.5 text-sm rounded-lg [@media(pointer:coarse)]:min-h-11',
        lg: 'h-10 px-5',
        xl: 'h-12 px-7 text-base rounded-xl',
        icon: 'h-10 w-10 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
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

function buttonText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child))
        return buttonText(child.props.children);
      return '';
    })
    .join(' ')
    .trim();
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));
    if (asChild)
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      );
    const label = props['aria-label'] ?? props.title ?? buttonText(children);
    const astryxVariant =
      variant === 'destructive'
        ? 'destructive'
        : variant === 'primary' || variant === 'violet' || !variant || variant === 'default'
          ? 'primary'
          : variant === 'ghost' || variant === 'link' || variant === 'disclosure'
            ? 'ghost'
            : 'secondary';
    return (
      <AstryxButton
        {...props}
        ref={ref}
        label={label}
        variant={astryxVariant}
        size={size === 'sm' ? 'sm' : 'md'}
        isDisabled={props.disabled}
        className={classes}
      >
        <span className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-normal">
          {children}
        </span>
      </AstryxButton>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
