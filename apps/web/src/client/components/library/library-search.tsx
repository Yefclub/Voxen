import { Loader2, Search, X } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';

interface LibrarySearchProps {
  value: string;
  changing: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function LibrarySearch({
  value,
  changing,
  onChange,
  onClear,
}: LibrarySearchProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <section aria-label={t('library.searchTitle')}>
      <span id="library-search-title" className="sr-only">
        {t('library.searchTitle')}
      </span>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
        <input
          type="text"
          role="searchbox"
          aria-labelledby="library-search-title"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('library.searchPlaceholder')}
          maxLength={240}
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] pl-10 pr-11 text-sm text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] transition-colors focus:border-[var(--theme-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)]"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
            aria-label={t('library.clearSearch')}
          >
            {changing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </section>
  );
}
