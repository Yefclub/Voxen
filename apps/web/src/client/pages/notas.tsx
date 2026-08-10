// ============================================================================
// /notas — KB manual (editor; tree fica na sidebar global contextual)
// ============================================================================
// Tree foi movida pra Sidebar (modo `notas`) — mesmo padrão de /chat.
// Esta página renderiza apenas o editor da nota selecionada ou empty state.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Clock,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  Save,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { FetchError } from '../components/ui/fetch-error';
import { Markdown } from '../components/ui/markdown';
import { MarkdownEditor } from '../components/notes/markdown-editor';
import { NotesTree } from '../components/notes/notes-tree';
import { Spinner } from '../components/ui/spinner';
import { useFetch } from '../lib/hooks';
import { useNotes } from '../lib/use-notes';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { useI18n } from '../lib/i18n';
import { NoteHistoryDialog } from '../components/notes/note-history-dialog';

interface NoteFull {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  content: string;
  revision: number;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

interface GetResp {
  note: NoteFull;
}

interface RevisionConflict {
  currentRevision: number;
  currentChecksum: string;
}

export function NotasPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { notes, loading: notesLoading, refresh, create } = useNotes();
  const revalidationStarted = useRef(false);
  const focusRefreshInFlight = useRef(false);
  const enteredWithInitialLoad = useRef(notesLoading);

  useEffect(() => {
    // A primeira carga já é iniciada por useNotes. Esperamos que ela termine
    // antes de instalar a revalidação desta página, evitando duas requests
    // concorrentes sem cache e o estado vazio intermediário.
    if (notesLoading || revalidationStarted.current) return;
    revalidationStarted.current = true;
    // Sem cache, a própria carga inicial já trouxe a versão mais recente. Não
    // fazemos uma segunda leitura sequencial ao terminar essa primeira entrada.
    if (enteredWithInitialLoad.current) return;
    // A lista pode ter mudado pelo chat, MCP ou uma automação enquanto esta
    // tela estava desmontada. Revalida ao entrar sem depender de reload manual.
    void refresh();
  }, [notesLoading, refresh]);

  useEffect(() => {
    // Este efeito não compartilha a guarda da primeira revalidação: no
    // StrictMode o React executa setup → cleanup → setup e precisa reinstalar
    // os listeners depois da primeira limpeza.
    const revalidateWhenVisible = (): void => {
      if (document.visibilityState !== 'visible' || focusRefreshInFlight.current) return;
      // Ao retornar à aba, navegadores disparam visibilitychange e focus na
      // mesma interação. Uma única consulta basta para os dois eventos.
      focusRefreshInFlight.current = true;
      void refresh().finally(() => {
        focusRefreshInFlight.current = false;
      });
    };
    window.addEventListener('focus', revalidateWhenVisible);
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () => {
      window.removeEventListener('focus', revalidateWhenVisible);
      document.removeEventListener('visibilitychange', revalidateWhenVisible);
    };
  }, [refresh]);

  return (
    <PageShell width="workspace">
      <PageHeader
        eyebrow={t('notes.manualBase')}
        icon={Library}
        iconClassName="text-violet-400"
        title={t('notes.title')}
        description={t('notes.description')}
      />

      {id ? (
        <NoteEditor key={id} noteId={id} onSaved={() => void refresh()} />
      ) : (
        <NotesLibrary notesCount={notes.length} loading={notesLoading} onCreate={create} />
      )}
    </PageShell>
  );
}

function NotesLibrary({
  notesCount,
  loading,
  onCreate,
}: {
  notesCount: number;
  loading: boolean;
  onCreate: (kind: 'NOTE' | 'FOLDER', parentId?: string | null) => Promise<{ id: string } | null>;
}): React.ReactElement {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [creating, setCreating] = useState<'NOTE' | 'FOLDER' | null>(null);

  async function createItem(kind: 'NOTE' | 'FOLDER'): Promise<void> {
    if (creating) return;
    setCreating(kind);
    try {
      const item = await onCreate(kind);
      if (item && kind === 'NOTE') navigate(`/notas/${item.id}`);
    } finally {
      setCreating(null);
    }
  }

  return (
    <Card elevated className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col gap-4 border-b border-[var(--color-app-border)] bg-[var(--color-app-surface)]/35 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold tracking-tight">
              {t('notes.libraryTitle')}
            </p>
            <p className="mt-1 text-sm text-[var(--color-app-muted)]">
              {notesCount === 0 ? t('notes.emptyDescription') : t('notes.libraryDescription')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={creating !== null}
              onClick={() => void createItem('FOLDER')}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {creating === 'FOLDER' ? t('common.loading') : t('notes.createFolder')}
            </Button>
            <Button size="sm" disabled={creating !== null} onClick={() => void createItem('NOTE')}>
              <Plus className="h-3.5 w-3.5" />
              {creating === 'NOTE' ? t('common.loading') : t('notes.createNote')}
            </Button>
          </div>
        </div>
        <div className="min-h-72 p-3 sm:p-5">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center">
              <Spinner size={20} />
            </div>
          ) : notesCount === 0 ? (
            <div className="flex min-h-64 max-w-md flex-col items-center justify-center gap-3 text-center mx-auto">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-app-border-strong)] bg-violet-500/10">
                <FileText className="h-5 w-5 text-violet-400" />
              </div>
              <p className="text-sm text-[var(--color-app-muted)]">{t('notes.useButtonAbove')}</p>
            </div>
          ) : (
            <NotesTree variant="card" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NoteEditor({
  noteId,
  onSaved,
}: {
  noteId: string;
  onSaved: () => void;
}): React.ReactElement {
  const { data, loading, error, refresh } = useFetch<GetResp>(`/api/notes/${noteId}`);
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(1);
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // O componente recebe key=noteId: toda nota recém-aberta começa em Preview.
  const [previewMode, setPreviewMode] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queuedSave = useRef(false);
  const editSequence = useRef(0);
  const revisionRef = useRef(1);
  const draftRef = useRef({ title: '', content: '' });
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  draftRef.current = { title, content };

  useEffect(() => {
    // Só re-hidrata do servidor quando NÃO há edição pendente — senão um refetch
    // sobrescreveria texto não salvo do usuário.
    if (data?.note && !dirtyRef.current) {
      setTitle(data.note.title);
      setContent(data.note.content);
      setRevision(data.note.revision);
      revisionRef.current = data.note.revision;
      setConflict(null);
      setDirty(false);
    }
  }, [data?.note]);

  const save = useCallback(async (): Promise<void> => {
    // Cancela qualquer save agendado pelo debounce — o blur/save manual assume.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!dirtyRef.current || conflict) return;
    if (inFlight.current) {
      queuedSave.current = true;
      return;
    }
    inFlight.current = true;
    queuedSave.current = false;
    const savedSequence = editSequence.current;
    const draft = draftRef.current;
    const expectedRevision = revisionRef.current;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision,
          title: draft.title,
          content: draft.content,
        }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as Partial<RevisionConflict>;
        setConflict({
          currentRevision: body.currentRevision ?? expectedRevision + 1,
          currentChecksum: body.currentChecksum ?? '',
        });
        toast.error(t('notes.conflictError'));
        return;
      }
      if (!res.ok) throw new Error(t('notes.saveError'));
      const body = (await res.json()) as { note: NoteFull };
      revisionRef.current = body.note.revision;
      setRevision(body.note.revision);
      if (editSequence.current === savedSequence) {
        dirtyRef.current = false;
        setDirty(false);
      } else {
        queuedSave.current = true;
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      inFlight.current = false;
      setSaving(false);
      if (queuedSave.current && !conflict) {
        queuedSave.current = false;
        saveTimer.current = setTimeout(() => void saveRef.current(), 100);
      }
    }
  }, [conflict, noteId, onSaved, t]);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, save]);

  // Cleanup no unmount: cancela o debounce. A request já enviada pode terminar
  // no servidor e continua protegida por expectedRevision.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const markEdited = useCallback((): void => {
    editSequence.current += 1;
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const reloadAfterConflict = useCallback(async (): Promise<void> => {
    dirtyRef.current = false;
    setDirty(false);
    setConflict(null);
    await refresh();
  }, [refresh]);

  if (!loading && error) {
    return (
      <Card elevated className="flex items-center justify-center min-h-[400px]">
        <FetchError message={error} onRetry={refresh} />
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card elevated className="flex items-center justify-center min-h-[400px]">
        <CardContent>
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      key={noteId}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card elevated className="overflow-hidden p-0 min-h-[calc(100dvh-280px)] flex flex-col">
        <div
          data-note-editor-toolbar
          className="flex min-w-0 flex-col gap-3 border-b border-[var(--color-app-border)] px-4 py-3 sm:flex-row sm:items-center sm:px-6 sm:py-4"
        >
          {previewMode ? (
            <h2 className="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight text-[var(--color-app-fg)]">
              {title || t('notes.untitled')}
            </h2>
          ) : (
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                markEdited();
              }}
              onBlur={() => void save()}
              placeholder={t('notes.untitled')}
              className="w-full min-w-0 flex-1 bg-transparent font-display text-xl font-semibold tracking-tight text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:outline-none"
            />
          )}
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:shrink-0">
            <span className="mr-auto shrink-0 text-[11px] uppercase tracking-wider tabular-nums sm:mr-1">
              {conflict ? (
                <span className="text-rose-300">{t('notes.conflict')}</span>
              ) : saving ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--color-app-muted)]">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t('common.saving')}
                </span>
              ) : dirty ? (
                <span className="text-amber-300">{t('notes.pending')}</span>
              ) : (
                <span className="text-emerald-300">{t('common.saved')}</span>
              )}
            </span>
            <span className="shrink-0 rounded-md border border-[var(--color-app-border)] px-2 py-1 text-[10px] font-medium tabular-nums text-[var(--color-app-muted)]">
              {t('notes.revisionLabel', { revision })}
            </span>
            <Button
              className="shrink-0"
              size="sm"
              variant="ghost"
              onClick={() => setHistoryOpen(true)}
            >
              <Clock className="h-3.5 w-3.5" />
              {t('notes.history')}
            </Button>
            <Button
              className="shrink-0"
              size="sm"
              variant="ghost"
              onClick={() => setPreviewMode((value) => !value)}
            >
              {previewMode ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  {t('notes.edit')}
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  {t('notes.preview')}
                </>
              )}
            </Button>
            <Button
              className="shrink-0"
              size="sm"
              variant="outline"
              onClick={() => void save()}
              disabled={!dirty || saving || conflict !== null}
            >
              <Save className="h-3.5 w-3.5" />
              {t('common.save')}
            </Button>
          </div>
        </div>

        {conflict ? (
          <div
            className="flex flex-col gap-3 border-b border-rose-400/25 bg-rose-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            role="alert"
            data-note-revision-conflict
          >
            <div>
              <p className="text-sm font-medium text-rose-100">{t('notes.conflictTitle')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-app-muted)]">
                {t('notes.conflictDescription', { revision: conflict.currentRevision })}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void reloadAfterConflict()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('notes.loadLatest')}
            </Button>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {previewMode ? (
            <div className="prose-voxen">
              {content.trim() ? (
                <Markdown>{content}</Markdown>
              ) : (
                <p className="text-[var(--color-app-muted)] italic">{t('notes.emptyContent')}</p>
              )}
            </div>
          ) : (
            <div className="min-h-[55dvh] h-full">
              <MarkdownEditor
                value={content}
                onChange={(v) => {
                  setContent(v);
                  markEdited();
                }}
                placeholder={t('notes.editorPlaceholder')}
              />
            </div>
          )}
        </div>
      </Card>

      <NoteHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        noteId={noteId}
        currentRevision={revision}
        dirty={dirty}
        onConflict={setConflict}
        onRestored={(restored) => {
          setTitle(restored.title);
          setContent(restored.content);
          setRevision(restored.revision);
          revisionRef.current = restored.revision;
          dirtyRef.current = false;
          setDirty(false);
          onSaved();
        }}
      />
    </motion.div>
  );
}
