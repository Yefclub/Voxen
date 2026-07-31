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
    expect(chatSource).toContain('thinkingInFlight(segments, live, answering)');
    expect(chatSource).toContain('const { inFlight, duration } = resolveThinkingTiming(');
    expect(chatSource).not.toContain('const inFlight = live || running');
  });

  // Spec 126: quando a resposta final começa, a timeline se compacta em vez de
  // continuar aberta ocupando a tela até o stream fechar.
  test('compacts as soon as the final answer starts and summarises the tools', () => {
    expect(chatSource).toContain('answering={message.content.length > 0}');
    expect(chatSource).toContain('const toolCount = segmentsToolCount(segments)');
    expect(chatSource).toContain('thinkingSummaryLabel(duration, toolCount, t)');
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
    expect(chatSource).toContain('resolveThinkingTiming(');
  });

  test('cronômetro parte do início conhecido do turno e nunca recalcula histórico com Date.now', () => {
    expect(chatSource).toContain('startedAt: number');
    expect(chatSource).toContain('useRef<number>(startedAt)');
    expect(chatSource).not.toContain('live ? Date.now() : null');
    expect(chatSource).not.toContain('setFrozen(Date.now()');
    expect(chatSource).not.toContain('const [frozen');
  });

  // Spec 126 revisa a decisão da spec 119: o raciocínio emitido pelo provedor
  // volta a ser exibido, dentro do bloco recolhível. O resumo operacional
  // continua como fallback para provedores que só sinalizam a etapa, sem
  // texto — assim nenhum turno mostra bloco vazio.
  test('timeline mostra o raciocínio emitido e cai no resumo operacional quando não há texto', () => {
    expect(chatSource).toContain('segment.text.trim().length > 0');
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
