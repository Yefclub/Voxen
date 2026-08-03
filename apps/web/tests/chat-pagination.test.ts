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

  test('preserva array e objetos quando o snapshot é semanticamente igual', () => {
    const current = [
      {
        id: 'm1',
        createdAt: '2026-07-16T10:01:00.000Z',
        content: 'estável',
        tools: [{ id: 't1', state: 'completed' }],
      },
    ];
    const incoming = structuredClone(current);

    const merged = mergeChatMessagePages(current, incoming);

    expect(merged).toBe(current);
    expect(merged[0]).toBe(current[0]);
  });

  test('ignora diferenças apenas na ordem das propriedades JSON', () => {
    const current = [
      {
        id: 'm1',
        createdAt: '2026-07-16T10:01:00.000Z',
        tool: { state: 'completed', output: { title: 'Nota', ok: true } },
      },
    ];
    const incoming = [
      {
        tool: { output: { ok: true, title: 'Nota' }, state: 'completed' },
        createdAt: '2026-07-16T10:01:00.000Z',
        id: 'm1',
      },
    ];

    expect(mergeChatMessagePages(current, incoming)).toBe(current);
  });

  test('substitui apenas a mensagem que realmente mudou', () => {
    const first = { id: 'm1', createdAt: '2026-07-16T10:01:00.000Z', content: 'igual' };
    const second = { id: 'm2', createdAt: '2026-07-16T10:02:00.000Z', content: 'antes' };
    const current = [first, second];
    const incoming = [{ ...first }, { ...second, content: 'depois' }];

    const merged = mergeChatMessagePages(current, incoming);

    expect(merged).not.toBe(current);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(incoming[1]);
  });
});
