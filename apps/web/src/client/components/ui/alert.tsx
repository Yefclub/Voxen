import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva(
  'relative w-full rounded-md border px-4 py-3 text-sm leading-relaxed flex items-start gap-3',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-app-surface)] border-[var(--color-app-border)] text-[var(--color-app-subtle)]',
        info: 'bg-[var(--color-app-surface)] border-[var(--color-app-border-strong)] text-[var(--color-app-subtle)]',
        success: 'bg-emerald-500/5 border-emerald-500/30 text-emerald-200',
        warning: 'bg-amber-500/5 border-amber-500/30 text-amber-200',
        destructive: 'bg-red-500/5 border-red-500/30 text-red-200',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant, className }))} {...props} />
  ),
);
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('font-medium tracking-tight', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  // break-words: mensagens de erro vindas de API/servidor são conteúdo não
  // controlado — um token/URL longo sem espaço não pode estourar o alerta.
  <div ref={ref} className={cn('text-sm opacity-90 break-words', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';
