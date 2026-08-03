// ============================================================================
// Contrato de preparação do turno e telemetria (spec 119)
// ============================================================================
// Este caso foi resgatado de `chat-thinking-live.test.ts`, deletado na spec
// 126 por ser um arquivo de testes-por-grep sem poder de matar mutação. A
// deleção estava certa para os outros 5 casos (todos com substituto
// comportamental em `chat-segments.test.ts`, ou obsoletos porque a 126
// reverte a premissa de esconder o raciocínio).
//
// Este aqui era a exceção: guarda invariantes da spec 119 que NÃO têm relação
// com a 126 — a ordem de preparação de contexto e os campos de telemetria de
// latência. Varredura no repo confirmou que nada mais os cobre
// (`src/shared/chat-status.test.ts` cobre só o mapeamento de código de
// status, não a ordenação nem as métricas). Deixá-los cair junto seria perder
// um tripwire de escopo alheio dentro de um PR de fix.
//
// Segue sendo asserção sobre texto-fonte, com as fragilidades do gênero: não
// mata mutação e quebra em refactor inocente. É consciente — a alternativa
// (teste comportamental de `runtime.ts`) exige harness que o projeto não tem.
// Se esse harness aparecer, esta é a primeira coisa a migrar.
// ============================================================================

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

describe('preparação do turno e telemetria (spec 119)', () => {
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
