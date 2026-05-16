// ============================================================================
// Voxen Web — entrypoint
// ============================================================================
// Bun + Hono. Front Vite serve static, API em /api/*.
// Implementação completa virá em PRs subsequentes conforme .specs/.
// MVP atual: apenas /health pra CI funcionar.
// ============================================================================

import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'web' }));

app.get('/', (c) => c.text('Voxen — em desenvolvimento. Veja .specs/000-setup-inicial.md.'));

const port = Number(process.env.PORT ?? 3000);

// Bun.serve nativo quando rodando no Bun runtime; cai em no-op em outros.
if (typeof Bun !== 'undefined') {
  Bun.serve({ port, fetch: app.fetch });
  console.warn(`[web] listening on :${port}`);
}

export default app;
