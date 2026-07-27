import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTemporalBounds } from '../src/lib/chat/temporal-bounds';

const runtimeSource = readFileSync(join(import.meta.dir, '../src/lib/chat/runtime.ts'), 'utf8');

describe('parseTemporalBounds', () => {
  test('accepts empty bounds (recent listing)', () => {
    expect(parseTemporalBounds()).toEqual({ ok: true });
  });

  test('parses valid ISO since/until', () => {
    const result = parseTemporalBounds('2026-07-07T00:00:00.000Z', '2026-07-14T00:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.since?.toISOString()).toBe('2026-07-07T00:00:00.000Z');
    expect(result.until?.toISOString()).toBe('2026-07-14T00:00:00.000Z');
  });

  test('rejects invalid since', () => {
    const result = parseTemporalBounds('not-a-date');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('since');
  });

  test('rejects until before since', () => {
    const result = parseTemporalBounds('2026-07-14T00:00:00.000Z', '2026-07-07T00:00:00.000Z');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('until');
  });
});

describe('agent temporal listing tools (spec 093)', () => {
  test('buildTools registers list_transcripts and list_notes', () => {
    expect(runtimeSource).toContain('list_transcripts: tool({');
    expect(runtimeSource).toContain('list_notes: tool({');
    expect(runtimeSource).toContain('parseTemporalBounds(since, until)');
    expect(runtimeSource).toContain("status: 'ACTIVE'");
    expect(runtimeSource).toContain("kind: 'NOTE'");
  });

  test('AGENT_INSTRUCTIONS prefer temporal list tools for weekly intake', () => {
    expect(runtimeSource).toContain('list_transcripts / list_notes com');
    expect(runtimeSource).toContain('since/until em ISO-8601 UTC');
    expect(runtimeSource).toContain('<instance_clock>');
    expect(runtimeSource).toContain('NÃO diga que só busca por termo');
  });
});
