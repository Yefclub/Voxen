import { useId } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import type { TranslateFn } from '../../lib/i18n';

export function ResearchEditor({
  open,
  onClose,
  title,
  content,
  setTitle,
  setContent,
  busy,
  error,
  onSave,
  t,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  setTitle: (value: string) => void;
  setContent: (value: string) => void;
  busy: boolean;
  error: string;
  onSave: () => void;
  t: TranslateFn;
}): React.ReactElement {
  const titleId = useId();
  const contentId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        className="h-[min(85dvh,var(--visual-viewport-height,85dvh))] gap-0 overflow-hidden md:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('research.edit.title')}</DialogTitle>
          <DialogDescription>{t('research.edit.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="mt-5 flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) onSave();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5 pb-1">
            <div className="space-y-2 text-sm font-medium">
              <label htmlFor={titleId}>{t('research.edit.heading')}</label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={300}
                className="min-h-11"
                disabled={busy}
              />
            </div>
            <div className="space-y-2 text-sm font-medium">
              <label htmlFor={contentId}>{t('research.edit.content')}</label>
              <Textarea
                id={contentId}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={200_000}
                className="min-h-48 text-base leading-7"
                disabled={busy}
              />
            </div>
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={t('research.edit.status')}
              className="text-sm text-[var(--color-app-danger)]"
            >
              {error}
            </p>
          </div>
          <DialogFooter className="shrink-0 border-t border-[var(--color-app-border)] pt-5">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || !content.trim() || busy}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
