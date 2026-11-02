import { forwardRef } from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type ToggleGroupProps = Omit<ToggleGroupPrimitive.Props, 'className'> & { className?: string };

export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(function ToggleGroup(
  { className, ...props },
  ref,
) {
  return (
    <ToggleGroupPrimitive
      ref={ref}
      data-slot="toggle-group"
      className={cn('flex items-center rounded-lg bg-[var(--color-app-bg)] p-1', className)}
      {...props}
    />
  );
});

type ToggleGroupItemProps = Omit<TogglePrimitive.Props, 'className' | 'render'> & {
  label: string;
  className?: string;
};

export const ToggleGroupItem = forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  function ToggleGroupItem({ label, className, ...props }, ref) {
    return (
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild onFocus={(event) => event.preventDefault()}>
          <TogglePrimitive
            ref={ref}
            data-slot="toggle-group-item"
            render={<Button variant="ghost" size="icon" />}
            className={cn(
              'h-8 w-8 rounded-md text-[var(--color-app-muted)] data-[pressed]:bg-[var(--color-app-surface-hover)] data-[pressed]:text-[var(--color-app-fg)]',
              className,
            )}
            {...props}
            aria-label={label}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    );
  },
);
