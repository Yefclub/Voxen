// Store singleton de conversas (subscribers pattern, mesmo padrão de useMe).
// Permite que sidebar global e página /chat compartilhem a mesma lista sem
// duplicar fetches.

import { useEffect, useState } from 'react';

export interface ConvSummary {
  id: string;
  title: string;
  thinking: boolean;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

interface State {
  conversations: ConvSummary[];
  loading: boolean;
  loaded: boolean;
}

const state: State = { conversations: [], loading: false, loaded: false };
const subs = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function emit(): void {
  for (const fn of subs) fn();
}

async function fetchOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    state.loading = true;
    emit();
    try {
      const res = await fetch('/api/chat/conversations', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { conversations: ConvSummary[] };
      state.conversations = data.conversations;
      state.loaded = true;
    } catch {
      // mantém o que já havia
    } finally {
      state.loading = false;
      inFlight = null;
      emit();
    }
  })();
  return inFlight;
}

export async function refreshConversations(): Promise<void> {
  await fetchOnce();
}

export async function createConversation(title?: string): Promise<ConvSummary | null> {
  const res = await fetch('/api/chat/conversations', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { conversation: ConvSummary };
  state.conversations = [data.conversation, ...state.conversations];
  emit();
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await fetch(`/api/chat/conversations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) return false;
  state.conversations = state.conversations.filter((c) => c.id !== id);
  emit();
  return true;
}

export function patchLocalConversation(id: string, patch: Partial<ConvSummary>): void {
  state.conversations = state.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c));
  emit();
}

export function useConversations(): {
  conversations: ConvSummary[];
  loading: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (title?: string) => Promise<ConvSummary | null>;
  remove: (id: string) => Promise<boolean>;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = (): void => force((n) => n + 1);
    subs.add(fn);
    if (!state.loaded && !state.loading) void fetchOnce();
    return () => {
      subs.delete(fn);
    };
  }, []);
  return {
    conversations: state.conversations,
    loading: state.loading,
    loaded: state.loaded,
    refresh: refreshConversations,
    create: createConversation,
    remove: deleteConversation,
  };
}
