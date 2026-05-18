// ============================================================================
// useNotes — hook compartilhado entre Sidebar (modo /notas) e página /notas
// ============================================================================
// Tanto a sidebar quanto o editor precisam da árvore de notas. Centralizamos:
//  - Fetch da lista
//  - Mutações (create, delete)
//  - Cache local pra não re-fetch ao navegar
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiPost } from './api';

export interface NoteListItem {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface State {
  notes: NoteListItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (kind: 'NOTE' | 'FOLDER', parentId?: string | null) => Promise<NoteListItem | null>;
  remove: (id: string) => Promise<boolean>;
}

// Singleton store pra share state entre sidebar e página
let cache: NoteListItem[] | null = null;
const listeners = new Set<(n: NoteListItem[]) => void>();

function setNotes(next: NoteListItem[]): void {
  cache = next;
  listeners.forEach((l) => l(next));
}

async function fetchNotes(): Promise<NoteListItem[]> {
  const res = await fetch('/api/notes', { credentials: 'include' });
  if (!res.ok) return [];
  const data = (await res.json()) as { notes: NoteListItem[] };
  return data.notes ?? [];
}

export function useNotes(): State {
  const [notes, setLocal] = useState<NoteListItem[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    const sub = (n: NoteListItem[]): void => setLocal(n);
    listeners.add(sub);
    if (cache === null) {
      void fetchNotes().then((n) => {
        setNotes(n);
        setLoading(false);
      });
    }
    return () => {
      listeners.delete(sub);
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    const n = await fetchNotes();
    setNotes(n);
    setLoading(false);
  }, []);

  const create = useCallback(
    async (
      kind: 'NOTE' | 'FOLDER',
      parentId: string | null = null,
    ): Promise<NoteListItem | null> => {
      try {
        const r = await apiPost<{ note: NoteListItem }>('/api/notes', {
          kind,
          parentId,
          title: kind === 'FOLDER' ? 'Nova pasta' : 'Sem título',
          content: '',
        });
        await refresh();
        toast.success(kind === 'FOLDER' ? 'Pasta criada.' : 'Nota criada.');
        return r.note;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Erro ao criar.');
        return null;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/notes/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Falha ao apagar.');
        await refresh();
        toast.success('Apagado.');
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro.');
        return false;
      }
    },
    [refresh],
  );

  return { notes, loading, refresh, create, remove };
}
