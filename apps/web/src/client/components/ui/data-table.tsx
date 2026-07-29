import * as React from 'react';
import { cn } from '../../lib/utils';

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

export const DataTable = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="w-full overflow-x-auto">
    <table
      ref={ref}
      className={cn('w-full min-w-[640px] border-collapse text-sm', className)}
      {...props}
    />
  </div>
));
DataTable.displayName = 'DataTable';

export const DataTableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'bg-[var(--color-app-bg-elevated)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--color-app-muted)]',
      className,
    )}
    {...props}
  />
));
DataTableHeader.displayName = 'DataTableHeader';

export const DataTableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('divide-y divide-[var(--color-app-border)]', className)}
    {...props}
  />
));
DataTableBody.displayName = 'DataTableBody';

export const DataTableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn('transition-colors hover:bg-[var(--color-app-surface-hover)]/70', className)}
    {...props}
  />
));
DataTableRow.displayName = 'DataTableRow';

export const DataTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th ref={ref} className={cn('whitespace-nowrap px-4 py-3 font-medium', className)} {...props} />
));
DataTableHead.displayName = 'DataTableHead';

export const DataTableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-4 py-3 text-[var(--color-app-subtle)]', className)} {...props} />
));
DataTableCell.displayName = 'DataTableCell';
