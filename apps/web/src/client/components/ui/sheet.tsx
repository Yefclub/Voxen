import * as React from 'react';
import { useOverlayBack } from '../../lib/use-overlay-back';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

export function Sheet({
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
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { t } = useI18n();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--color-app-scrim)] data-[state=open]:anim-in" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[min(90dvh,var(--visual-viewport-height,90dvh))] w-full flex-col overflow-y-auto overscroll-contain rounded-t-2xl bg-[var(--color-app-bg-elevated)] pb-[env(safe-area-inset-bottom)] shadow-[var(--app-shadow-overlay)] data-[state=open]:anim-in sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[32rem] sm:rounded-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = 'SheetContent';

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
