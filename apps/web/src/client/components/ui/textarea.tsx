import * as React from 'react';
import { cn } from '../../lib/utils';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[120px] w-full rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 text-sm',
      'placeholder:text-[var(--color-app-muted)] text-[var(--color-app-fg)]',
      'transition-colors duration-150 ease-out',
      'hover:border-[var(--color-app-border-strong)]',
      'focus:outline-none focus:border-emerald-500/60 focus:bg-[var(--color-app-surface)] focus:ring-2 focus:ring-emerald-500/15',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
