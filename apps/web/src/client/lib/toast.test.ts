import { describe, expect, mock, test } from 'bun:test';
import { TOAST_DURATION_MS, ToastFifoQueue, type ToastQueueEmission } from './toast';

function harness(): {
  queue: ToastFifoQueue;
  emissions: ToastQueueEmission[];
} {
  const emissions: ToastQueueEmission[] = [];
  return {
    emissions,
    queue: new ToastFifoQueue((emission) => {
      emissions.push(emission);
    }),
  };
}

describe('fila FIFO de toasts', () => {
  test('emite um toast por vez e preserva a ordem de chegada', () => {
    const { queue, emissions } = harness();

    queue.enqueue('default', 'primeiro');
    queue.enqueue('success', 'segundo');
    queue.enqueue('error', 'terceiro');

    expect(emissions.map((item) => item.message)).toEqual(['primeiro']);

    emissions[0]!.options.onAutoClose?.({ id: emissions[0]!.id } as never);
    expect(emissions.map((item) => item.message)).toEqual(['primeiro', 'segundo']);

    emissions[1]!.options.onDismiss?.({ id: emissions[1]!.id } as never);
    expect(emissions.map((item) => item.message)).toEqual(['primeiro', 'segundo', 'terceiro']);
  });

  test('cada toast recebe cinco segundos somente quando se torna ativo', () => {
    const { queue, emissions } = harness();

    queue.enqueue('default', 'primeiro', { duration: 50 });
    queue.enqueue('default', 'segundo', { duration: Infinity });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.options.duration).toBe(TOAST_DURATION_MS);

    emissions[0]!.options.onAutoClose?.({ id: emissions[0]!.id } as never);
    expect(emissions[1]!.options.duration).toBe(TOAST_DURATION_MS);
  });

  test('dispensa manualmente e avança uma única vez sem encurtar o próximo toast', () => {
    const { queue, emissions } = harness();
    const onDismiss = mock(() => undefined);

    queue.enqueue('default', 'primeiro', { onDismiss });
    queue.enqueue('default', 'segundo');

    const current = { id: emissions[0]!.id } as never;
    emissions[0]!.options.onDismiss?.(current);
    emissions[0]!.options.onAutoClose?.(current);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(emissions.map((item) => item.message)).toEqual(['primeiro', 'segundo']);
    expect(emissions[1]!.options.duration).toBe(TOAST_DURATION_MS);
  });

  test('clique em action avança a fila quando a ação permite o descarte', () => {
    const { queue, emissions } = harness();
    const onClick = mock(() => undefined);
    const action = { label: 'Abrir', onClick };

    queue.enqueue('success', 'primeiro', { action });
    queue.enqueue('default', 'segundo');

    const event = { defaultPrevented: false } as React.MouseEvent<HTMLButtonElement>;
    const emittedAction = emissions[0]!.options.action;
    if (!emittedAction || typeof emittedAction !== 'object' || !('onClick' in emittedAction)) {
      throw new Error('action não foi preservada');
    }
    emittedAction.onClick(event);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(emissions.map((item) => item.message)).toEqual(['primeiro', 'segundo']);
  });

  test('id explícito repetido não enfileira a mesma notificação duas vezes', () => {
    const { queue, emissions } = harness();

    queue.enqueue('default', 'primeiro', { id: 'job:1' });
    queue.enqueue('default', 'duplicado', { id: 'job:1' });

    expect(emissions.map((item) => item.message)).toEqual(['primeiro']);
    expect(queue.pendingCount).toBe(0);
  });
});
