import * as React from 'react';
import { cn } from '../../lib/utils';

export function Separator({
  className,
  orientation = 'horizontal',
}: {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}): React.ReactElement {
  return (
    <div
      role="separator"
      className={cn(
        'shrink-0 bg-[var(--color-app-surface-hover)]',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className,
      )}
    />
  );
}
