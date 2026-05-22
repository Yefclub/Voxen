import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

/**
 * Modal de confirmação reutilizável — substitui `window.confirm()` por algo
 * que segue o design system. Usa Radix Dialog, suporta async onConfirm,
 * mostra spinner enquanto resolve e fecha automaticamente no sucesso.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  loading: externalLoading,
}: ConfirmDialogProps): React.ReactElement {
  const { t } = useI18n();
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = externalLoading ?? internalLoading;
  const finalConfirmLabel = confirmLabel ?? t('common.confirm');
  const finalCancelLabel = cancelLabel ?? t('common.cancel');

  useEffect(() => {
    if (!open) setInternalLoading(false);
  }, [open]);

  async function handleConfirm(): Promise<void> {
    setInternalLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setInternalLoading(false);
    }
  }

  const isDestructive = variant === 'destructive';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            {isDestructive && (
              <div className="shrink-0 h-9 w-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mt-0.5">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-1.5">{description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {finalCancelLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? 'destructive' : 'primary'}
            size="default"
            onClick={() => void handleConfirm()}
            disabled={loading}
            className={cn(
              isDestructive && 'bg-rose-500 text-rose-950 border-rose-400 hover:bg-rose-400',
              loading && 'opacity-80',
            )}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {finalConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
