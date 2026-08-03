import { useMemo, useState } from 'react';
import { FileText, Loader2, Sparkles } from '@/components/ui/icons';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { FetchError } from '../components/ui/fetch-error';
import { Markdown } from '../components/ui/markdown';
import { PageShell } from '../components/ui/page-shell';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { useI18n, type I18nKey } from '../lib/i18n';
import { toast } from '../lib/toast';

type ArtifactType = 'BRIEFING' | 'FAQ' | 'STUDY_GUIDE' | 'TIMELINE' | 'MIND_MAP';
type Source = { id: string; title: string; source: string; createdAt: string };
type Artifact = {
  id: string;
  type: ArtifactType;
  title: string;
  content?: string;
  createdAt: string;
  unavailableSources: Array<{ id: string; title: string }>;
};
type ListResponse = { artifacts: Artifact[] };
type SourcesResponse = { transcripts: Source[] };
type FoldersResponse = { folders: Array<{ id: string; name: string }> };
type TagsResponse = { tags: Array<{ id: string; name: string }> };
type CreateResponse = { artifact: Artifact };

const TYPES: Array<{
  value: ArtifactType;
  labelKey: I18nKey;
}> = [
  { value: 'BRIEFING', labelKey: 'artifacts.type.briefing' },
  { value: 'FAQ', labelKey: 'artifacts.type.faq' },
  { value: 'STUDY_GUIDE', labelKey: 'artifacts.type.studyGuide' },
  { value: 'TIMELINE', labelKey: 'artifacts.type.timeline' },
  { value: 'MIND_MAP', labelKey: 'artifacts.type.mindMap' },
];

export function ArtefatosPage(): React.ReactElement {
  const { locale, t } = useI18n();
  const { data, loading, error, refresh } = useFetch<ListResponse>('/api/research-artifacts');
  const { data: sourceData } = useFetch<SourcesResponse>('/api/transcripts?limit=40');
  const { data: foldersData } = useFetch<FoldersResponse>('/api/library/folders');
  const { data: tagsData } = useFetch<TagsResponse>('/api/library/tags');
  const [selected, setSelected] = useState<string[]>([]);
  const [folderId, setFolderId] = useState('');
  const [tagId, setTagId] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ArtifactType>('BRIEFING');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Artifact | null>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  async function create(): Promise<void> {
    if (!selected.length && !folderId && !tagId && !query.trim()) return;
    setCreating(true);
    try {
      const response = await apiPost<CreateResponse>('/api/research-artifacts', {
        type,
        transcriptIds: selected,
        ...(folderId ? { folderId } : {}),
        ...(tagId ? { tagIds: [tagId] } : {}),
        ...(query.trim() ? { query: query.trim() } : {}),
      });
      setOpen(response.artifact);
      setSelected([]);
      await refresh();
      toast.success(t('artifacts.created'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('artifacts.createError'));
    } finally {
      setCreating(false);
    }
  }

  async function openArtifact(id: string): Promise<void> {
    try {
      const response = await apiGet<{ artifact: Artifact }>(`/api/research-artifacts/${id}`);
      setOpen(response.artifact);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  return (
    <PageShell width="wide" className="space-y-8 pb-24">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-accent-primary)]">
          {t('artifacts.eyebrow')}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('artifacts.title')}
        </h1>
        <p className="max-w-2xl text-sm text-[var(--color-app-muted)]">
          {t('artifacts.description')}
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card elevated>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h2 className="font-semibold">{t('artifacts.createTitle')}</h2>
              <p className="mt-1 text-xs text-[var(--color-app-muted)]">
                {t('artifacts.createHint')}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                className="h-9 rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-2 text-xs"
              >
                <option value="">{t('artifacts.anyFolder')}</option>
                {foldersData?.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <select
                value={tagId}
                onChange={(event) => setTagId(event.target.value)}
                className="h-9 rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-2 text-xs"
              >
                <option value="">{t('artifacts.anyTag')}</option>
                {tagsData?.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('artifacts.searchPlaceholder')}
                className="h-9 rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-2 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TYPES.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  variant={type === item.value ? 'default' : 'outline'}
                  size="sm"
                  className="justify-start text-xs"
                  onClick={() => setType(item.value)}
                >
                  {t(item.labelKey)}
                </Button>
              ))}
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-[var(--color-app-border)] p-2">
              {sourceData?.transcripts.length ? (
                sourceData.transcripts.map((source) => (
                  <label
                    key={source.id}
                    className="flex cursor-pointer gap-2 rounded-md p-2 text-sm hover:bg-[var(--color-app-surface)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(source.id)}
                      onChange={() =>
                        setSelected((current) =>
                          selectedSet.has(source.id)
                            ? current.filter((id) => id !== source.id)
                            : [...current, source.id],
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{source.title}</span>
                      <span className="text-xs text-[var(--color-app-muted)]">{source.source}</span>
                    </span>
                  </label>
                ))
              ) : (
                <p className="p-3 text-sm text-[var(--color-app-muted)]">
                  {t('artifacts.noSources')}
                </p>
              )}
            </div>
            <Button
              className="w-full"
              disabled={(!selected.length && !folderId && !tagId && !query.trim()) || creating}
              onClick={() => void create()}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t('artifacts.createAction')}
            </Button>
          </CardContent>
        </Card>
        <Card elevated>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-semibold">{t('artifacts.recent')}</h2>
            {error ? (
              <FetchError message={error} onRetry={refresh} />
            ) : loading ? (
              <p className="text-sm text-[var(--color-app-muted)]">{t('common.loading')}</p>
            ) : data?.artifacts.length ? (
              data.artifacts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border border-[var(--color-app-border)] p-3 text-left hover:bg-[var(--color-app-surface)]"
                  onClick={() => void openArtifact(item.id)}
                >
                  <FileText className="h-4 w-4 text-[var(--color-accent-primary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="text-xs text-[var(--color-app-muted)]">
                      {formatDateTime(new Date(item.createdAt), locale)}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-[var(--color-app-muted)]">{t('artifacts.empty')}</p>
            )}
          </CardContent>
        </Card>
      </div>
      {open?.content && (
        <Card elevated>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="font-display text-xl font-semibold">{open.title}</h2>
              {open.unavailableSources.length > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  {t('artifacts.unavailable', {
                    sources: open.unavailableSources.map((source) => source.title).join(', '),
                  })}
                </p>
              )}
            </div>
            <Markdown>{open.content}</Markdown>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
