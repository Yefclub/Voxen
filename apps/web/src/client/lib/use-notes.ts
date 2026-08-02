// ============================================================================
// useNotes — hook compartilhado entre Sidebar (modo /notas) e página /notas
// ============================================================================
// Tanto a sidebar quanto o editor precisam da árvore de notas. Centralizamos:
//  - Fetch da lista
//  - Mutações (create, delete)
//  - Cache local pra não re-fetch ao navegar
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from './toast';
import { ApiError, apiPost } from './api';
import { useI18n } from './i18n';

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
interface NotesLoadResult {
  notes: NoteListItem[];
  accessRevoked: boolean;
}

function setNotes(next: NoteListItem[]): void {
  cache = next;
  listeners.forEach((l) => l(next));
}

async function fetchNotes(): Promise<NotesLoadResult | null> {
  try {
    const res = await fetch('/api/notes', { credentials: 'include' });
    // Acesso revogado não é falha transitória: descarta a árvore privada que
    // ainda exista no cliente. Demais erros preservam a navegação disponível.
    if (!res.ok) {
      return res.status === 401 || res.status === 403 ? { notes: [], accessRevoked: true } : null;
    }
    const data = (await res.json()) as { notes: NoteListItem[] };
    return { notes: data.notes ?? [], accessRevoked: false };
  } catch {
    return null;
  }
}

/** Cria uma revalidação onde só a resposta mais recente pode atualizar estado. */
export function createLatestOnlyRevalidator<T>(
  load: () => Promise<T | null>,
  apply: (value: T) => void,
  applyWhenStale: (value: T) => boolean = () => false,
): () => Promise<boolean> {
  let latestRequestId = 0;
  return async (): Promise<boolean> => {
    const requestId = ++latestRequestId;
    const next = await load();
    // Falha de rede preserva os itens disponíveis; só uma resposta válida troca
    // a árvore compartilhada.
    if (next !== null && (requestId === latestRequestId || applyWhenStale(next))) apply(next);
    return requestId === latestRequestId;
  };
}

const revalidateNotes = createLatestOnlyRevalidator(
  fetchNotes,
  (result) => setNotes(result.notes),
  // Uma negação de acesso sempre vence: nunca mantemos notas privadas em cache
  // só porque outra consulta foi iniciada depois.
  (result) => result.accessRevoked,
);

/** Compartilha uma consulta em voo entre consumidores do mesmo store. */
export function createSharedLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (): Promise<T> => {
    if (inFlight === null) {
      inFlight = load().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

const loadInitialRequest = createSharedLoader(revalidateNotes);

/** Compartilha a primeira consulta entre todos os consumidores, inclusive StrictMode. */
function loadInitialNotes(): Promise<boolean> {
  if (cache !== null) return Promise.resolve(true);
  return loadInitialRequest();
}

export function useNotes(): State {
  const { t } = useI18n();
  const [notes, setLocal] = useState<NoteListItem[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    const sub = (n: NoteListItem[]): void => setLocal(n);
    listeners.add(sub);
    if (cache === null) {
      void loadInitialNotes().finally(() => setLoading(false));
    }
    return () => {
      listeners.delete(sub);
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const isInitialLoad = cache === null;
    // Revalidações posteriores são silenciosas: a árvore e seus controles
    // continuam usáveis enquanto a resposta atual chega.
    if (isInitialLoad) setLoading(true);
    await (isInitialLoad ? loadInitialNotes() : revalidateNotes());
    if (isInitialLoad) setLoading(false);
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
          title: kind === 'FOLDER' ? t('notes.newFolder') : t('notes.untitled'),
          content: '',
        });
        await refresh();
        toast.success(kind === 'FOLDER' ? t('notes.createdFolder') : t('notes.createdNote'));
        return r.note;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t('notes.createError'));
        return null;
      }
    },
    [refresh, t],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/notes/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error(t('notes.deleteError'));
        await refresh();
        toast.success(t('notes.deleted'));
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.error'));
        return false;
      }
    },
    [refresh, t],
  );

  return { notes, loading, refresh, create, remove };
}
