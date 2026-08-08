import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Plus,
  Trash2,
  Video,
} from '@/components/ui/icons';
import { apiDelete, apiPost } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { useI18n, type I18nKey } from '../lib/i18n';
import { toast } from '../lib/toast';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { DataSurface } from '../components/ui/data-surface';
import { FetchError } from '../components/ui/fetch-error';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Skeleton } from '../components/ui/skeleton';

type SavedMediaStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'READY'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'DELETING'
  | 'FAILED';

type SavedMediaItem = {
  id: string;
  canonicalUrl: string;
  title: string | null;
  channel: string | null;
  author: string | null;
  durationSec: number | null;
  filename: string | null;
  byteSize: number | null;
  status: SavedMediaStatus;
  errorMsg: string | null;
  transcriptId: string | null;
  jobs: Array<{ id: string; type: string; status: string }>;
};

type SavedMediaResponse = { items: SavedMediaItem[]; total: number };

const ACTIVE = new Set<SavedMediaStatus>(['QUEUED', 'DOWNLOADING', 'PROCESSING']);
const PAGE_SIZE = 24;

export function SavedMediaPage(): React.ReactElement {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const { data, loading, error, refresh } = useFetch<SavedMediaResponse>(
    `/api/saved-media?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
  );
  const hasActive = useMemo(() => data?.items.some((item) => ACTIVE.has(item.status)), [data]);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(timer);
  }, [hasActive, refresh]);

  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && page > 0) {
      setPage((current) => Math.max(0, current - 1));
    }
  }, [data, page]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    try {
      await apiPost('/api/saved-media', { url: url.trim() });
      setUrl('');
      toast.success(t('savedMedia.created'));
      refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  async function process(item: SavedMediaItem): Promise<void> {
    setPendingId(item.id);
    try {
      await apiPost(`/api/saved-media/${item.id}/process`);
      toast.success(t('savedMedia.processQueued'));
      refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(item: SavedMediaItem): Promise<void> {
    setPendingId(item.id);
    try {
      await apiDelete(`/api/saved-media/${item.id}`);
      toast.success(t('savedMedia.deleted'));
      refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={t('savedMedia.eyebrow')}
        icon={Download}
        iconClassName="text-[var(--color-accent-violet)]"
        title={t('savedMedia.title')}
        description={t('savedMedia.description')}
      />

      <DataSurface data-page-reveal className="p-4 sm:p-5">
        <form onSubmit={(event) => void submit(event)} className="space-y-2">
          <label
            htmlFor="saved-media-url"
            className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]"
          >
            {t('savedMedia.urlLabel')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="saved-media-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('savedMedia.urlPlaceholder')}
              className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] px-3 text-sm outline-none transition focus:border-[var(--color-accent-violet)]/60 focus:ring-2 focus:ring-[var(--color-accent-violet-soft)]"
            />
            <Button type="submit" variant="violet" disabled={!url.trim() || submitting}>
              {submitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t(submitting ? 'savedMedia.saving' : 'savedMedia.save')}
            </Button>
          </div>
        </form>
      </DataSurface>

      {loading && !data && (
        <div className="grid gap-3 lg:grid-cols-2" data-page-reveal>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-52 rounded-xl" />
          ))}
        </div>
      )}
      {error && !data && (
        <FetchError message={t('savedMedia.loadError')} onRetry={refresh} data-page-reveal />
      )}
      {data && data.total === 0 && (
        <DataSurface
          data-page-reveal
          className="flex min-h-48 flex-col items-center justify-center p-8 text-center"
        >
          <Video className="mb-3 h-8 w-8 text-[var(--color-app-muted)]" />
          <p className="font-medium text-[var(--color-app-fg)]">{t('savedMedia.empty')}</p>
          <p className="mt-1 max-w-lg text-sm text-[var(--color-app-muted)]">
            {t('savedMedia.emptyHint')}
          </p>
        </DataSurface>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className="grid gap-3 lg:grid-cols-2" data-page-reveal>
            {data.items.map((item) => (
              <SavedMediaCard
                key={item.id}
                item={item}
                busy={pendingId === item.id}
                onProcess={() => void process(item)}
                onDelete={() => void remove(item)}
              />
            ))}
          </div>
          {(page > 0 || (page + 1) * PAGE_SIZE < data.total) && (
            <nav
              className="flex items-center justify-between gap-3"
              aria-label={t('savedMedia.pages')}
            >
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t('savedMedia.previous')}
              </Button>
              <span className="text-xs text-[var(--color-app-muted)]">
                {t('savedMedia.pageCount', {
                  current: page + 1,
                  total: Math.ceil(data.total / PAGE_SIZE),
                })}
              </span>
              <Button
                variant="secondary"
                disabled={(page + 1) * PAGE_SIZE >= data.total}
                onClick={() => setPage(page + 1)}
              >
                {t('savedMedia.next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </PageShell>
  );
}

function SavedMediaCard({
  item,
  busy,
  onProcess,
  onDelete,
}: {
  item: SavedMediaItem;
  busy: boolean;
  onProcess: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const job = item.jobs[0];
  const statusKey = `savedMedia.status.${item.status}` as I18nKey;
  const statusVariant =
    item.status === 'READY' || item.status === 'PROCESSED'
      ? 'success'
      : item.status === 'FAILED'
        ? 'danger'
        : 'warning';
  const meta = [
    item.channel || item.author,
    formatDuration(item.durationSec),
    formatBytes(item.byteSize, t('savedMedia.sizeUnknown')),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <DataSurface className="flex min-h-52 flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-violet-soft)] text-[var(--color-accent-violet)]">
            <Video className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="line-clamp-2 font-display font-semibold text-[var(--color-app-fg)]">
                {item.title || item.filename || item.canonicalUrl}
              </h2>
              <Badge variant={statusVariant}>{t(statusKey)}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--color-app-muted)]">{meta}</p>
          </div>
        </div>
        {item.errorMsg && (
          <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-300">
            {item.errorMsg}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          {(item.status === 'READY' || item.status === 'PROCESSED') && (
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/saved-media/${item.id}/content`} download={item.filename || true}>
                <Download className="h-3.5 w-3.5" />
                {t('savedMedia.download')}
              </a>
            </Button>
          )}
          {item.status === 'READY' && (
            <Button variant="violet" size="sm" disabled={busy} onClick={onProcess}>
              {busy ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {t(busy ? 'savedMedia.processing' : 'savedMedia.process')}
            </Button>
          )}
          {item.transcriptId && (
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/transcricoes/${item.transcriptId}`}>
                <FileText className="h-3.5 w-3.5" />
                {t('savedMedia.openTranscript')}
              </Link>
            </Button>
          )}
          {job && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/jobs/${job.id}`}>{t('savedMedia.openJob')}</Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href={item.canonicalUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              {t('savedMedia.source')}
            </a>
          </Button>
          {(['READY', 'FAILED', 'DELETING'] as SavedMediaStatus[]).includes(item.status) &&
            !item.transcriptId && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDeleteOpen(true)}
                className="ml-auto text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('savedMedia.delete')}
              </Button>
            )}
        </div>
      </DataSurface>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        variant="destructive"
        title={t('savedMedia.deleteTitle')}
        description={t('savedMedia.deleteDescription')}
        confirmLabel={t('savedMedia.delete')}
        loading={busy}
        onConfirm={onDelete}
      />
    </>
  );
}

function formatDuration(value: number | null): string | null {
  if (!value) return null;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(value: number | null, fallback: string): string {
  if (value === null) return fallback;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KiB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
}
