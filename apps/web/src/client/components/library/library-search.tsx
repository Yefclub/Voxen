import { Loader2, Network, Search, X } from '@/components/ui/icons';
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
    <section className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/5">
          <Network className="h-4 w-4 text-[var(--color-accent-violet)]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2
            id="library-search-title"
            className="text-sm font-semibold text-[var(--color-app-fg)]"
          >
            {t('library.searchTitle')}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-app-muted)]">
            {t('library.searchDescription')}
          </p>
        </div>
      </div>
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
          className="h-12 w-full rounded-xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg)] pl-10 pr-11 text-sm text-[var(--color-app-fg)] shadow-inner placeholder:text-[var(--color-app-muted)] transition-colors focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
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
