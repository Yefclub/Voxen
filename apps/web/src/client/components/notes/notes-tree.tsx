// ============================================================================
// NotesTree — componente reusável da árvore de notas
// ============================================================================
// Usado tanto na sidebar global (modo /notas) quanto na página /notas (caso
// futuro). Estado vem via useNotes hook. Click navega pra /notas/:id.
// ============================================================================

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Folder, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useNotes, type NoteListItem } from '../../lib/use-notes';
import { useI18n } from '../../lib/i18n';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface Props {
  activeId?: string;
  variant?: 'sidebar' | 'card';
}

export function NotesTree({ activeId, variant = 'card' }: Props): React.ReactElement {
  const { notes, loading, remove } = useNotes();
  const { t } = useI18n();
  const [pendingDelete, setPendingDelete] = useState<NoteListItem | null>(null);
  const navigate = useNavigate();

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

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    const ok = await remove(pendingDelete.id);
    if (ok && activeId === pendingDelete.id) navigate('/notas', { replace: true });
  }

  if (loading && notes.length === 0) {
    return (
      <div
        className={cn(
          'px-3 py-6 text-center text-xs text-[var(--color-app-muted)]',
          variant === 'sidebar' && 'text-[11px]',
        )}
      >
        {t('common.loading')}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="px-3 py-8 text-center space-y-2">
        <FileText className="mx-auto h-5 w-5 text-[var(--color-app-muted)]" />
        <p className="text-xs text-[var(--color-app-muted)] leading-relaxed">
          {t('notes.emptyTree')}
          <br />
          {t('notes.useButtonAbove')}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-0.5">
        {rootNotes.map((n) => (
          <TreeNode
            key={n.id}
            node={n}
            childrenByParent={childrenByParent}
            activeId={activeId}
            onDelete={(node) => setPendingDelete(node)}
            level={0}
            variant={variant}
          />
        ))}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={
          pendingDelete?.kind === 'FOLDER'
            ? t('notes.deleteFolderTitle')
            : t('notes.deleteNoteTitle')
        }
        description={
          pendingDelete?.kind === 'FOLDER'
            ? t('notes.deleteFolderDescription')
            : t('notes.deleteNoteDescription')
        }
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </>
  );
}

function TreeNode({
  node,
  childrenByParent,
  activeId,
  onDelete,
  level,
  variant,
}: {
  node: NoteListItem;
  childrenByParent: Map<string, NoteListItem[]>;
  activeId?: string;
  onDelete: (n: NoteListItem) => void;
  level: number;
  variant: 'sidebar' | 'card';
}): React.ReactElement {
  const { t } = useI18n();
  const children = childrenByParent.get(node.id) ?? [];
  const [expanded, setExpanded] = useState(true);
  const isActive = activeId === node.id;
  const navigate = useNavigate();
  const textSize = variant === 'sidebar' ? 'text-[12.5px]' : 'text-[13px]';

  if (node.kind === 'FOLDER') {
    return (
      <div>
        <div
          className={cn(
            'group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer',
            textSize,
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
            aria-label={t('common.delete')}
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
              variant={variant}
            />
          ))}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
        textSize,
        isActive
          ? 'bg-[var(--color-app-surface-hover)] border border-[var(--color-app-border-strong)]'
          : 'hover:bg-[var(--color-app-surface)] border border-transparent',
      )}
      style={{ paddingLeft: 8 + level * 14 }}
      onClick={() => navigate(`/notas/${node.id}`)}
    >
      <FileText
        className={cn(
          'h-3.5 w-3.5 shrink-0 ml-3.5',
          isActive ? 'text-violet-300' : 'text-violet-400',
        )}
      />
      <span className="flex-1 truncate text-zinc-100">{node.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--color-app-muted)] hover:text-rose-400"
        aria-label={t('common.delete')}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
