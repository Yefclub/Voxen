// ============================================================================
// Tests do helper clientIp — resolve IP real atrás do Cloudflare.
// Ordem: CF-Connecting-IP > primeiro de X-Forwarded-For > X-Real-IP > 'unknown'.
// ============================================================================

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { clientIp } from '../src/lib/client-ip';

// App mínimo que ecoa o resultado do helper a partir dos headers recebidos.
const app = new Hono();
app.get('/ip', (c) => c.text(clientIp(c)));

async function resolve(headers: Record<string, string>): Promise<string> {
  const res = await app.request('/ip', { headers });
  return res.text();
}

describe('clientIp', () => {
  it('prefere CF-Connecting-IP quando presente', async () => {
    const ip = await resolve({
      'CF-Connecting-IP': '203.0.113.7',
      'X-Forwarded-For': '198.51.100.1, 10.0.0.1',
      'X-Real-IP': '192.0.2.9',
    });
    expect(ip).toBe('203.0.113.7');
  });

  it('faz trim no CF-Connecting-IP', async () => {
    const ip = await resolve({ 'CF-Connecting-IP': '  203.0.113.7  ' });
    expect(ip).toBe('203.0.113.7');
  });

  it('usa o primeiro IP de X-Forwarded-For sem CF-Connecting-IP', async () => {
    const ip = await resolve({ 'X-Forwarded-For': '198.51.100.1, 10.0.0.1, 10.0.0.2' });
    expect(ip).toBe('198.51.100.1');
  });

  it('faz trim no IP extraído do X-Forwarded-For', async () => {
    const ip = await resolve({ 'X-Forwarded-For': '  198.51.100.1 , 10.0.0.1' });
    expect(ip).toBe('198.51.100.1');
  });

  it('cai para X-Real-IP quando não há CF nem XFF', async () => {
    const ip = await resolve({ 'X-Real-IP': '192.0.2.9' });
    expect(ip).toBe('192.0.2.9');
  });

  it('retorna unknown quando nenhum header de IP está presente', async () => {
    const ip = await resolve({});
    expect(ip).toBe('unknown');
  });

  it('ignora CF-Connecting-IP vazio e usa o próximo disponível', async () => {
    const ip = await resolve({ 'CF-Connecting-IP': '   ', 'X-Forwarded-For': '198.51.100.1' });
    expect(ip).toBe('198.51.100.1');
  });
});
