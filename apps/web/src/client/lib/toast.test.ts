import { describe, expect, mock, test } from 'bun:test';
import {
  TOAST_DURATION_MS,
  createToastFifoQueueForTests,
  isToastStale,
  type ToastFifoQueue,
  type ToastQueueEmission,
} from './toast';

function harness(opts: { now?: () => number; dismiss?: (id: string | number) => void } = {}): {
  queue: ToastFifoQueue;
  emissions: ToastQueueEmission[];
  dismiss: ReturnType<typeof mock>;
} {
  const emissions: ToastQueueEmission[] = [];
  const dismiss = mock(opts.dismiss ?? (() => undefined));
  return {
    emissions,
    dismiss,
    queue: createToastFifoQueueForTests(
      (emission) => {
        emissions.push(emission);
      },
      { dismiss, now: opts.now },
    ),
  };
}

describe('isToastStale', () => {
  test('marca stale quando a idade de parede excede a duração', () => {
    expect(isToastStale(0, TOAST_DURATION_MS - 1)).toBe(false);
    expect(isToastStale(0, TOAST_DURATION_MS)).toBe(true);
    expect(isToastStale(1000, 1000 + TOAST_DURATION_MS + 1)).toBe(true);
  });
});

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

  test('toast pendente ainda emite após o ativo completar mesmo se a fila esperou >5s', () => {
    let now = 1_000;
    const { queue, emissions } = harness({ now: () => now });

    queue.enqueue('default', 'A');
    queue.enqueue('success', 'B');
    expect(emissions.map((e) => e.message)).toEqual(['A']);
    expect(queue.pendingCount).toBe(1);

    // A fica na tela os 5s canônicos; B esperou na fila o mesmo intervalo.
    now = 1_000 + TOAST_DURATION_MS;
    emissions[0]!.options.onAutoClose?.({ id: emissions[0]!.id } as never);

    expect(emissions.map((e) => e.message)).toEqual(['A', 'B']);
    expect(emissions[1]!.options.duration).toBe(TOAST_DURATION_MS);
    expect(queue.pendingCount).toBe(0);
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

  test('não enfileira toasts enquanto o documento está hidden', () => {
    const { queue, emissions } = harness();
    queue.setDocumentHidden(true);
    queue.enqueue('success', 'escondido');
    expect(emissions).toHaveLength(0);
    expect(queue.pendingCount).toBe(0);
  });

  test('ao voltar ao visible, descarta ativo e pendentes já stale por relógio de parede', () => {
    let now = 1_000;
    const { queue, emissions, dismiss } = harness({ now: () => now });

    queue.enqueue('default', 'ativo');
    queue.enqueue('default', 'pendente-velho');
    expect(emissions).toHaveLength(1);
    expect(queue.pendingCount).toBe(1);

    // Simula aba hidden com tempo passando além da duração.
    queue.setDocumentHidden(true);
    now = 1_000 + TOAST_DURATION_MS + 50;
    queue.setDocumentHidden(false);

    expect(dismiss).toHaveBeenCalledWith(emissions[0]!.id);
    // Pendente enfileirado há >5s também cai; nada “fresco” de 5s.
    expect(queue.pendingCount).toBe(0);
    expect(queue.hasActive).toBe(false);
    expect(emissions).toHaveLength(1);
  });

  test('ao voltar ao visible, emite pendente ainda fresco depois de fechar o ativo stale', () => {
    let now = 10_000;
    const { queue, emissions, dismiss } = harness({ now: () => now });

    queue.enqueue('default', 'ativo-antigo');
    // Enfileira o segundo enquanto o primeiro ainda está na duração.
    now = 10_500;
    queue.enqueue('success', 'ainda-fresco');
    expect(emissions.map((e) => e.message)).toEqual(['ativo-antigo']);
    expect(queue.pendingCount).toBe(1);

    queue.setDocumentHidden(true);
    // Ativo expirou (ativado em 10_000); pendente enfileirado em 10_500 ainda vive.
    now = 10_000 + TOAST_DURATION_MS + 10;
    queue.setDocumentHidden(false);

    expect(dismiss).toHaveBeenCalled();
    expect(emissions.map((e) => e.message)).toEqual(['ativo-antigo', 'ainda-fresco']);
    expect(emissions[1]!.options.duration).toBe(TOAST_DURATION_MS);
  });
});
