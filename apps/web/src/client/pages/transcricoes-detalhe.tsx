import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
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
  MessageCircle,
  NotebookPen,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { useFetch } from '../lib/hooks';
import { apiPost, ApiError } from '../lib/api';
import { formatDateTime, formatDuration, formatUsd } from '../lib/format';
import { AnimatedPage } from '../components/motion/animated-page';
import { TranscriptViewer } from '../components/ui/transcript-viewer';
import { Markdown } from '../components/ui/markdown';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';
import { createConversation } from '../lib/use-conversations';
import type { LibraryMentionItem } from '../components/ui/prompt-box';

interface TranscriptDetail {
  id: string;
  folderId: string | null;
  folder: { id: string; name: string; parentId: string | null } | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH';
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  url: string;
  title: string;
  channel: string | null;
  author: string | null;
  durationSec: number;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES' | 'SCRAPE' | 'VISION' | 'DOCUMENT';
  model: string | null;
  costUsd: string | null;
  // Soma de costUsd da transcrição + custos de resumos/regenerações.
  // Backend calcula a partir de CostEvent.meta.transcript_id.
  totalCostUsd: string | null;
  mdPath: string;
  plainText: string;
  summaryMd: string | null;
  frontmatter: unknown;
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

interface LinkedNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface LinkedNotesResponse {
  notes: LinkedNote[];
}

export function TranscricaoDetalhePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { locale, t: translate } = useI18n();
  const { data, loading, refresh } = useFetch<ResponseBody>(
    id ? `/api/transcripts/${id}?includeTrash=1` : null,
  );
  const {
    data: linkedNotesData,
    loading: linkedNotesLoading,
    refresh: refreshLinkedNotes,
  } = useFetch<LinkedNotesResponse>(
    id && data?.transcript.status !== 'TRASH' ? `/api/transcripts/${id}/notes` : null,
  );
  const { data: foldersData, refresh: refreshFolders } =
    useFetch<FoldersResponse>('/api/library/folders');
  const [generating, setGenerating] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [creatingLinkedNote, setCreatingLinkedNote] = useState(false);
  const [linkedNoteTitle, setLinkedNoteTitle] = useState('');
  const [linkedNoteContent, setLinkedNoteContent] = useState('');
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  async function startContextualChat(transcript: TranscriptDetail): Promise<void> {
    setStartingChat(true);
    try {
      const conv = await createConversation(`Sobre: ${transcript.title}`.slice(0, 60));
      if (!conv) {
        toast.error(translate('library.chatError'));
        return;
      }
      const mention: LibraryMentionItem = {
        type: 'transcript',
        id: transcript.id,
        label: transcript.title,
        subtitle: [transcript.source, transcript.channel].filter(Boolean).join(' · '),
      };
      navigate(`/chat/${conv.id}`, {
        state: {
          prefill: {
            text: translate('library.chatPrompt', { title: transcript.title }),
            mentions: [mention],
          },
        },
      });
      toast.success(translate('library.chatReady'));
    } catch (e) {
      toast.error(translate('library.chatError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setStartingChat(false);
    }
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
      });
      setLinkedNoteTitle('');
      setLinkedNoteContent('');
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

  if (loading || !data) {
    return (
      <div className="px-8 py-10 mx-auto max-w-5xl">
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
      </div>
    );
  }

  const t = data.transcript;
  const created = new Date(t.createdAt);
  const published = t.publishedAt ? new Date(t.publishedAt) : null;
  const isVisualTranscript = t.transcriptionMethod === 'VISION';
  const isDocumentTranscript = t.transcriptionMethod === 'DOCUMENT';
  const canUseContextualActions = t.status !== 'TRASH';
  const contentMarkdown = stripMarkdownFrontmatter(data.markdown);

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-5xl">
        <Button variant="ghost" size="sm" asChild className="mb-8 -ml-2">
          <Link to="/transcricoes">
            <ArrowLeft className="h-3.5 w-3.5" />
            {translate('library.detailBack')}
          </Link>
        </Button>

        <motion.header
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10 space-y-4"
        >
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
          <h1 className="font-display text-4xl lg:text-5xl font-semibold tracking-[-0.035em] leading-[1.05] text-balance">
            {t.title}
          </h1>
          {t.channel && <p className="text-[15px] text-[var(--color-app-muted)]">{t.channel}</p>}
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10">
          {/* Coluna principal: resumo + transcrição */}
          <motion.article
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="min-w-0 space-y-10"
          >
            <SummaryBlock
              summary={t.summaryMd}
              generating={generating}
              onGenerate={() => void generateSummary(false)}
              t={translate}
            />
            {t.source === 'WEB' || isVisualTranscript || isDocumentTranscript ? (
              <section>
                <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-200 mb-4">
                  {isDocumentTranscript
                    ? translate('library.documentAnalysis')
                    : isVisualTranscript
                      ? translate('library.analysis')
                      : translate('library.content')}
                </h2>
                <Card elevated>
                  <CardContent className="px-6 py-5">
                    <Markdown>{contentMarkdown}</Markdown>
                  </CardContent>
                </Card>
              </section>
            ) : (
              <TranscriptViewer markdown={data.markdown} />
            )}
          </motion.article>

          {/* Sidebar: metadata + thumbnail */}
          <motion.aside
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.18 }}
            className="space-y-4 lg:sticky lg:top-24 self-start"
          >
            {t.thumbnailUrl && (
              <Card className="overflow-hidden p-0" elevated>
                <img
                  src={t.thumbnailUrl}
                  alt=""
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
              </Card>
            )}

            <Card elevated>
              <CardContent className="pt-5 pb-5 space-y-4">
                <LibraryFolderControl
                  folders={foldersData?.folders ?? []}
                  folderId={t.folderId}
                  organizing={organizing}
                  onMove={moveToFolder}
                  onCreate={createFolder}
                  t={translate}
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
              <LinkedNotesCard
                notes={linkedNotesData?.notes ?? []}
                loading={linkedNotesLoading}
                title={linkedNoteTitle}
                content={linkedNoteContent}
                creating={creatingLinkedNote}
                locale={locale}
                onTitleChange={setLinkedNoteTitle}
                onContentChange={setLinkedNoteContent}
                onCreate={() => void createLinkedNote(t)}
                t={translate}
              />
            )}

            <Card elevated>
              <CardContent className="pt-5 pb-5 space-y-3">
                {canUseContextualActions && (
                  <Button
                    variant="primary"
                    size="default"
                    className="w-full"
                    disabled={startingChat}
                    onClick={() => void startContextualChat(t)}
                  >
                    {startingChat ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5" />
                    )}
                    {startingChat
                      ? translate('library.chatStarting')
                      : translate('library.chatAbout')}
                  </Button>
                )}
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
              <Button variant="outline" size="default" className="w-full" asChild>
                <a href={t.url} target="_blank" rel="noreferrer">
                  {t.source === 'WEB'
                    ? translate('library.openPage')
                    : translate('library.openVideo')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
          </motion.aside>
        </div>
      </div>
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
    </AnimatedPage>
  );
}

function LinkedNotesCard({
  notes,
  loading,
  title,
  content,
  creating,
  locale,
  onTitleChange,
  onContentChange,
  onCreate,
  t,
}: {
  notes: LinkedNote[];
  loading: boolean;
  title: string;
  content: string;
  creating: boolean;
  locale: Locale;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onCreate: () => void;
  t: TranslateFn;
}): React.ReactElement {
  return (
    <Card elevated>
      <CardContent className="pt-5 pb-5 space-y-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-app-muted)]">
          <NotebookPen className="h-3.5 w-3.5 text-emerald-400" />
          {t('library.linkedNotes')}
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t('library.linkedNoteTitle')}
            className="h-9 w-full rounded-lg border border-[var(--color-app-border)] bg-zinc-100/[0.03] px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
            disabled={creating}
            maxLength={200}
          />
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder={t('library.linkedNoteContent')}
            className="min-h-24 w-full resize-y rounded-lg border border-[var(--color-app-border)] bg-zinc-100/[0.03] px-3 py-2 text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
            disabled={creating}
            maxLength={200_000}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={creating || title.trim().length === 0}
            onClick={onCreate}
          >
            {creating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('library.linkedNoteCreating')}
              </>
            ) : (
              t('library.linkedNoteCreate')
            )}
          </Button>
        </div>

        <div className="space-y-2">
          {loading && (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          )}
          {!loading && notes.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--color-app-border)] px-3 py-4 text-center text-xs text-[var(--color-app-muted)]">
              {t('library.linkedNotesEmpty')}
            </p>
          )}
          {!loading &&
            notes.map((note) => {
              const preview =
                note.content.trim().replace(/\s+/g, ' ').slice(0, 140) || t('notes.emptyContent');
              return (
                <div
                  key={note.id}
                  className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/45 px-3 py-2.5"
                >
                  <p className="truncate text-sm font-medium text-zinc-100">{note.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {preview}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] uppercase tracking-wider text-[var(--color-app-muted)]/80">
                      {formatDateTime(new Date(note.updatedAt), locale)}
                    </span>
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                      <Link to={`/notas/${note.id}`}>{t('library.openNote')}</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
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
          className="min-w-0 flex-1 h-9 rounded-lg border border-[var(--color-app-border)] bg-zinc-100/[0.03] px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15"
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

function stripMarkdownFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length).trimStart() : markdown;
}

function SummaryBlock({
  summary,
  generating,
  onGenerate,
  t,
}: {
  summary: string | null;
  generating: boolean;
  onGenerate: () => void;
  t: TranslateFn;
}): React.ReactElement {
  if (!summary) {
    return (
      <Card elevated>
        <CardContent className="py-8 px-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
              <Wand2 className="h-4 w-4 text-violet-300" />
            </div>
            <div className="flex-1 space-y-1">
              <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-100">
                {t('library.summary')}
              </h2>
              <p className="text-sm text-[var(--color-app-muted)]">
                {t('library.summaryDescription')}
              </p>
            </div>
            <Button onClick={onGenerate} disabled={generating} variant="primary" size="sm">
              {generating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('library.generating')}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('library.generateSummary')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
            <Wand2 className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-100">
            {t('library.summary')}
          </h2>
        </div>
        <Button onClick={onGenerate} disabled={generating} variant="ghost" size="sm">
          {generating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('library.regenerating')}
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              {t('library.regenerateSummary')}
            </>
          )}
        </Button>
      </div>
      <Card elevated>
        <CardContent className="px-6 py-5">
          <Markdown>{summary}</Markdown>
        </CardContent>
      </Card>
    </section>
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
              ? 'text-[13px] font-mono text-zinc-200 truncate mt-0.5 tabular-nums'
              : 'text-sm text-zinc-200 mt-0.5'
          }
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
