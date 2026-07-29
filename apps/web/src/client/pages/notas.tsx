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
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  Library,
  Loader2,
  Plus,
  Save,
} from '@/components/ui/icons';
import { toast } from 'sonner';
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

interface NoteFull {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface GetResp {
  note: NoteFull;
}

export function NotasPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [previewMode, setPreviewMode] = useState(false);
  const { notes, loading: notesLoading, refresh, create } = useNotes();

  return (
    <PageShell width="workspace">
      <PageHeader
        eyebrow={
          <>
            <Library className="h-3.5 w-3.5 text-violet-400" />
            {t('notes.manualBase')}
          </>
        }
        title={t('notes.title')}
        description={t('notes.description')}
      />

      {id ? (
        <NoteEditor
          key={id}
          noteId={id}
          previewMode={previewMode}
          onTogglePreview={() => setPreviewMode((v) => !v)}
          onSaved={() => void refresh()}
        />
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
  previewMode,
  onTogglePreview,
  onSaved,
}: {
  noteId: string;
  previewMode: boolean;
  onTogglePreview: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { data, loading, error, refresh } = useFetch<GetResp>(`/api/notes/${noteId}`);
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AbortController do PATCH em voo: garante que dois saves concorrentes
  // (debounce + onBlur, ou save manual) não compitam — o anterior é abortado e
  // o último vence de forma determinística.
  const inFlight = useRef<AbortController | null>(null);
  // `dirty` muda a cada tecla; sem uma ref o `save` debounced fecharia sobre um
  // valor stale. Mantém o estado mais recente acessível sem recriar o callback.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    // Só re-hidrata do servidor quando NÃO há edição pendente — senão um refetch
    // sobrescreveria texto não salvo do usuário.
    if (data?.note && !dirtyRef.current) {
      setTitle(data.note.title);
      setContent(data.note.content);
      setDirty(false);
    }
  }, [data?.note]);

  const save = useCallback(async (): Promise<void> => {
    // Cancela qualquer save agendado pelo debounce — o blur/save manual assume.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!dirtyRef.current) return;
    // Aborta o PATCH anterior (se houver) pra o último request vencer.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(t('notes.saveError'));
      // Só limpa o dirty se este ainda é o save mais recente — senão um save
      // posterior (com edições novas) já assumiu e não devemos marcá-lo salvo.
      if (inFlight.current === controller) setDirty(false);
      onSaved();
    } catch (err) {
      // Abort = substituído por save mais recente; silencioso.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setSaving(false);
      }
    }
  }, [noteId, title, content, onSaved, t]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, save]);

  // Cleanup no unmount: cancela timer e aborta PATCH em voo.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      inFlight.current?.abort();
    };
  }, []);

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
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--color-app-border)]">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            onBlur={() => void save()}
            placeholder={t('notes.untitled')}
            className="flex-1 bg-transparent text-xl font-display font-semibold tracking-tight text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:outline-none"
          />
          <span className="text-[11px] uppercase tracking-wider tabular-nums">
            {saving ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--color-app-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('common.saving')}
              </span>
            ) : dirty ? (
              <span className="text-amber-300">{t('notes.pending')}</span>
            ) : (
              <span className="text-emerald-300">{t('common.saved')}</span>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={onTogglePreview}>
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
            size="sm"
            variant="outline"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            <Save className="h-3.5 w-3.5" />
            {t('common.save')}
          </Button>
        </div>

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
                  setDirty(true);
                }}
                placeholder={t('notes.editorPlaceholder')}
              />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
