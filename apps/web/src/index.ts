// ============================================================================
// Voxen Web — entrypoint
// ============================================================================
// Bun + Hono. API em /api/*; estática em /* (Vite build, futuro).
// ============================================================================

import { Hono } from 'hono';
import { auth } from './lib/auth';

const app = new Hono();

// Healthcheck — sempre 200, mesmo antes do setup (spec 000)
app.get('/health', (c) => c.json({ ok: true, service: 'web' }));

// Better Auth: aceita TODOS os métodos em /api/auth/*
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// /api/me — devolve session corrente (null se não autenticado)
app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ user: null });
  }
  return c.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      // status/role serão expostos quando aprovação for implementada (PR seguinte)
    },
  });
});

// Landing placeholder
app.get('/', (c) => c.text('Voxen — em desenvolvimento. Veja .specs/000-setup-inicial.md.'));

const port = Number(process.env.PORT ?? 3000);

if (typeof Bun !== 'undefined') {
  Bun.serve({ port, fetch: app.fetch });
  console.warn(`[web] listening on :${port}`);
}

export default app;
