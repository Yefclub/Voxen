import { Search } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';
import { TextInput } from '../ui/text-input';

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
      <TextInput
        type="search"
        label={t('library.searchTitle')}
        isLabelHidden
        startIcon={<Search className="h-4 w-4" />}
        value={value}
        onChange={(next) => (next === '' ? onClear() : onChange(next))}
        placeholder={t('library.searchPlaceholder')}
        maxLength={240}
        autoComplete="off"
        hasSpellCheck={false}
        enterKeyHint="search"
        hasClear
        isLoading={changing}
        controlClassName="library-search-control"
      />
    </section>
  );
}
