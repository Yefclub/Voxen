import { PanelLeftOpen } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';

export function MobileMenuButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('shell.openMenu')}
      title={t('shell.openMenu')}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-app-fg)] transition-colors hover:bg-[var(--color-app-surface)] md:hidden"
    >
      <PanelLeftOpen className="h-4 w-4" />
    </button>
  );
}
