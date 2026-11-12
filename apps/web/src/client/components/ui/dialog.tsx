import * as React from 'react';
import { useOverlayBack } from '../../lib/use-overlay-back';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@/components/ui/icons';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';

export function Dialog({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>): React.ReactElement {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const visible = open ?? internalOpen;
  const setOpen = (next: boolean): void => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  useOverlayBack(visible, () => setOpen(false));
  return <DialogPrimitive.Root {...props} open={visible} onOpenChange={setOpen} />;
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-[var(--color-app-scrim)] data-[state=open]:anim-in',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { t } = useI18n();
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'voxen-dialog fixed inset-x-0 bottom-0 z-50 flex flex-col w-full max-h-[min(90dvh,var(--visual-viewport-height,90dvh))] gap-5 overflow-y-auto overflow-x-hidden overscroll-contain md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100vw-3rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2',
          'rounded-t-2xl bg-[var(--color-app-bg-elevated)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 shadow-[var(--app-shadow-overlay)] md:rounded-xl md:p-7 data-[state=open]:anim-in',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Close className="sticky top-0 z-10 -mb-16 [.gap-0>&]:-mb-11 ml-auto flex h-11 w-11 shrink-0 bg-[var(--color-app-bg-elevated)] items-center justify-center rounded-lg text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface-hover)] transition-colors">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = 'DialogContent';

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />;
}
DialogHeader.displayName = 'DialogHeader';

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('flex flex-col-reverse gap-3 md:flex-row md:justify-end', className)}
      {...props}
    />
  );
}
DialogFooter.displayName = 'DialogFooter';

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('pr-10 text-lg font-semibold tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-[var(--color-app-muted)] leading-relaxed', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';
