import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('contrato HITL resume + always-allow (spec 132)', () => {
  test('approve retorna SSE de resume e aceita alwaysAllow', () => {
    const route = read('src/routes/chat.ts');
    expect(route).toContain('createHitlResumeTurn');
    expect(route).toContain('alwaysAllow');
    expect(route).toContain('streamTurnResponse(turn');
    expect(route).toContain('shouldResume');
  });

  test('runtime honra always-allow em toolApproval e execute cria nota', () => {
    const runtime = read('src/lib/chat/runtime.ts');
    expect(runtime).toContain('resolveProposeCreateNoteApproval');
    expect(runtime).toContain('loadAlwaysAllowActions');
    expect(runtime).toContain("handledBy: 'always_allow'");
    expect(runtime).toContain('grantAlwaysAllowAction');
    expect(runtime).toContain('buildHitlResumePrompt');
    expect(runtime).toContain('shouldInjectTurnContentAsUserMessage');
    expect(runtime).toContain('modelMessages');
  });

  test('UI expõe Confirmar e Sempre permitir e consome stream do approve', () => {
    const chat = read('src/client/pages/chat.tsx');
    const confirmBar = read('src/client/components/chat/hitl-confirm-bar.tsx');
    expect(confirmBar).toContain('chat.hitlAlwaysAllow');
    expect(confirmBar).toContain('alwaysAllow: true');
    expect(chat).toContain("fetch('/api/chat/approve'");
    expect(chat).toContain("accept: 'text/event-stream'");
  });

  test('i18n tem chave always allow em pt e en', () => {
    const i18n = read('src/client/lib/i18n.tsx');
    expect(i18n).toContain("'chat.hitlAlwaysAllow': 'Sempre permitir'");
    expect(i18n).toContain("'chat.hitlAlwaysAllow': 'Always allow'");
  });
});
