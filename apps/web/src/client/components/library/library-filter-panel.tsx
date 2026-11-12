import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from '@/components/ui/icons';
import { useIsDesktop } from '../../lib/use-media-query';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export function LibraryFilterPanel({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button variant="secondary">
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      {t('common.filters')}
      {count > 0 && <span className="tabular-nums">({count})</span>}
    </Button>
  );
  if (desktop)
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          className="max-h-[80dvh] w-[min(38rem,90vw)] overflow-y-auto p-5"
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle asChild>
          <span className="sr-only">{t('library.filtersTitle')}</span>
        </DialogTitle>
        {children}
        <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
      </DialogContent>
    </Dialog>
  );
}
