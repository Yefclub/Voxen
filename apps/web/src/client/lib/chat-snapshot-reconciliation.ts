import { mergeChatMessagePages } from './chat-pagination';

type SnapshotMessage = { id: string; createdAt: string };

export function shouldFinishSnapshotStreaming(
  hasActiveTurn: boolean,
  localStreamActive: boolean,
): boolean {
  return !hasActiveTurn && !localStreamActive;
}

export function reconcileSnapshotMessages<T extends SnapshotMessage>(
  current: readonly T[],
  incoming: readonly T[],
  options: {
    replace: boolean;
    localStreamActive: boolean;
    streamingMessageId: string | null;
  },
): T[] {
  if (!options.localStreamActive) {
    return options.replace
      ? [...incoming]
      : mergeChatMessagePages(
          current.filter((message) => !message.id.startsWith('local-')),
          incoming,
        );
  }

  // Um snapshot pode ter sido produzido antes dos deltas SSE que já chegaram
  // ao navegador. Enquanto este navegador possui o stream, suas bolhas locais
  // e a versão viva do assistant são a fonte mais recente.
  const protectedMessages = current.filter(
    (message) => message.id.startsWith('local-') || message.id === options.streamingMessageId,
  );
  const base = options.replace
    ? [...incoming]
    : mergeChatMessagePages(
        current.filter(
          (message) =>
            !message.id.startsWith('local-') && message.id !== options.streamingMessageId,
        ),
        incoming,
      );
  return mergeChatMessagePages(base, protectedMessages);
}

export type SnapshotReconciler = {
  reconcile(replace?: boolean): Promise<void>;
};

/**
 * Serializa snapshots e promove um pedido canônico ocorrido durante polling.
 * Eventos repetidos de retomada durante o próprio pedido canônico continuam
 * deduplicados; somente `false -> true` agenda uma segunda consulta.
 */
export function createSnapshotReconciler<T>(
  load: () => Promise<T>,
  apply: (snapshot: T, replace: boolean) => void,
  onError: () => void = () => undefined,
): SnapshotReconciler {
  let inFlight: Promise<void> | null = null;
  let currentReplace = false;
  let pendingReplace = false;

  return {
    reconcile(replace = false): Promise<void> {
      if (inFlight) {
        if (replace && !currentReplace) pendingReplace = true;
        return inFlight;
      }

      currentReplace = replace;
      inFlight = (async () => {
        try {
          while (true) {
            const replaceThisRequest = currentReplace;
            try {
              apply(await load(), replaceThisRequest);
            } catch {
              onError();
            }
            if (!pendingReplace) break;
            pendingReplace = false;
            currentReplace = true;
          }
        } finally {
          inFlight = null;
          currentReplace = false;
          pendingReplace = false;
        }
      })();
      return inFlight;
    },
  };
}
