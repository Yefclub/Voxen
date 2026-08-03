import { describe, expect, test } from 'bun:test';
import {
  createSnapshotReconciler,
  reconcileSnapshotMessages,
  shouldFinishSnapshotStreaming,
} from '../src/client/lib/chat-snapshot-reconciliation';

type Message = { id: string; createdAt: string; content: string };
const message = (id: string, content: string, createdAt = '2026-08-02T00:00:00.000Z'): Message => ({
  id,
  content,
  createdAt,
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('reconciliação de snapshots do Chat', () => {
  test('preserva bolhas locais antes do evento start', () => {
    const current = [message('persisted-1', 'antiga'), message('local-user-1', 'pergunta')];
    const result = reconcileSnapshotMessages(current, [message('persisted-1', 'antiga')], {
      replace: true,
      localStreamActive: true,
      streamingMessageId: 'local-assistant-1',
    });

    expect(result.map(({ id }) => id)).toEqual(['local-user-1', 'persisted-1']);
  });

  test('snapshot atrasado não regride deltas SSE do assistant vivo', () => {
    const current = [message('assistant-1', 'texto mais recente')];
    const result = reconcileSnapshotMessages(current, [message('assistant-1', 'texto antigo')], {
      replace: false,
      localStreamActive: true,
      streamingMessageId: 'assistant-1',
    });

    expect(result[0]?.content).toBe('texto mais recente');
  });

  test('snapshot sem activeTurn não encerra um stream que esta aba ainda possui', () => {
    expect(shouldFinishSnapshotStreaming(false, true)).toBe(false);
    expect(shouldFinishSnapshotStreaming(false, false)).toBe(true);
    expect(shouldFinishSnapshotStreaming(true, false)).toBe(false);
  });

  test('poll seguido de resume agenda substituição canônica', async () => {
    const poll = deferred<string>();
    const resume = deferred<string>();
    const loads = [poll.promise, resume.promise];
    const applied: Array<[string, boolean]> = [];
    const reconciler = createSnapshotReconciler(
      () => loads.shift()!,
      (snapshot, replace) => applied.push([snapshot, replace]),
    );

    const first = reconciler.reconcile(false);
    const promoted = reconciler.reconcile(true);
    expect(first).toBe(promoted);
    poll.resolve('poll');
    await Promise.resolve();
    resume.resolve('resume');
    await promoted;

    expect(applied).toEqual([
      ['poll', false],
      ['resume', true],
    ]);
  });

  test('resume repetido durante consulta canônica permanece deduplicado', async () => {
    const request = deferred<string>();
    let loads = 0;
    const reconciler = createSnapshotReconciler(
      () => {
        loads += 1;
        return request.promise;
      },
      () => undefined,
    );

    const first = reconciler.reconcile(true);
    const second = reconciler.reconcile(true);
    request.resolve('snapshot');
    await Promise.all([first, second]);
    expect(loads).toBe(1);
  });
});
