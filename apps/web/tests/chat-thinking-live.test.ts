import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chatSource = readFileSync(join(import.meta.dir, '../src/client/pages/chat.tsx'), 'utf8');

/**
 * Source contract for ThinkingBlock expand policy (spec 078 follow-up).
 * Gaps between tool results must not collapse the block while the turn is live.
 */
describe('ThinkingBlock live expand policy', () => {
  test('treats live turn as in-flight even when no segment is running', () => {
    expect(chatSource).toContain('const inFlight = live || running');
  });

  test('auto-expand / auto-collapse keys off inFlight, not bare running', () => {
    expect(chatSource).toContain('if (!inFlight)');
    expect(chatSource).toContain('setExpanded(false)');
    expect(chatSource).toContain('setExpanded(true)');
    expect(chatSource).toContain('}, [inFlight, frozen]');
    // Must not re-introduce the flicker: effect deps on running alone.
    expect(chatSource).not.toContain('}, [running, frozen]');
  });

  test('header shimmer and click disable use inFlight', () => {
    expect(chatSource).toContain('disabled={inFlight}');
    expect(chatSource).toContain('onClick={() => !inFlight && setExpanded((v) => !v)}');
    expect(chatSource).toContain('{inFlight ? (');
    expect(chatSource).toContain('inFlight ? elapsed : segmentsReasoningDuration(segments)');
  });
});
