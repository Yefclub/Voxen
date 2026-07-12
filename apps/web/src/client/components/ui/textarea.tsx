import * as React from 'react';
import { cn } from '../../lib/utils';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[120px] w-full rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm',
      'placeholder:text-zinc-500 text-zinc-100',
      'transition-colors duration-150 ease-out',
      'hover:border-zinc-700',
      'focus:outline-none focus:border-emerald-500/60 focus:bg-zinc-900/60 focus:ring-2 focus:ring-emerald-500/15',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
