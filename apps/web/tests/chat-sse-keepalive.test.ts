import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat SSE keepalive', () => {
  test('chat.ts define keepalive ≤15s e exporta a constante', () => {
    // Evita importar a rota (puxa hono/auth/db). Spec 065/102: comentário SSE
    // a cada ≤15s + idleTimeout/server.timeout no index.
    const source = readFileSync(join(import.meta.dir, '../src/routes/chat.ts'), 'utf8');
    expect(source).toContain('CHAT_SSE_KEEPALIVE_MS = 15_000');
    expect(source).toContain(': keepalive');
    expect(source).toContain('armKeepalive');
  });

  test('index.ts desabilita idle timeout do Bun em streams longos', () => {
    const source = readFileSync(join(import.meta.dir, '../src/index.ts'), 'utf8');
    expect(source).toContain('idleTimeout: 255');
    expect(source).toContain('server.timeout(req, 0)');
    expect(source).toContain('isLongLivedStreamRequest');
  });
});
