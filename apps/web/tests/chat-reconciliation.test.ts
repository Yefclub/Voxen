import { describe, expect, test } from 'bun:test';
import {
  claimPendingId,
  reconcileChatStart,
  sameActiveTurn,
} from '../src/client/lib/chat-reconciliation';

describe('chat reconciliation', () => {
  test('reconcilia IDs otimistas uma vez e preserva referências no replay do start', () => {
    const current = [
      { id: 'local-user', createdAt: 'local', content: 'pergunta' },
      { id: 'local-assistant', createdAt: 'local', content: '' },
    ];
    const start = {
      userMessageId: 'db-user',
      assistantMessageId: 'db-assistant',
      startedAt: '2026-07-28T03:00:00.000Z',
    };

    const reconciled = reconcileChatStart(current, 'local-user', 'local-assistant', start);
    const replayed = reconcileChatStart(reconciled, 'db-user', 'db-assistant', start);

    expect(reconciled.map((message) => message.id)).toEqual(['db-user', 'db-assistant']);
    expect(reconciled.every((message) => message.createdAt === start.startedAt)).toBe(true);
    expect(replayed).toBe(reconciled);
    expect(replayed[0]).toBe(reconciled[0]);
  });

  test('ignora apenas heartbeat de um turno semanticamente igual', () => {
    const current = {
      id: 'turn-1',
      status: 'RUNNING',
      assistantMessageId: 'assistant-1',
      updatedAt: 'before',
    };
    expect(sameActiveTurn(current, { ...current, updatedAt: 'after' })).toBe(true);
    expect(sameActiveTurn(current, { ...current, status: 'PENDING' })).toBe(false);
    expect(sameActiveTurn(current, null)).toBe(false);
  });

  test('aceita uma única confirmação concorrente para o mesmo ID', () => {
    const pending = new Set<string>();

    expect(claimPendingId(pending, 'approval-1')).toBe(true);
    expect(claimPendingId(pending, 'approval-1')).toBe(false);
    expect(claimPendingId(pending, 'approval-2')).toBe(true);
  });
});
