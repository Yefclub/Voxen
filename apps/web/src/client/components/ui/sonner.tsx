import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { TOAST_DURATION_MS } from '../../lib/toast';

export function Toaster(props: ToasterProps): React.ReactElement {
  return (
    <Sonner
      {...props}
      theme="dark"
      position="bottom-right"
      richColors={false}
      closeButton={false}
      duration={TOAST_DURATION_MS}
      visibleToasts={1}
      toastOptions={{
        classNames: {
          toast:
            '!bg-[var(--color-app-bg-elevated)] !border !border-[var(--color-app-border-strong)] !text-[var(--color-app-fg)] !rounded-xl !backdrop-blur-md',
          title: '!font-medium !text-[var(--color-app-fg)] !tracking-tight',
          description: '!text-[var(--color-app-muted)] !text-xs',
          actionButton:
            '!bg-emerald-500 !text-emerald-950 !rounded-md !font-medium hover:!bg-emerald-400 !transition-colors',
          cancelButton:
            '!bg-[var(--color-app-surface)] !text-[var(--color-app-subtle)] !rounded-md hover:!bg-[var(--color-app-surface-hover)] !transition-colors',
          success: '!border-emerald-500/30',
          error: '!border-rose-500/30',
          warning: '!border-amber-500/30',
        },
      }}
    />
  );
}
