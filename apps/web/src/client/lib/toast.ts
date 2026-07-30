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

interface PendingToast {
  id: ToastId;
  kind: ToastKind;
  message: ToastMessage;
  options: ExternalToast;
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

/**
 * Fila independente do React/Sonner: um item só é emitido quando o anterior
 * termina. Assim, cada toast ganha seus próprios cinco segundos quando chega à
 * frente, em vez de expirar invisível atrás de `visibleToasts`.
 */
export class ToastFifoQueue {
  readonly #pending: PendingToast[] = [];
  readonly #knownIds = new Set<ToastId>();
  #active: PendingToast | null = null;
  #sequence = 0;

  constructor(private readonly emit: ToastQueueEmitter) {}

  get pendingCount(): number {
    return this.#pending.length;
  }

  enqueue(kind: ToastKind, message: ToastMessage, options: ExternalToast = {}): ToastId {
    const id = options.id ?? `voxen-toast-${++this.#sequence}`;
    if (this.#knownIds.has(id)) return id;

    this.#knownIds.add(id);
    this.#pending.push({ id, kind, message, options });
    this.#emitNext();
    return id;
  }

  #emitNext(): void {
    if (this.#active) return;
    const next = this.#pending.shift();
    if (!next) return;
    this.#active = next;

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
        onDismiss: (toast: ToastT) => {
          try {
            onDismiss?.(toast);
          } finally {
            complete();
          }
        },
        onAutoClose: (toast: ToastT) => {
          try {
            onAutoClose?.(toast);
          } finally {
            complete();
          }
        },
      },
    });
  }
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

const queue = new ToastFifoQueue(emitToSonner);

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
