import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Archive,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  Languages,
  Loader2,
  MessageSquare,
  RotateCcw,
  RefreshCw,
  Sparkles,
  Tags,
  Trash2,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { FetchError } from '../components/ui/fetch-error';
import { Skeleton } from '../components/ui/skeleton';
import { useFetch } from '../lib/hooks';
import { apiDelete, apiPatch, apiPost, ApiError } from '../lib/api';
import { formatDateTime, formatDuration, formatUsd } from '../lib/format';
import { PageShell } from '../components/ui/page-shell';
import { TranscriptViewer } from '../components/ui/transcript-viewer';
import { Markdown } from '../components/ui/markdown';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { UploadMediaViewer } from '../components/ui/media-viewer';
import { resolveTranscriptPreviewSrc } from '../lib/preview-src';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';
import { cn } from '../lib/utils';
import { buildTranscriptChatMessage, type ChatHandoffState } from '../lib/chat-handoff';
import { stripMarkdownFrontmatter, transcriptRenderMode } from '../lib/transcript-render';
import { TranscriptChatDock } from '../components/library/transcript-chat-dock';
import {
  LinkedNotesCard,
  type LinkedNote,
  type LinkedNoteAnchorDraft,
  type LinkedNotesResponse,
} from '../components/library/linked-notes-card';
import {
  AdditionalContextBlock,
  type TranscriptEnrichmentsResponse,
} from '../components/library/additional-context-block';
import {
  TranscriptFlowBlock,
  TranscriptSummaryBlock,
} from '../components/library/transcript-derived-content';
import { isExternalSourceUrl, sourceDisplayLine } from '../lib/source-url';

interface TranscriptDetail {
  id: string;
  folderId: string | null;
  folder: { id: string; name: string; parentId: string | null } | null;
  tags: { id: string; name: string; slug: string }[];
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH';
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  url: string;
  title: string;
  channel: string | null;
  author: string | null;
  durationSec: number;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  originalObjectKey: string | null;
  originalFilename: string | null;
  originalMimeType: string | null;
  previewObjectKey: string | null;
  previewMimeType: string | null;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES' | 'SCRAPE' | 'VISION' | 'DOCUMENT' | 'X_SEARCH';
  model: string | null;
  costUsd: string | null;
  // Soma de costUsd da transcrição + custos de resumos/regenerações.
  // Backend calcula a partir de CostEvent.meta.transcript_id.
  totalCostUsd: string | null;
  mdPath: string;
  plainText: string;
  summaryMd: string | null;
  flowchartMd: string | null;
  frontmatter: unknown;
  sourceChecksum: string | null;
  sourceVersion: number;
  sourceCollectedAt: string | null;
  sourceMetadata: unknown;
  sourceRefreshStatus: 'CURRENT' | 'CHECKING' | 'FAILED';
  sourceRefreshError: string | null;
  sourceVersions: Array<{
    version: number;
    checksum: string;
    collectedAt: string;
    metadata: unknown;
  }>;
  archivedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
}

interface ResponseBody {
  transcript: TranscriptDetail;
  markdown: string;
}

interface LibraryFolder {
  id: string;
  parentId: string | null;
  name: string;
  _count?: { transcripts: number; children: number };
}

interface FoldersResponse {
  folders: LibraryFolder[];
}

export function TranscricaoDetalhePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { locale, t: translate } = useI18n();
  const { data, loading, error, refresh } = useFetch<ResponseBody>(
    id ? `/api/transcripts/${id}?includeTrash=1` : null,
  );
  const {
    data: linkedNotesData,
    loading: linkedNotesLoading,
    refresh: refreshLinkedNotes,
  } = useFetch<LinkedNotesResponse>(
    id && data?.transcript.status !== 'TRASH' ? `/api/transcripts/${id}/notes` : null,
  );
  const {
    data: enrichmentsData,
    loading: enrichmentsLoading,
    refresh: refreshEnrichments,
  } = useFetch<TranscriptEnrichmentsResponse>(
    id && data?.transcript.status !== 'TRASH' ? `/api/transcripts/${id}/enrichments` : null,
  );
  const { data: foldersData, refresh: refreshFolders } =
    useFetch<FoldersResponse>('/api/library/folders');
  const [generating, setGenerating] = useState(false);
  const [generatingFlow, setGeneratingFlow] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [taggingLoading, setTaggingLoading] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingLinkedNote, setCreatingLinkedNote] = useState(false);
  const [linkedNoteTitle, setLinkedNoteTitle] = useState('');
  const [linkedNoteContent, setLinkedNoteContent] = useState('');
  const [linkedNoteAnchor, setLinkedNoteAnchor] = useState<LinkedNoteAnchorDraft | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmFlowRegen, setConfirmFlowRegen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [refreshingSource, setRefreshingSource] = useState(false);

  useEffect(() => {
    if (data?.transcript.sourceRefreshStatus !== 'CHECKING') return;
    const timer = window.setInterval(() => void refresh(), 7_500);
    return () => window.clearInterval(timer);
  }, [data?.transcript.sourceRefreshStatus, refresh]);

  useEffect(() => {
    const active = enrichmentsData?.enrichments.some((item) =>
      ['PENDING', 'RUNNING', 'RETRY'].includes(item.status),
    );
    if (!active) return;
    const timer = window.setInterval(() => void refreshEnrichments(), 5_000);
    return () => window.clearInterval(timer);
  }, [enrichmentsData?.enrichments, refreshEnrichments]);

  async function queueResearch(): Promise<void> {
    if (!id) return;
    try {
      await apiPost(`/api/transcripts/${id}/enrichments`, {});
      toast.success(translate('library.additionalContextQueued'));
      await refreshEnrichments();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : translate('library.additionalContextError'),
      );
    }
  }

  async function updateEnrichment(
    enrichmentId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!id) return;
    try {
      await apiPatch(`/api/transcripts/${id}/enrichments/${enrichmentId}`, body);
      await refreshEnrichments();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : translate('library.additionalContextError'),
      );
      throw error;
    }
  }

  async function deleteEnrichment(enrichmentId: string): Promise<void> {
    if (!id) return;
    try {
      await apiDelete(`/api/transcripts/${id}/enrichments/${enrichmentId}`);
      await refreshEnrichments();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : translate('library.additionalContextError'),
      );
      throw error;
    }
  }

  async function refreshSource(): Promise<void> {
    if (!id || refreshingSource) return;
    setRefreshingSource(true);
    try {
      await apiPost(`/api/transcripts/${id}/refresh`, {});
      toast.success(translate('library.sourceRefreshQueued'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : translate('library.sourceRefreshError'));
    } finally {
      setRefreshingSource(false);
    }
  }

  async function generateSummary(force: boolean): Promise<void> {
    if (!id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/transcripts/${id}/summary`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        existing?: boolean;
      };
      if (res.status === 409 && body.existing) {
        // Já tem resumo → abre confirm modal pra regen
        setConfirmRegen(true);
        return;
      }
      if (!res.ok) {
        toast.error(body.error ?? translate('library.summaryError'));
        return;
      }
      toast.success(
        force ? translate('library.summaryRegenerated') : translate('library.summaryGenerated'),
      );
      refresh();
    } catch (e) {
      toast.error(translate('library.summaryUnexpectedError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  }

  async function generateFlow(force: boolean): Promise<void> {
    if (!id || generatingFlow) return;
    setGeneratingFlow(true);
    try {
      const res = await fetch(`/api/transcripts/${id}/flow`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        existing?: boolean;
      };
      if (res.status === 409 && body.existing) {
        setConfirmFlowRegen(true);
        return;
      }
      if (!res.ok) {
        toast.error(body.error ?? translate('library.flowError'));
        return;
      }
      toast.success(
        force ? translate('library.flowRegenerated') : translate('library.flowGenerated'),
      );
      await refresh();
    } catch {
      toast.error(translate('library.flowError'));
    } finally {
      setGeneratingFlow(false);
    }
  }

  async function generateTags(): Promise<void> {
    if (!id || taggingLoading) return;
    setTaggingLoading(true);
    try {
      const res = await fetch(`/api/transcripts/${id}/generate-tags`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        tags?: { id: string; name: string; slug: string }[];
        generated?: number;
      };
      if (!res.ok) {
        toast.error(body.error ?? translate('library.tagsError'));
        return;
      }
      if ((body.generated ?? 0) === 0) {
        toast.message(translate('library.tagsNoneGenerated'));
      } else {
        toast.success(translate('library.tagsGenerated', { count: body.generated ?? 0 }));
      }
      refresh();
      refreshFolders();
    } catch (e) {
      toast.error(translate('library.tagsError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setTaggingLoading(false);
    }
  }

  async function moveToFolder(folderId: string | null): Promise<void> {
    if (!id) return;
    setOrganizing(true);
    try {
      const res = await fetch(`/api/transcripts/${id}/organization`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? translate('library.folderError'));
        return;
      }
      toast.success(translate('library.folderSaved'));
      refresh();
    } catch (e) {
      toast.error(translate('library.folderError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setOrganizing(false);
    }
  }

  async function createFolder(name: string): Promise<void> {
    setOrganizing(true);
    try {
      const res = await fetch('/api/library/folders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        folder?: { id: string };
      };
      if (!res.ok || !body.folder) {
        toast.error(body.error ?? translate('library.folderError'));
        setOrganizing(false);
        return;
      }
      await refreshFolders();
      await moveToFolder(body.folder.id);
    } catch (e) {
      toast.error(translate('library.folderError'), {
        description: e instanceof Error ? e.message : undefined,
      });
      setOrganizing(false);
    }
  }

  async function updateLifecycle(status: TranscriptDetail['status']): Promise<void> {
    if (!id) return;
    setLifecycleLoading(true);
    try {
      const res = await fetch(`/api/transcripts/${id}/lifecycle`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? translate('library.lifecycleError'));
        return;
      }
      if (status === 'TRASH') {
        toast.success(translate('library.movedToTrash'));
        navigate('/transcricoes');
        return;
      }
      toast.success(
        status === 'ARCHIVED' ? translate('library.archived') : translate('library.restored'),
      );
      refresh();
    } catch (e) {
      toast.error(translate('library.lifecycleError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function hardDelete(): Promise<void> {
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/transcripts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? translate('library.deleteError'));
        return;
      }
      toast.success(translate('library.deleted'));
      navigate('/transcricoes?status=trash');
    } catch (e) {
      toast.error(translate('library.deleteError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  function sendToChat(transcript: TranscriptDetail): void {
    const text = chatDraft.trim();
    if (!text) return;
    const autoSend = buildTranscriptChatMessage({
      userText: text,
      transcriptId: transcript.id,
      title: transcript.title,
    });
    const state: ChatHandoffState = { autoSend };
    navigate('/', { state });
  }

  async function createLinkedNote(transcript: TranscriptDetail): Promise<void> {
    const title = linkedNoteTitle.trim();
    if (!title) {
      toast.error(translate('library.linkedNoteError'));
      return;
    }
    setCreatingLinkedNote(true);
    try {
      await apiPost<{ note: LinkedNote }>(`/api/transcripts/${transcript.id}/notes`, {
        title,
        content: linkedNoteContent,
        anchors: linkedNoteAnchor
          ? [
              {
                transcriptId: transcript.id,
                ...linkedNoteAnchor,
                sourceVersion: transcript.sourceVersion,
                sourceChecksum: transcript.sourceChecksum,
              },
            ]
          : [],
      });
      setLinkedNoteTitle('');
      setLinkedNoteContent('');
      setLinkedNoteAnchor(null);
      refreshLinkedNotes();
      toast.success(translate('library.linkedNoteCreated'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : translate('library.linkedNoteError'), {
        description: e instanceof Error && !(e instanceof ApiError) ? e.message : undefined,
      });
    } finally {
      setCreatingLinkedNote(false);
    }
  }

  if (!loading && error) {
    return (
      <PageShell width="wide">
        <FetchError message={error} onRetry={refresh} />
      </PageShell>
    );
  }

  if (loading || !data) {
    return (
      <PageShell width="wide">
        <Skeleton className="h-7 w-32 mb-8" />
        <Skeleton className="h-12 w-3/4 mb-3" />
        <Skeleton className="h-5 w-1/3 mb-10" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
          <div className="space-y-3">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  const t = data.transcript;
  const created = new Date(t.createdAt);
  const published = t.publishedAt ? new Date(t.publishedAt) : null;
  const isVisualTranscript = t.transcriptionMethod === 'VISION';
  const isDocumentTranscript = t.transcriptionMethod === 'DOCUMENT';
  const canUseContextualActions = t.status !== 'TRASH';
  const contentMarkdown = stripMarkdownFrontmatter(data.markdown);
  const renderMode = transcriptRenderMode({
    source: t.source,
    transcriptionMethod: t.transcriptionMethod,
    markdown: data.markdown,
  });
  const contentHeading = isDocumentTranscript
    ? translate('library.documentAnalysis')
    : isVisualTranscript
      ? translate('library.analysis')
      : t.transcriptionMethod === 'X_SEARCH'
        ? translate('library.postAnalysis')
        : translate('library.content');
  const previewSrc = resolveTranscriptPreviewSrc(t.id, t.thumbnailUrl);

  return (
    <>
      <PageShell width="wide" className="relative overflow-x-clip pb-28 sm:pb-32">
        <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2 hidden sm:inline-flex">
          <Link to="/transcricoes">
            <ArrowLeft className="h-3.5 w-3.5" />
            {translate('library.detailBack')}
          </Link>
        </Button>

        <header className="mb-6 space-y-4 sm:mb-8">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source primário — clarifica origem do conteúdo */}
            <Badge variant={t.source === 'WEB' ? 'muted' : 'success'} className="text-[10px]">
              {t.source === 'WEB' && (
                <>
                  <Globe className="h-3 w-3" />
                  {translate('library.source.web')}
                </>
              )}
              {t.source === 'YOUTUBE' && 'YouTube'}
              {t.source === 'INSTAGRAM' && 'Instagram Reel'}
              {t.source === 'TIKTOK' && 'TikTok'}
              {t.source === 'X' && 'X'}
              {t.source === 'UPLOAD' && 'Upload'}
            </Badge>
            {/* Método de extração — só faz sentido pra vídeos */}
            {t.source !== 'WEB' && (
              <Badge
                variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
                className="text-[10px]"
              >
                {isDocumentTranscript ? (
                  translate('library.method.document')
                ) : isVisualTranscript ? (
                  translate('library.method.visualAnalysis')
                ) : t.transcriptionMethod === 'SUBTITLES' ? (
                  translate('library.method.officialSubtitles')
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 inline mr-1" />{' '}
                    {translate('library.method.aiTranscript')}
                  </>
                )}
              </Badge>
            )}
            {t.language && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {t.language}
              </Badge>
            )}
            {t.status === 'ARCHIVED' && (
              <Badge variant="muted" className="text-[10px]">
                {translate('library.statusArchived')}
              </Badge>
            )}
            {t.status === 'TRASH' && (
              <Badge variant="danger" className="text-[10px]">
                {translate('library.statusTrash')}
              </Badge>
            )}
          </div>
          <h1 className="max-w-full break-words font-display text-2xl font-semibold leading-[1.1] tracking-[-0.03em] text-balance [overflow-wrap:anywhere] sm:text-4xl lg:text-[2.75rem]">
            {t.title}
          </h1>
          {t.channel && (
            <p className="text-[15px] text-[var(--color-app-muted)] break-words [overflow-wrap:anywhere]">
              {t.channel}
            </p>
          )}
          {isExternalSourceUrl(t.url) && (
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="group/source inline-flex max-w-full items-center gap-1.5 text-sm text-[var(--color-app-muted)] transition-colors hover:text-[var(--color-accent-primary)]"
              title={t.url}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover/source:opacity-100" />
              <span className="min-w-0 truncate font-mono text-[13px] tracking-tight">
                {sourceDisplayLine(t.url) ?? t.url}
              </span>
            </a>
          )}
          {t.source === 'UPLOAD' && t.originalFilename && (
            <p className="inline-flex max-w-full items-center gap-1.5 text-sm text-[var(--color-app-muted)]">
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 truncate font-mono text-[13px]">{t.originalFilename}</span>
            </p>
          )}
          {canUseContextualActions && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--color-app-muted)]">
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]/80" />
              {translate('library.chatBarHint')}
            </p>
          )}
        </header>

        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
          {/* Coluna principal: resumo + transcrição */}
          <article className="min-w-0 space-y-7 sm:space-y-8">
            <TranscriptSummaryBlock
              summary={t.summaryMd}
              generating={generating}
              onGenerate={() => void generateSummary(false)}
              t={translate}
            />
            <TranscriptFlowBlock
              flowchart={t.flowchartMd}
              generating={generatingFlow}
              onGenerate={() => void generateFlow(false)}
              readOnly={!canUseContextualActions}
              t={translate}
            />
            <AdditionalContextBlock
              enrichments={enrichmentsData?.enrichments ?? []}
              researchMode={enrichmentsData?.researchMode ?? 'OFF'}
              loading={enrichmentsLoading}
              locale={locale}
              onQueue={() => void queueResearch()}
              onUpdate={updateEnrichment}
              onDelete={deleteEnrichment}
              t={translate}
            />
            {renderMode === 'markdown' ? (
              <section className="space-y-3">
                <h2 className="font-display text-base font-semibold tracking-tight text-[var(--color-app-subtle)] sm:text-lg">
                  {contentHeading}
                </h2>
                <Card elevated className="border-[var(--color-app-border)]/80">
                  <CardContent className="px-5 py-5 sm:px-6">
                    <Markdown>{contentMarkdown}</Markdown>
                  </CardContent>
                </Card>
              </section>
            ) : (
              <TranscriptViewer
                markdown={data.markdown}
                anchors={(linkedNotesData?.notes ?? []).flatMap((note) =>
                  note.transcriptSources.flatMap((source) => source.anchors),
                )}
                onCreateAnnotation={(selection) => {
                  setLinkedNoteAnchor(selection);
                  window.setTimeout(
                    () =>
                      document
                        .getElementById('linked-notes-card')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                    0,
                  );
                }}
              />
            )}
          </article>

          {/* Sidebar: metadata + thumbnail */}
          <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-24">
            <Card className="order-2 overflow-hidden p-0 lg:order-none" elevated>
              {t.originalObjectKey && t.originalMimeType ? (
                <UploadMediaViewer
                  transcriptId={t.id}
                  mimeType={t.originalMimeType}
                  previewSrc={previewSrc}
                  title={t.title}
                />
              ) : (
                <img
                  src={previewSrc}
                  alt=""
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
              )}
            </Card>

            <Card elevated className="order-3 lg:order-none">
              <CardContent className="pt-5 pb-5 space-y-4">
                <LibraryFolderControl
                  folders={foldersData?.folders ?? []}
                  folderId={t.folderId}
                  organizing={organizing}
                  onMove={moveToFolder}
                  onCreate={createFolder}
                  t={translate}
                />
                <TagsControl
                  tags={t.tags}
                  loading={taggingLoading}
                  onGenerate={generateTags}
                  disabled={t.status === 'TRASH'}
                  translate={translate}
                />
                {/* Duração só faz sentido pra vídeos */}
                {t.source !== 'WEB' && !isVisualTranscript && !isDocumentTranscript && (
                  <MetaRow
                    Icon={Clock}
                    label={translate('library.duration')}
                    value={formatDuration(t.durationSec)}
                  />
                )}
                {t.channel && t.source === 'WEB' && (
                  <MetaRow Icon={Globe} label={translate('library.site')} value={t.channel} />
                )}
                <MetaRow
                  Icon={Languages}
                  label={translate('library.language')}
                  value={t.language.toUpperCase()}
                />
                <MetaRow
                  Icon={Calendar}
                  label={translate('library.added')}
                  value={formatDateTime(created, locale)}
                />
                {published && (
                  <MetaRow
                    Icon={Calendar}
                    label={translate('library.published')}
                    value={formatDateTime(published, locale)}
                  />
                )}
                {t.source === 'WEB' && (
                  <SourceFreshness
                    transcript={t}
                    locale={locale}
                    translate={translate}
                    refreshing={refreshingSource}
                    onRefresh={() => void refreshSource()}
                  />
                )}
                {t.model && (
                  <MetaRow
                    Icon={FileText}
                    label={translate('library.model')}
                    value={t.model}
                    mono
                  />
                )}
                {/* Mostra apenas se houve custo de fato (>0). totalCostUsd
                    agrega transcrição + summary/regenerações. */}
                {parseFloat(t.totalCostUsd ?? '0') > 0 && (
                  <MetaRow
                    Icon={FileText}
                    label={translate('library.cost')}
                    value={formatUsd(t.totalCostUsd)}
                    mono
                  />
                )}
              </CardContent>
            </Card>

            {canUseContextualActions && (
              <div className="order-4 lg:order-none">
                <LinkedNotesCard
                  notes={linkedNotesData?.notes ?? []}
                  loading={linkedNotesLoading}
                  title={linkedNoteTitle}
                  content={linkedNoteContent}
                  anchor={linkedNoteAnchor}
                  creating={creatingLinkedNote}
                  locale={locale}
                  onTitleChange={setLinkedNoteTitle}
                  onContentChange={setLinkedNoteContent}
                  onAnchorChange={setLinkedNoteAnchor}
                  onCreate={() => void createLinkedNote(t)}
                  t={translate}
                />
              </div>
            )}

            <Card elevated className="order-1 lg:order-none">
              <CardContent className="space-y-3 pb-5 pt-5">
                {t.status === 'ARCHIVED' || t.status === 'TRASH' ? (
                  <Button
                    variant="outline"
                    size="default"
                    className="w-full"
                    disabled={lifecycleLoading}
                    onClick={() => void updateLifecycle('ACTIVE')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {translate('library.restore')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="default"
                    className="w-full"
                    disabled={lifecycleLoading}
                    onClick={() => void updateLifecycle('ARCHIVED')}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    {translate('library.archive')}
                  </Button>
                )}
                {t.status === 'TRASH' ? (
                  <Button
                    variant="destructive"
                    size="default"
                    className="w-full"
                    disabled={deleting}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {translate('library.deletePermanently')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="default"
                    className="w-full border-red-500/25 text-red-200 hover:bg-red-500/10 hover:text-red-100"
                    disabled={lifecycleLoading}
                    onClick={() => void updateLifecycle('TRASH')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {translate('library.moveToTrash')}
                  </Button>
                )}
              </CardContent>
            </Card>

            {t.source !== 'UPLOAD' && (
              <Button
                variant="outline"
                size="default"
                className="order-5 w-full lg:order-none"
                asChild
              >
                <a href={t.url} target="_blank" rel="noreferrer">
                  {t.source === 'WEB'
                    ? translate('library.openPage')
                    : translate('library.openVideo')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
            {t.originalObjectKey && (
              <Button
                variant="outline"
                size="default"
                className="order-5 w-full lg:order-none"
                asChild
              >
                <a href={`/api/transcripts/${t.id}/original`} target="_blank" rel="noreferrer">
                  {translate('library.openOriginalUpload')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
          </aside>
        </div>
      </PageShell>

      {canUseContextualActions && (
        <TranscriptChatDock
          value={chatDraft}
          onChange={setChatDraft}
          onSend={() => sendToChat(t)}
          title={t.title}
          t={translate}
        />
      )}

      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title={translate('library.regenerateTitle')}
        description={translate('library.regenerateDescription')}
        confirmLabel={translate('library.regenerateSummary')}
        cancelLabel={translate('common.cancel')}
        onConfirm={() => generateSummary(true)}
        loading={generating}
      />
      <ConfirmDialog
        open={confirmFlowRegen}
        onOpenChange={setConfirmFlowRegen}
        title={translate('library.regenerateFlowTitle')}
        description={translate('library.regenerateFlowDescription')}
        confirmLabel={translate('library.regenerateFlow')}
        cancelLabel={translate('common.cancel')}
        onConfirm={() => generateFlow(true)}
        loading={generatingFlow}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={translate('library.deleteTitle')}
        description={translate('library.deleteDescription')}
        confirmLabel={translate('library.deletePermanently')}
        cancelLabel={translate('common.cancel')}
        variant="destructive"
        onConfirm={() => hardDelete()}
        loading={deleting}
      />
    </>
  );
}

function LibraryFolderControl({
  folders,
  folderId,
  organizing,
  onMove,
  onCreate,
  t,
}: {
  folders: LibraryFolder[];
  folderId: string | null;
  organizing: boolean;
  onMove: (folderId: string | null) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  t: TranslateFn;
}): React.ReactElement {
  const [name, setName] = useState('');
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName('');
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-app-muted)]">
        <Folder className="h-3.5 w-3.5 text-amber-400" />
        {t('library.folder')}
      </div>
      <Select
        value={folderId ?? 'none'}
        disabled={organizing}
        onValueChange={(value) => void onMove(value === 'none' ? null : value)}
      >
        <SelectTrigger className="h-10">
          <SelectValue placeholder={t('library.noFolder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('library.noFolder')}</SelectItem>
          {sortedFolders.map((folder) => (
            <SelectItem key={folder.id} value={folder.id}>
              {folder.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder={t('library.newFolderPlaceholder')}
          className="min-w-0 flex-1 h-9 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 text-xs text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15"
          disabled={organizing}
          maxLength={120}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={organizing || name.trim().length === 0}
          onClick={() => void submit()}
        >
          {t('library.createFolder')}
        </Button>
      </div>
    </div>
  );
}

function TagsControl({
  tags,
  loading,
  onGenerate,
  disabled,
  translate,
}: {
  tags: { id: string; name: string; slug: string }[];
  loading: boolean;
  onGenerate: () => Promise<void>;
  disabled: boolean;
  translate: TranslateFn;
}): React.ReactElement {
  return (
    <div className="space-y-2.5 border-t border-[var(--color-app-border)] pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-app-muted)]">
          <Tags className="h-3.5 w-3.5 text-violet-400" />
          {translate('library.tagsLabel')}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={loading || disabled}
          onClick={() => void onGenerate()}
          title={translate('library.tagsHint')}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3 text-violet-400" />
          )}
          {loading ? translate('library.tagsRunning') : translate('library.tagsAction')}
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-2 py-0.5 text-[11px] text-[var(--color-app-subtle)]"
            >
              <Tags className="h-2.5 w-2.5 shrink-0 text-violet-400/80" />
              <span className="truncate">{tag.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceFreshness({
  transcript,
  locale,
  translate,
  refreshing,
  onRefresh,
}: {
  transcript: Pick<
    TranscriptDetail,
    | 'sourceCollectedAt'
    | 'sourceVersion'
    | 'sourceRefreshStatus'
    | 'sourceRefreshError'
    | 'sourceVersions'
  >;
  locale: Locale;
  translate: TranslateFn;
  refreshing: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  const checking = transcript.sourceRefreshStatus === 'CHECKING';
  const failed = transcript.sourceRefreshStatus === 'FAILED';
  const status = checking
    ? translate('library.sourceChecking')
    : failed
      ? translate('library.sourceRefreshFailed')
      : translate('library.sourceCurrent');
  const statusClass = checking ? 'text-amber-300' : failed ? 'text-red-300' : 'text-emerald-400';
  return (
    <div className="space-y-2 border-t border-[var(--color-app-border)] pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-app-muted)]">
          <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
          {translate('library.sourceVersion', { version: transcript.sourceVersion || 1 })}
        </div>
        <span className={cn('text-[11px]', statusClass)}>{status}</span>
      </div>
      {transcript.sourceCollectedAt && (
        <p className="text-[11px] text-[var(--color-app-muted)]">
          {translate('library.sourceCollected')}:{' '}
          {formatDateTime(new Date(transcript.sourceCollectedAt), locale)}
        </p>
      )}
      {transcript.sourceVersions.length > 1 && (
        <p className="text-[11px] text-[var(--color-app-muted)]">
          {translate('library.sourceVersionHistory', { count: transcript.sourceVersions.length })}
        </p>
      )}
      {failed && transcript.sourceRefreshError && (
        <p className="text-[11px] leading-relaxed text-red-300">{transcript.sourceRefreshError}</p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-[11px]"
        disabled={checking || refreshing}
        onClick={onRefresh}
      >
        <RefreshCw className={cn('h-3 w-3', (checking || refreshing) && 'animate-spin')} />
        {translate('library.sourceRefresh')}
      </Button>
    </div>
  );
}

function MetaRow({
  Icon,
  label,
  value,
  mono,
}: {
  Icon: typeof Clock;
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <div className="h-7 w-7 rounded-md bg-[var(--color-app-bg-elevated)] border border-[var(--color-app-border)] flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-app-muted)] font-medium">
          {label}
        </p>
        <p
          className={
            mono
              ? 'text-[13px] font-mono text-[var(--color-app-subtle)] truncate mt-0.5 tabular-nums'
              : 'text-sm text-[var(--color-app-subtle)] mt-0.5'
          }
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
