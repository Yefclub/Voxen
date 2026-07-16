import { describe, expect, test } from 'bun:test';
import { mergeChatMessagePages } from '../src/client/lib/chat-pagination';

describe('chat pagination', () => {
  test('merges pages in chronological order without duplicates', () => {
    const current = [
      { id: 'm3', createdAt: '2026-07-16T10:03:00.000Z', content: '3' },
      { id: 'm4', createdAt: '2026-07-16T10:04:00.000Z', content: 'old' },
    ];
    const previous = [
      { id: 'm1', createdAt: '2026-07-16T10:01:00.000Z', content: '1' },
      { id: 'm2', createdAt: '2026-07-16T10:02:00.000Z', content: '2' },
      { id: 'm4', createdAt: '2026-07-16T10:04:00.000Z', content: 'updated' },
    ];

    expect(mergeChatMessagePages(current, previous)).toEqual([
      { id: 'm1', createdAt: '2026-07-16T10:01:00.000Z', content: '1' },
      { id: 'm2', createdAt: '2026-07-16T10:02:00.000Z', content: '2' },
      { id: 'm3', createdAt: '2026-07-16T10:03:00.000Z', content: '3' },
      { id: 'm4', createdAt: '2026-07-16T10:04:00.000Z', content: 'updated' },
    ]);
  });
});
