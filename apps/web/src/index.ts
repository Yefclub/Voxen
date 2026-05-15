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

app.get('/', (c) =>
  c.text('Voxen — em desenvolvimento. Veja .specs/000-setup-inicial.md.'),
);

const port = Number(process.env.PORT ?? 3000);

// Bun.serve nativo (preferido em produção pelo perf)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Bun = (globalThis as any).Bun;
if (Bun) {
  Bun.serve({ port, fetch: app.fetch });
  console.log(`[web] listening on :${port}`);
}

export default app;
