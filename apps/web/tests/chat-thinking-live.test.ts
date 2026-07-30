import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chatSource = readFileSync(join(import.meta.dir, '../src/client/pages/chat.tsx'), 'utf8');
const runtimeSource = readFileSync(join(import.meta.dir, '../src/lib/chat/runtime.ts'), 'utf8');
const routeSource = readFileSync(join(import.meta.dir, '../src/routes/chat.ts'), 'utf8');
const turnRuntimeSource = readFileSync(
  join(import.meta.dir, '../src/lib/chat/turn-runtime.ts'),
  'utf8',
);

/**
 * Source contract for ThinkingBlock expand policy (spec 078 follow-up).
 * Gaps between tool results must not collapse the block while the turn is live.
 */
describe('ThinkingBlock live expand policy', () => {
  test('treats live turn as in-flight even when no segment is running', () => {
    expect(chatSource).toContain(
      'const { inFlight, duration } = resolveThinkingTiming(segments, live, startedAt, elapsed)',
    );
    expect(chatSource).not.toContain('const inFlight = live || running');
  });

  test('auto-expand / auto-collapse keys off inFlight, not bare running', () => {
    expect(chatSource).toContain('if (!inFlight)');
    expect(chatSource).toContain('setExpanded(false)');
    expect(chatSource).toContain('setExpanded(true)');
    expect(chatSource).toContain('}, [inFlight]');
    // Must not re-introduce the flicker: effect deps on running alone.
    expect(chatSource).not.toContain('}, [running]');
  });

  test('header shimmer and click disable use inFlight', () => {
    expect(chatSource).toContain('disabled={inFlight}');
    expect(chatSource).toContain('onClick={() => !inFlight && setExpanded((v) => !v)}');
    expect(chatSource).toContain('{inFlight ? (');
    expect(chatSource).toContain('resolveThinkingTiming(segments, live, startedAt, elapsed)');
  });

  test('cronômetro parte do início conhecido do turno e nunca recalcula histórico com Date.now', () => {
    expect(chatSource).toContain('startedAt: number');
    expect(chatSource).toContain('useRef<number>(startedAt)');
    expect(chatSource).not.toContain('live ? Date.now() : null');
    expect(chatSource).not.toContain('setFrozen(Date.now()');
    expect(chatSource).not.toContain('const [frozen');
  });

  test('timeline apresenta estado operacional sem expor chain-of-thought bruto', () => {
    expect(chatSource).not.toContain('{segment.text}');
    expect(chatSource).toContain("t('chat.reasoningInProgress')");
    expect(chatSource).toContain("t('chat.reasoningCompleted')");
  });

  test('prepara contexto concorrente e mede tempo até o primeiro evento do modelo', () => {
    expect(routeSource).toContain("code: 'preparing-response'");
    expect(routeSource.indexOf("code: 'preparing-response'")).toBeLessThan(
      routeSource.indexOf('runChatTurn(turn.id, emit'),
    );
    expect(runtimeSource).not.toContain("label: 'Preparando sua resposta…'");
    expect(runtimeSource).toContain('const relevantPromise = preloadRelevantContent');
    expect(runtimeSource.indexOf('const relevantPromise')).toBeLessThan(
      runtimeSource.indexOf('const compaction = await maybeCompact'),
    );
    expect(runtimeSource).toContain("code: 'connecting-model'");
    expect(chatSource).toContain('chatStatusI18nKey(event.code)');
    expect(runtimeSource).toContain("event: 'chat-provider-request-start'");
    expect(runtimeSource).toContain("event: 'chat-turn-latency'");
    expect(runtimeSource).toContain('isProviderObservedEvent(type)');
    expect(turnRuntimeSource).toContain('requestStartedAt: timing?.requestStartedAt');
    expect(runtimeSource).toContain('requestToClaimMs');
    expect(runtimeSource).toContain('claimAndLoadMs');
    expect(runtimeSource).toContain('totalToProviderStartMs');
    expect(runtimeSource).toContain('providerFirstEventMs');
    expect(runtimeSource).toContain('totalToFirstEventMs');
  });
});
