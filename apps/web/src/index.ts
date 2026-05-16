// ============================================================================
// Voxen Web — entrypoint
// ============================================================================
// Bun + Hono. API em /api/*; estática em /* (Vite build, futuro).
// ============================================================================

import { Hono } from 'hono';
import { auth } from './lib/auth';
import { db } from './lib/db';
import { adminRoutes } from './routes/admin';

const app = new Hono();

// Healthcheck — sempre 200, mesmo antes do setup (spec 000)
app.get('/health', (c) => c.json({ ok: true, service: 'web' }));

// Better Auth: aceita TODOS os métodos em /api/auth/*
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// /api/me — devolve session corrente com status+role (null se não autenticado)
app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ user: null });
  }
  // Busca status/role do DB diretamente (additionalFields do better-auth
  // nem sempre disponíveis no contexto da session).
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, status: true, role: true },
  });
  return c.json({ user });
});

// Admin endpoints (protegidos por middleware no próprio router)
app.route('/api/admin', adminRoutes);

// Landing placeholder
app.get('/', (c) => c.text('Voxen — em desenvolvimento. Veja .specs/000-setup-inicial.md.'));

const port = Number(process.env.PORT ?? 3000);

if (typeof Bun !== 'undefined') {
  Bun.serve({ port, fetch: app.fetch });
  console.warn(`[web] listening on :${port}`);
}

export default app;
