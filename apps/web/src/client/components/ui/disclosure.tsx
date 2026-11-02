import type { ReactNode } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown } from './icons';
import { Button } from './button';
import { cn } from '../../lib/utils';

/** Secondary knowledge stays discoverable without interrupting the reading flow. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className,
  open,
  onOpenChange,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.ReactElement {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={cn('min-w-0 border-b border-[var(--color-app-border)]', className)}
    >
      <Collapsible.Trigger
        render={<Button variant="disclosure" />}
        className="group h-auto min-h-12 w-full justify-between gap-3 px-3 py-3 text-left text-sm"
      >
        <span className="min-w-0 whitespace-normal">{title}</span>
        <ChevronDown
          isAnimated={false}
          aria-hidden
          className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="disclosure-panel">
        <div className="px-3 pb-4 pt-1">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
