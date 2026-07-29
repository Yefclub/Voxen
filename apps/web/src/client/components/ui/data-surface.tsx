import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Superfície densa para coleções, listas e tabelas responsivas. Mantém borda,
 * fundo e clipping consistentes sem impor a semântica interna do conteúdo.
 */
export const DataSurface = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]',
        className,
      )}
      {...props}
    />
  ),
);
DataSurface.displayName = 'DataSurface';
