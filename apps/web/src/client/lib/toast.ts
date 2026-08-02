import { toast as sonnerToast, type Action, type ExternalToast, type ToastT } from 'sonner';

export const TOAST_DURATION_MS = 5_000;

type ToastMessage = Parameters<typeof sonnerToast>[0];
type ToastId = string | number;
type ToastKind = 'default' | 'success' | 'info' | 'warning' | 'error' | 'message';

export interface ToastQueueEmission {
  id: ToastId;
  kind: ToastKind;
  message: ToastMessage;
  options: ExternalToast;
}

type ToastQueueEmitter = (emission: ToastQueueEmission) => void;
type ToastDismissFn = (id: ToastId) => void;

interface PendingToast {
  id: ToastId;
  kind: ToastKind;
  message: ToastMessage;
  options: ExternalToast;
  /** Wall-clock enqueue time (ms). Used to drop stale backlog on visibility restore. */
  enqueuedAt: number;
  /** Wall-clock time when this toast became the active emission. */
  activatedAt: number | null;
}

/**
 * Pure helper: a toast is stale when its wall-clock age has already exceeded the
 * intended on-screen duration (background tabs freeze Sonner timers).
 */
export function isToastStale(
  startedAt: number,
  now: number,
  durationMs: number = TOAST_DURATION_MS,
): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || !Number.isFinite(durationMs)) {
    return false;
  }
  if (durationMs <= 0) return true;
  return now - startedAt >= durationMs;
}

/**
 * Fila independente do React/Sonner: um item só é emitido quando o anterior
 * termina. Assim, cada toast ganha seus próprios cinco segundos quando chega à
 * frente, em vez de expirar invisível atrás de `visibleToasts`.
 *
 * Com aba em background, os timers do browser congelam — `reconcileVisibility`
 * descarta itens cujo tempo de parede já expirou para não despejar uma fila
 * “fresca” de 5s ao voltar.
 */
export class ToastFifoQueue {
  readonly #pending: PendingToast[] = [];
  readonly #knownIds = new Set<ToastId>();
  #active: PendingToast | null = null;
  #sequence = 0;
  #documentHidden = false;

  constructor(
    private readonly emit: ToastQueueEmitter,
    private readonly dismiss: ToastDismissFn = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get pendingCount(): number {
    return this.#pending.length;
  }

  get hasActive(): boolean {
    return this.#active !== null;
  }

  /** Atualiza se o documento está hidden e reconcilia idade de parede. */
  setDocumentHidden(hidden: boolean): void {
    const wasHidden = this.#documentHidden;
    this.#documentHidden = hidden;
    if (wasHidden && !hidden) {
      this.reconcileVisibility(this.now());
    }
  }

  /**
   * Descarta toasts cujo tempo de parede já passou e fecha o ativo se estiver
   * velho — sem reapresentá-lo por mais 5s.
   */
  reconcileVisibility(now: number = this.now()): void {
    // Drop stale pending (never shown, or waiting too long).
    const kept: PendingToast[] = [];
    for (const item of this.#pending) {
      if (isToastStale(item.enqueuedAt, now)) {
        this.#knownIds.delete(item.id);
        continue;
      }
      kept.push(item);
    }
    this.#pending.length = 0;
    this.#pending.push(...kept);

    const active = this.#active;
    if (active?.activatedAt != null && isToastStale(active.activatedAt, now)) {
      this.#completeActive(active.id, { dismissUi: true });
    }
  }

  enqueue(kind: ToastKind, message: ToastMessage, options: ExternalToast = {}): ToastId {
    const id = options.id ?? `voxen-toast-${++this.#sequence}`;
    if (this.#knownIds.has(id)) return id;

    // Com documento hidden, não acumular fila in-app (notificações de sistema
    // cobrem jobs; outros eventos devem re-emitir se ainda forem relevantes).
    if (this.#documentHidden) {
      return id;
    }

    this.#knownIds.add(id);
    this.#pending.push({
      id,
      kind,
      message,
      options,
      enqueuedAt: this.now(),
      activatedAt: null,
    });
    this.#emitNext();
    return id;
  }

  #completeActive(id: ToastId, opts: { dismissUi: boolean }): void {
    const active = this.#active;
    if (!active || active.id !== id) return;
    if (opts.dismissUi) {
      try {
        this.dismiss(id);
      } catch {
        // Sonner pode não estar montado em testes.
      }
    }
    this.#knownIds.delete(id);
    this.#active = null;
    this.#emitNext();
  }

  #emitNext(): void {
    if (this.#active) return;
    if (this.#documentHidden) return;

    // Do NOT drop pending by enqueuedAt here. While visible, each toast gets its
    // own full duration starting at activatedAt; a second toast waiting behind
    // the first is still fresh when it reaches the front. Stale-by-enqueue age
    // only applies on visibility restore (reconcileVisibility).
    const next = this.#pending.shift();
    if (!next) return;
    this.#active = next;
    next.activatedAt = this.now();

    let completed = false;
    const complete = (): void => {
      if (completed || this.#active?.id !== next.id) return;
      completed = true;
      this.#knownIds.delete(next.id);
      this.#active = null;
      this.#emitNext();
    };

    const originalAction = next.options.action;
    const action = isAction(originalAction)
      ? {
          ...originalAction,
          onClick: (event: React.MouseEvent<HTMLButtonElement>): void => {
            originalAction.onClick(event);
            if (!event.defaultPrevented) complete();
          },
        }
      : originalAction;
    const originalCancel = next.options.cancel;
    const cancel = isAction(originalCancel)
      ? {
          ...originalCancel,
          onClick: (event: React.MouseEvent<HTMLButtonElement>): void => {
            originalCancel.onClick(event);
            complete();
          },
        }
      : originalCancel;
    const onDismiss = next.options.onDismiss;
    const onAutoClose = next.options.onAutoClose;

    this.emit({
      id: next.id,
      kind: next.kind,
      message: next.message,
      options: {
        ...next.options,
        id: next.id,
        duration: TOAST_DURATION_MS,
        action,
        cancel,
        onDismiss: (toastItem: ToastT) => {
          try {
            onDismiss?.(toastItem);
          } finally {
            complete();
          }
        },
        onAutoClose: (toastItem: ToastT) => {
          try {
            onAutoClose?.(toastItem);
          } finally {
            complete();
          }
        },
      },
    });
  }
}

function isAction(value: ExternalToast['action']): value is Action {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'label' in value &&
    'onClick' in value &&
    typeof value.onClick === 'function',
  );
}

function emitToSonner({ kind, message, options }: ToastQueueEmission): void {
  switch (kind) {
    case 'success':
      sonnerToast.success(message, options);
      return;
    case 'info':
      sonnerToast.info(message, options);
      return;
    case 'warning':
      sonnerToast.warning(message, options);
      return;
    case 'error':
      sonnerToast.error(message, options);
      return;
    case 'message':
      sonnerToast.message(message, options);
      return;
    default:
      sonnerToast(message, options);
  }
}

const queue = new ToastFifoQueue(emitToSonner, (id) => {
  sonnerToast.dismiss(id);
});

/** Liga a fila global ao Page Visibility (chamado uma vez no shell). */
export function bindToastVisibility(doc: {
  hidden: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
} = typeof document !== 'undefined' ? document : { hidden: false, addEventListener() {}, removeEventListener() {} }): () => void {
  const sync = (): void => {
    queue.setDocumentHidden(Boolean(doc.hidden));
  };
  sync();
  doc.addEventListener('visibilitychange', sync);
  return () => doc.removeEventListener('visibilitychange', sync);
}

// Bind once in browser.
if (typeof document !== 'undefined') {
  bindToastVisibility(document);
}

interface ToastApi {
  (message: ToastMessage, options?: ExternalToast): ToastId;
  success: (message: ToastMessage, options?: ExternalToast) => ToastId;
  info: (message: ToastMessage, options?: ExternalToast) => ToastId;
  warning: (message: ToastMessage, options?: ExternalToast) => ToastId;
  error: (message: ToastMessage, options?: ExternalToast) => ToastId;
  message: (message: ToastMessage, options?: ExternalToast) => ToastId;
}

const defaultToast = (message: ToastMessage, options?: ExternalToast): ToastId =>
  queue.enqueue('default', message, options);

export const toast: ToastApi = Object.assign(defaultToast, {
  success: (message: ToastMessage, options?: ExternalToast) =>
    queue.enqueue('success', message, options),
  info: (message: ToastMessage, options?: ExternalToast) => queue.enqueue('info', message, options),
  warning: (message: ToastMessage, options?: ExternalToast) =>
    queue.enqueue('warning', message, options),
  error: (message: ToastMessage, options?: ExternalToast) =>
    queue.enqueue('error', message, options),
  message: (message: ToastMessage, options?: ExternalToast) =>
    queue.enqueue('message', message, options),
});

/** Exposed for unit tests that need a queue with injectable clock/dismiss. */
export function createToastFifoQueueForTests(
  emit: ToastQueueEmitter,
  opts: { dismiss?: ToastDismissFn; now?: () => number } = {},
): ToastFifoQueue {
  return new ToastFifoQueue(emit, opts.dismiss, opts.now);
}
