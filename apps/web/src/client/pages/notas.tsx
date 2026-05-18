// ============================================================================
// /notas — KB manual em árvore (notas + pastas)
// ============================================================================
// Editor markdown simples (textarea + preview com Markdown component).
// Tree à esquerda, editor à direita. CRUD via REST.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderPlus,
  Library,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Markdown } from '../components/ui/markdown';
import { Spinner } from '../components/ui/spinner';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { ApiError, apiPost } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { cn } from '../lib/utils';
import { AnimatedPage } from '../components/motion/animated-page';

interface NoteListItem {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface NoteFull {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResp {
  notes: NoteListItem[];
}
interface GetResp {
  note: NoteFull;
}

export function NotasPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: tree, loading, refresh } = useFetch<ListResp>('/api/notes');
  const [previewMode, setPreviewMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<NoteListItem | null>(null);
  const [creating, setCreating] = useState(false);

  const notes = tree?.notes ?? [];

  // Tree: indexa por parentId pra render em árvore
  const rootNotes = useMemo(() => notes.filter((n) => n.parentId === null), [notes]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, NoteListItem[]>();
    for (const n of notes) {
      if (n.parentId) {
        const arr = m.get(n.parentId) ?? [];
        arr.push(n);
        m.set(n.parentId, arr);
      }
    }
    return m;
  }, [notes]);

  async function createNew(kind: 'NOTE' | 'FOLDER'): Promise<void> {
    setCreating(true);
    try {
      const res = await apiPost<{ note: NoteListItem }>('/api/notes', {
        kind,
        title: kind === 'FOLDER' ? 'Nova pasta' : 'Sem título',
        content: '',
      });
      await refresh();
      if (kind === 'NOTE') navigate(`/notas/${res.note.id}`);
      toast.success(kind === 'FOLDER' ? 'Pasta criada.' : 'Nota criada.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao criar.');
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`/api/notes/${confirmDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Falha ao apagar.');
      if (id === confirmDelete.id) navigate('/notas', { replace: true });
      await refresh();
      toast.success('Apagado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.');
    }
  }

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-7xl space-y-8">
        {/* Header padrão alinhado com /transcricoes, /jobs, /dashboard */}
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Library className="h-3.5 w-3.5 text-violet-400" />
            Base manual
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Notas</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Sua base de conhecimento escrita à mão. Organize em pastas, escreva em markdown e a Vox
            também pode criar/editar via chat com confirmação.
          </p>
        </header>

        <div className="grid grid-cols-[280px_1fr] gap-5 min-h-[calc(100vh-280px)]">
          {/* Tree sidebar — em Card pra ficar consistente */}
          <Card elevated className="overflow-hidden p-0 flex flex-col self-start sticky top-6">
            <div className="p-3 border-b border-[var(--color-app-border)] flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void createNew('NOTE')}
                disabled={creating}
                className="flex-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova nota
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void createNew('FOLDER')}
                disabled={creating}
                aria-label="Nova pasta"
                title="Nova pasta"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="overflow-y-auto p-2 space-y-0.5 max-h-[70vh]">
              {loading && (
                <div className="px-3 py-6 text-center text-xs text-[var(--color-app-muted)]">
                  Carregando…
                </div>
              )}
              {!loading && notes.length === 0 && (
                <div className="px-3 py-8 text-center space-y-2">
                  <FileText className="mx-auto h-5 w-5 text-[var(--color-app-muted)]" />
                  <p className="text-xs text-[var(--color-app-muted)] leading-relaxed">
                    Sem notas ainda.
                    <br />
                    Crie uma acima.
                  </p>
                </div>
              )}
              {rootNotes.map((n) => (
                <TreeNode
                  key={n.id}
                  node={n}
                  childrenByParent={childrenByParent}
                  activeId={id}
                  onDelete={(node) => setConfirmDelete(node)}
                  level={0}
                />
              ))}
            </div>
          </Card>

          {/* Editor area — Card pra parity com tree */}
          {id ? (
            <NoteEditor
              key={id}
              noteId={id}
              previewMode={previewMode}
              onTogglePreview={() => setPreviewMode((v) => !v)}
              onSaved={() => void refresh()}
              onDeleted={() => {
                navigate('/notas', { replace: true });
                void refresh();
              }}
            />
          ) : (
            <Card elevated className="flex items-center justify-center min-h-[400px]">
              <CardContent className="py-20 text-center space-y-4 max-w-md">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
                  <FileText className="h-6 w-6 text-violet-400" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-display text-xl font-semibold tracking-tight">
                    {notes.length === 0 ? 'Comece sua base manual' : 'Selecione uma nota'}
                  </p>
                  <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
                    {notes.length === 0
                      ? 'Crie sua primeira nota ou pasta na coluna ao lado. Você também pode pedir pra Vox criar via chat (com confirmação antes).'
                      : 'Clique numa nota da árvore pra abrir o editor.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={confirmDelete?.kind === 'FOLDER' ? 'Apagar pasta?' : 'Apagar nota?'}
        description={
          confirmDelete?.kind === 'FOLDER'
            ? 'Tudo dentro dela será apagado também. Ação irreversível.'
            : 'A nota e seu conteúdo serão apagados. Ação irreversível.'
        }
        confirmLabel="Apagar"
        variant="destructive"
        onConfirm={onDelete}
      />
    </AnimatedPage>
  );
}

function TreeNode({
  node,
  childrenByParent,
  activeId,
  onDelete,
  level,
}: {
  node: NoteListItem;
  childrenByParent: Map<string, NoteListItem[]>;
  activeId?: string;
  onDelete: (n: NoteListItem) => void;
  level: number;
}): React.ReactElement {
  const children = childrenByParent.get(node.id) ?? [];
  const [expanded, setExpanded] = useState(true);
  const isActive = activeId === node.id;
  const navigate = useNavigate();

  if (node.kind === 'FOLDER') {
    return (
      <div>
        <div
          className={cn(
            'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] cursor-pointer',
            'hover:bg-[var(--color-app-surface)]',
          )}
          style={{ paddingLeft: 8 + level * 14 }}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 text-[var(--color-app-muted)] transition-transform shrink-0',
              expanded && 'rotate-90',
            )}
          />
          <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="flex-1 truncate text-zinc-200">{node.title}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--color-app-muted)] hover:text-rose-400"
            aria-label="Apagar"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {expanded &&
          children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              childrenByParent={childrenByParent}
              activeId={activeId}
              onDelete={onDelete}
              level={level + 1}
            />
          ))}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] cursor-pointer transition-colors',
        isActive
          ? 'bg-[var(--color-app-surface-hover)] border border-[var(--color-app-border-strong)]'
          : 'hover:bg-[var(--color-app-surface)] border border-transparent',
      )}
      style={{ paddingLeft: 8 + level * 14 }}
      onClick={() => navigate(`/notas/${node.id}`)}
    >
      <FileText className="h-3.5 w-3.5 text-violet-400 shrink-0 ml-3.5" />
      <span className="flex-1 truncate text-zinc-100">{node.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--color-app-muted)] hover:text-rose-400"
        aria-label="Apagar"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function NoteEditor({
  noteId,
  previewMode,
  onTogglePreview,
  onSaved,
  onDeleted: _onDeleted,
}: {
  noteId: string;
  previewMode: boolean;
  onTogglePreview: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}): React.ReactElement {
  const { data, loading } = useFetch<GetResp>(`/api/notes/${noteId}`);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset estado quando troca de nota
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

  // Autosave debounced 1.5s
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
      <Card elevated className="overflow-hidden p-0 flex flex-col min-h-[calc(100vh-280px)]">
        {/* Header — toolbar do editor */}
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
          <span className="text-[11px] uppercase tracking-wider text-[var(--color-app-muted)] tabular-nums">
            {saving ? (
              <span className="inline-flex items-center gap-1.5">
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

        {/* Body */}
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
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              placeholder="Comece a escrever em markdown…"
              className="w-full min-h-[55vh] bg-transparent text-[14.5px] leading-relaxed text-zinc-100 placeholder:text-[var(--color-app-muted)] font-mono focus:outline-none resize-none"
              spellCheck
            />
          )}
        </div>
      </Card>
    </motion.div>
  );
}
