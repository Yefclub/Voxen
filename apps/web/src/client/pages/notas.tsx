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
  const [previewMode, setPreviewMode] = useState(false);
  const { notes, refresh } = useNotes();

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Library className="h-3.5 w-3.5 text-violet-400" />
            Base manual
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Notas</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Sua base de conhecimento escrita à mão. Use a árvore na lateral pra navegar entre notas
            e pastas. A Vox também pode criar/editar via chat com confirmação.
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
                  {notes.length === 0 ? 'Comece sua base manual' : 'Selecione uma nota'}
                </p>
                <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
                  {notes.length === 0
                    ? 'Crie sua primeira nota ou pasta na sidebar. Você também pode pedir pra Vox criar via chat (com confirmação antes).'
                    : 'Clique numa nota da árvore na sidebar pra abrir o editor.'}
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
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data?.note) {
      setTitle(data.note.title);
      setContent(data.note.content);
      setDirty(false);
    }
  }, [data?.note]);

  const save = useCallback(async (): Promise<void> => {
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error('Falha ao salvar.');
      setDirty(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.');
    } finally {
      setSaving(false);
    }
  }, [noteId, title, content, dirty, onSaved]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, save]);

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
            placeholder="Sem título"
            className="flex-1 bg-transparent text-xl font-display font-semibold tracking-tight text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none"
          />
          <span className="text-[11px] uppercase tracking-wider tabular-nums">
            {saving ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--color-app-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Salvando
              </span>
            ) : dirty ? (
              <span className="text-amber-300">Pendente</span>
            ) : (
              <span className="text-emerald-300">Salvo</span>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={onTogglePreview}>
            {previewMode ? (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                Editar
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                Preview
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
            Salvar
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {previewMode ? (
            <div className="prose-voxen">
              {content.trim() ? (
                <Markdown>{content}</Markdown>
              ) : (
                <p className="text-[var(--color-app-muted)] italic">Sem conteúdo ainda.</p>
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
                placeholder="Comece a escrever em markdown…"
              />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
