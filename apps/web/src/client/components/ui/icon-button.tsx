import { forwardRef } from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

interface IconButtonProps extends Omit<ButtonProps, 'asChild'> {
  label: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

/** Labeled shell action. Tooltips follow hover, never restored keyboard focus. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltipSide = 'bottom', variant = 'ghost', size = 'icon', ...props },
  ref,
) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild onFocus={(event) => event.preventDefault()}>
        <Button
          ref={ref}
          type="button"
          variant={variant}
          size={size}
          {...props}
          aria-label={label}
        />
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
});
