import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from './api';

export type AssistantProposal = {
  id: string;
  revision: number;
  name: string;
  status: string;
  input: { title?: string; content?: string; url?: string };
};
export type AssistantMessage = {
  id: string;
  position: number;
  role: string;
  text: string;
  details: {
    proposals?: AssistantProposal[];
    references?: Array<{ id: string; title: string; href: string; source: string }>;
    actions?: Array<{
      name: string;
      result: { title?: string; href?: string; jobId?: string; id?: string; kind?: string };
    }>;
    error?: string;
    stopped?: boolean;
    model?: string;
    costUsd?: string | null;
  };
  createdAt: string;
};
type Conversation = {
  revision: number;
  eventCursor: number;
  hasMore: boolean;
  messages: AssistantMessage[];
  activeRun: { id: string; status: string; model: string | null; revision: number } | null;
};
export function useAssistant() {
  const [state, setState] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const current = useRef(state);
  current.current = state;
  const mounted = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const key = ++request.current;
    try {
      const value = await apiGet<Conversation>('/api/chat');
      if (!mounted.current || request.current !== key) return;
      const old = current.current;
      if (
        old &&
        (value.revision < old.revision ||
          (value.revision === old.revision && value.eventCursor < old.eventCursor))
      )
        return;
      // Keep already loaded older pages while refreshing the live tail.
      const earlier =
        old?.revision === value.revision && value.messages[0]
          ? old.messages.filter((item) => item.position < value.messages[0]!.position)
          : [];
      const next = {
        ...value,
        hasMore: earlier.length ? old!.hasMore : value.hasMore,
        messages: [...earlier, ...value.messages],
      };
      current.current = next;
      setState(next);
      setError(null);
      if (!value.activeRun) setActivity(null);
    } catch (failure) {
      if (mounted.current && request.current === key)
        setError(failure instanceof Error ? failure.message : 'ASSISTANT_UNAVAILABLE');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [refresh]);
  const revision = state?.revision;
  useEffect(() => {
    if (revision === undefined) return;
    let alive = true;
    const stream = new EventSource(
      `/api/chat/events?revision=${revision}&after=${current.current?.eventCursor ?? 0}`,
    );
    stream.onopen = () => {
      if (alive) setConnected(true);
    };
    stream.onerror = () => {
      if (alive) setConnected(false);
    };
    stream.addEventListener('reset', () => {
      stream.close();
      if (alive) void refresh();
    });
    stream.addEventListener('progress', (event) => {
      if (!alive) return;
      const message = event as MessageEvent<string>;
      const payload = JSON.parse(message.data) as {
        revision: number;
        kind: string;
        data: { text?: string; messageId?: string; name?: string };
      };
      const old = current.current;
      if (!old || payload.revision !== old.revision) return;
      const eventCursor = Number(message.lastEventId);
      if (eventCursor <= old.eventCursor) return;
      if (
        payload.kind === 'text' &&
        payload.data.messageId &&
        old.messages.some((item) => item.id === payload.data.messageId)
      ) {
        const next = {
          ...old,
          eventCursor,
          messages: old.messages.map((item) =>
            item.id === payload.data.messageId
              ? { ...item, text: payload.data.text ?? item.text }
              : item,
          ),
        };
        current.current = next;
        setState(next);
      } else {
        if (payload.kind === 'tool') setActivity(payload.data.name ?? null);
        void refresh();
      }
    });
    const fallback = setInterval(() => {
      if (current.current?.activeRun || !stream.readyState) void refresh();
    }, 4000);
    return () => {
      alive = false;
      stream.close();
      clearInterval(fallback);
    };
  }, [revision, refresh]);

  const send = useCallback(
    async (text: string, requestKey: string) => {
      const snapshot = current.current;
      if (!snapshot) throw new Error('ASSISTANT_UNAVAILABLE');
      await apiPost('/api/chat/messages', { text, requestKey, revision: snapshot.revision });
      await refresh();
    },
    [refresh],
  );
  const rewind = useCallback(
    async (messageId: string, text?: string) => {
      const snapshot = current.current;
      if (!snapshot) return;
      await apiPost('/api/chat/rewind', {
        messageId,
        revision: snapshot.revision,
        ...(text !== undefined && { text, requestKey: crypto.randomUUID() }),
      });
      await refresh();
    },
    [refresh],
  );
  const stop = useCallback(async () => {
    if (current.current?.activeRun)
      await apiPost(`/api/chat/runs/${current.current.activeRun.id}/stop`, {});
    await refresh();
  }, [refresh]);
  const loadOlder = useCallback(async () => {
    const old = current.current;
    if (!old?.hasMore || !old.messages[0]) return;
    const page = await apiGet<Conversation>(`/api/chat?before=${old.messages[0].position}`);
    const now = current.current;
    if (!mounted.current || !now || page.revision !== now.revision) return;
    const ids = new Set(now.messages.map((item) => item.id));
    const next = {
      ...now,
      hasMore: page.hasMore,
      messages: [...page.messages.filter((item) => !ids.has(item.id)), ...now.messages],
    };
    current.current = next;
    setState(next);
  }, []);
  const decide = useCallback(
    async (id: string, confirm: boolean) => {
      if (!current.current) return;
      await apiPost(`/api/chat/proposals/${id}/decision`, {
        revision: current.current.revision,
        confirm,
      });
      await refresh();
    },
    [refresh],
  );
  return { state, error, activity, connected, refresh, send, rewind, stop, loadOlder, decide };
}
