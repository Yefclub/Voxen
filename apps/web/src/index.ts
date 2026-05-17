// ============================================================================
// Voxen Web — entrypoint
// ============================================================================
// Bun + Hono. API em /api/*; estática em /* (Vite build, futuro).
// ============================================================================

import { Hono } from 'hono';
import { auth } from './lib/auth';
import { db } from './lib/db';
import { getSetting, isSetupComplete } from './lib/settings';
import { adminRoutes } from './routes/admin';
import { jobsRoutes } from './routes/jobs';
import { setupRoutes } from './routes/setup';
import { transcriptsRoutes } from './routes/transcripts';
import { onboardingRoutes } from './routes/onboarding';
import { accountRoutes } from './routes/account';
import { costRoutes } from './routes/cost';

const app = new Hono();

// Healthcheck — sempre 200, mesmo antes do setup (spec 000)
app.get('/health', (c) => c.json({ ok: true, service: 'web' }));

// Endpoint público: estado da instância (signups, primeira instalação)
// Login page usa isso pra mostrar/esconder "Criar conta".
app.get('/api/instance', async (c) => {
  const [allowSignupsRaw, onboardingRaw] = await Promise.all([
    getSetting('allow_signups').catch(() => null),
    getSetting('onboarding_done').catch(() => null),
  ]);
  // Sem onboarding feito: não há admin ainda OR admin não terminou setup.
  // Nesse caso o primeiro signup é o do admin → sempre permitido.
  const userCount = await db.user.count();
  const onboardingDone = onboardingRaw === 'true';
  const allowSignups = userCount === 0 || (onboardingDone && allowSignupsRaw !== 'false');
  return c.json({ allowSignups, hasUsers: userCount > 0, onboardingDone });
});

// Better Auth: aceita TODOS os métodos em /api/auth/*.
// Bloqueia sign-up se allow_signups=false (admin desativou).
app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/auth/sign-up')) {
    const userCount = await db.user.count();
    if (userCount > 0) {
      const [allowSignupsRaw, onboardingRaw] = await Promise.all([
        getSetting('allow_signups').catch(() => null),
        getSetting('onboarding_done').catch(() => null),
      ]);
      const onboardingDone = onboardingRaw === 'true';
      const allowSignups = !onboardingDone || allowSignupsRaw !== 'false';
      if (!allowSignups) {
        return c.json({ error: 'Cadastros novos estão desativados nesta instância.' }, 403);
      }
    }
  }
  return auth.handler(c.req.raw);
});

// /api/me — devolve session corrente + flag de setupComplete (sempre exposta)
app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const setupComplete = await isSetupComplete();
  const onboardingRaw = await getSetting('onboarding_done').catch(() => null);
  const onboardingDone = onboardingRaw === 'true';
  if (!session) {
    return c.json({ user: null, setupComplete, onboardingDone });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, image: true, status: true, role: true },
  });
  return c.json({ user, setupComplete, onboardingDone });
});

// Setup endpoints (protegidos por middleware ADMIN no próprio router)
app.route('/api/setup', setupRoutes);

// Admin endpoints (protegidos por middleware no próprio router)
app.route('/api/admin', adminRoutes);

// Jobs endpoints (download + transcrição — spec 002)
app.route('/api/jobs', jobsRoutes);

// Transcripts endpoints (lista + viewer .md do Garage)
app.route('/api/transcripts', transcriptsRoutes);

// Onboarding (admin first-run) + avatar upload
app.route('/api/onboarding', onboardingRoutes);

// Conta do user (perfil + senha)
app.route('/api/account', accountRoutes);

// Painel de custos (admin)
app.route('/api/admin/custos', costRoutes);

// Avatar proxy: serve imagem do Garage de qualquer user autenticado
app.get('/api/avatar/:userId', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.text('', 401);
  const userId = c.req.param('userId');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { image: true },
  });
  if (!user?.image) return c.text('', 404);
  // Tenta as 3 extensões possíveis
  const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { existsSync: ex, readFileSync: rf } = await import('node:fs');
  function readCreds(key: string): string | undefined {
    const path = process.env.GARAGE_CREDS_PATH ?? '/creds/voxen.env';
    if (!ex(path)) return undefined;
    const content = rf(path, 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  }
  const accessKeyId = process.env.GARAGE_ACCESS_KEY ?? readCreds('GARAGE_ACCESS_KEY');
  const secretAccessKey = process.env.GARAGE_SECRET_KEY ?? readCreds('GARAGE_SECRET_KEY');
  if (!accessKeyId || !secretAccessKey) return c.text('', 500);
  const s3 = new S3Client({
    endpoint: process.env.GARAGE_ENDPOINT ?? 'http://garage:3900',
    region: process.env.GARAGE_REGION ?? 'garage',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.GARAGE_BUCKET ?? 'voxen-transcripts',
          Key: `workspaces/${userId}/avatar.${ext}`,
        }),
      );
      const buf = Buffer.from(await res.Body!.transformToByteArray());
      const ctype = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
      return new Response(buf, {
        headers: { 'content-type': ctype, 'cache-control': 'private, max-age=300' },
      });
    } catch {
      // tenta próximo
    }
  }
  return c.text('', 404);
});

// Static assets do build Vite em produção. Em dev, Vite serve no :5173 e
// faz proxy de /api → :3000, então este fallback nunca dispara em dev.
// `import.meta.dir` é o diretório do arquivo em runtime (Bun).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(import.meta.dir, '..', 'dist');
const distExists = existsSync(distDir);

app.get('*', async (c) => {
  if (!distExists) {
    // Dev sem build — devolve hint pro user usar Vite
    return c.text(
      'Voxen — front em dev mode. Rode `bun run dev:client` ou abra http://localhost:5173',
      404,
    );
  }
  const url = new URL(c.req.url);
  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(distDir, reqPath);
  // SPA fallback: qualquer rota desconhecida vira index.html (React Router)
  const target = existsSync(filePath) ? filePath : join(distDir, 'index.html');
  const file = Bun.file(target);
  if (!(await file.exists())) {
    return c.text('Not found', 404);
  }
  return new Response(file);
});

// Bun 1.3+ faz auto-serve do `export default` quando rodado via `bun src/index.ts`.
// O default precisa ter `{ port, fetch }` (formato BunServeOptions).
const port = Number(process.env.PORT ?? 3000);

export default {
  port,
  fetch: app.fetch,
};

// Em testes, importadores fazem `import app from '../src/index'` e Bun NÃO
// chama auto-serve (módulo é importado, não executado direto). Os tests
// usam `app.fetch(new Request(...))` direto.
export { app };
