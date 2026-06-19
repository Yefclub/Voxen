// ============================================================================
// /notas — KB manual (editor; tree fica na sidebar global contextual)
// ============================================================================
// Tree foi movida pra Sidebar (modo `notas`) — mesmo padrão de /chat.
// Esta página renderiza apenas o editor da nota selecionada ou empty state.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeOff, FileText, Library, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Markdown } from '../components/ui/markdown';
import { MarkdownEditor } from '../components/notes/markdown-editor';
import { Spinner } from '../components/ui/spinner';
import { useFetch } from '../lib/hooks';
import { useNotes } from '../lib/use-notes';
import { AnimatedPage } from '../components/motion/animated-page';
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
  const { notes, refresh } = useNotes();

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Library className="h-3.5 w-3.5 text-violet-400" />
            {t('notes.manualBase')}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">
            {t('notes.title')}
          </h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            {t('notes.description')}
          </p>
        </header>

        {id ? (
          <NoteEditor
            key={id}
            noteId={id}
            previewMode={previewMode}
            onTogglePreview={() => setPreviewMode((v) => !v)}
            onSaved={() => void refresh()}
          />
        ) : (
          <Card elevated>
            <CardContent className="py-20 text-center space-y-4 max-w-md mx-auto">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
                <FileText className="h-6 w-6 text-violet-400" />
              </div>
              <div className="space-y-1.5">
                <p className="font-display text-xl font-semibold tracking-tight">
                  {notes.length === 0 ? t('notes.emptyTitle') : t('notes.selectTitle')}
                </p>
                <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
                  {notes.length === 0 ? t('notes.emptyDescription') : t('notes.selectDescription')}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AnimatedPage>
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
  const { data, loading } = useFetch<GetResp>(`/api/notes/${noteId}`);
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
      <Card elevated className="overflow-hidden p-0 min-h-[calc(100vh-280px)] flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--color-app-border)]">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            onBlur={() => void save()}
            placeholder={t('notes.untitled')}
            className="flex-1 bg-transparent text-xl font-display font-semibold tracking-tight text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none"
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

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {previewMode ? (
            <div className="prose-voxen">
              {content.trim() ? (
                <Markdown>{content}</Markdown>
              ) : (
                <p className="text-[var(--color-app-muted)] italic">{t('notes.emptyContent')}</p>
              )}
            </div>
          ) : (
            <div className="min-h-[55vh] h-full">
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
