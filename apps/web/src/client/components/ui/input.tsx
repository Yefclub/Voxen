import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-10 w-full rounded-md border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 py-2 text-sm',
      'placeholder:text-[var(--color-app-muted)] text-[var(--color-app-fg)]',
      'transition-colors duration-150 ease-out',
      'hover:border-[var(--color-app-border-strong)]',
      'focus:outline-none focus:border-[var(--theme-focus)] focus:ring-2 focus:ring-[var(--color-accent-primary-soft)]',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--color-app-subtle)]',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
