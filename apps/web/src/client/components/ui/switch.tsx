import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
      'border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)]',
      'transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-400',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-zinc-100',
        'shadow-none ring-0',
        'transition-transform duration-200 ease-out',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
