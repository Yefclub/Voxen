// ============================================================================
// Voxen Web — entrypoint
// ============================================================================
// Bun + Hono. API em /api/*; estática em /* (Vite build, futuro).
// ============================================================================

import { Hono } from 'hono';
import { auth } from './lib/auth';
import { db } from './lib/db';
import {
  getAppLanguage,
  getDefaultXAnalysisModel,
  getSetting,
  isSetupComplete,
} from './lib/settings';
import { adminRoutes } from './routes/admin';
import { jobsRoutes } from './routes/jobs';
import { libraryRoutes } from './routes/library';
import { setupRoutes } from './routes/setup';
import { transcriptsRoutes } from './routes/transcripts';
import { onboardingRoutes } from './routes/onboarding';
import { accountRoutes } from './routes/account';
import { costRoutes } from './routes/cost';
import { chatRoutes } from './routes/chat';
import { notesRoutes } from './routes/notes';
import { automationsRoutes } from './routes/automations';
import { mcpRoutes } from './routes/mcp';
import { graphRoutes } from './routes/graph';
import { shareTargetRoutes } from './routes/share-target';
import { getRedisPublisher } from './lib/redis';
import { rateLimit } from './lib/rate-limit';
import { s3Bucket, s3Client } from './lib/s3';

const app = new Hono();

// Healthcheck liveness — sempre 200, mesmo antes do setup (spec 000)
app.get('/health', (c) => c.json({ ok: true, service: 'web' }));

// Versão da build — fonte canônica em ordem de prioridade:
//   1. env VOXEN_VERSION (release.yml injeta da tag git; Makefile injeta
//      via `git describe --tags --always --dirty` no dev local)
//   2. Easypanel source deploy: package next-patch + DEPLOY_TIMESTAMP
//      (`X.Y.Z-dev.<unix_epoch_seconds>`) quando há GIT_SHA
//   3. package.json (fallback se build foi feito sem injeção)
// Tag git é a verdade no Voxen — package.json fica como fallback estável.
async function loadAppVersion(): Promise<string> {
  if (process.env.VOXEN_VERSION) return process.env.VOXEN_VERSION;
  try {
    const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json();
    const packageVersion = typeof pkg.version === 'string' ? pkg.version : '0.1.0';
    return (
      formatDevVersionFromDeploy(
        packageVersion,
        process.env.DEPLOY_TIMESTAMP,
        process.env.VOXEN_GIT_SHA || process.env.GIT_SHA,
      ) ?? packageVersion
    );
  } catch {
    return '0.1.0';
  }
}
const VOXEN_VERSION = await loadAppVersion();
const VOXEN_GIT_SHA = process.env.VOXEN_GIT_SHA || process.env.GIT_SHA || '';
const VOXEN_BUILT_AT =
  process.env.VOXEN_BUILT_AT ||
  deployTimestampToIso(process.env.DEPLOY_TIMESTAMP) ||
  new Date().toISOString();
app.get('/api/version', (c) => {
  return c.json({
    version: VOXEN_VERSION,
    gitSha: VOXEN_GIT_SHA || null,
    builtAt: VOXEN_BUILT_AT,
  });
});

export function formatDevVersionFromDeploy(
  packageVersion: string,
  deployTimestamp?: string,
  gitSha?: string,
): string | null {
  const stamp = deployTimestampToUnixSeconds(deployTimestamp);
  if (!stamp || !gitSha) return null;
  const base = packageVersion.split('-', 1)[0] ?? packageVersion;
  const parts = base.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  const [major, minor, patch] = parts as [number, number, number];
  return `${major}.${minor}.${patch + 1}-dev.${stamp}`;
}

function deployTimestampToUnixSeconds(value?: string): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  const seconds = numeric > 9_999_999_999 ? Math.floor(numeric / 1000) : numeric;
  return String(seconds);
}

function deployTimestampToIso(value?: string): string | null {
  const seconds = deployTimestampToUnixSeconds(value);
  if (!seconds) return null;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Healthcheck deep — checa DB + Redis + chat service + S3 em paralelo.
// 200 se todos ok, 503 se algum falhar. Pra monitoramento externo (Uptime
// Kuma, Healthchecks.io). Rate-limit por IP pra evitar DoS amplificado
// (cada hit gera 4 round-trips reais).
app.get('/health/deep', async (c) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';
  const rl = await rateLimit(`voxen:rl:health-deep:${ip}`, 30, 60);
  if (!rl.allowed) {
    return c.json({ error: 'Rate limit. Tente em alguns segundos.' }, 429);
  }

  type Check = { ok: boolean; latencyMs?: number; error?: string };
  const timed = async (fn: () => Promise<void>): Promise<Check> => {
    const t = performance.now();
    try {
      await fn();
      return { ok: true, latencyMs: Math.round(performance.now() - t) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
    }
  };

  const [postgres, redis, chat, s3] = await Promise.all([
    timed(async () => {
      await db.$queryRaw`SELECT 1`;
    }),
    timed(async () => {
      const pong = await getRedisPublisher().ping();
      if (pong !== 'PONG') throw new Error(`Resposta inesperada: ${pong}`);
    }),
    timed(async () => {
      const chatUrl = (process.env.CHAT_SERVICE_URL ?? 'http://chat:8001') + '/health';
      const res = await fetch(chatUrl, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),
    timed(async () => {
      const { headBucket } = await import('./lib/s3-health');
      await headBucket();
    }),
  ]);

  const checks = { postgres, redis, chat, s3 };
  const allOk = Object.values(checks).every((c) => c.ok);
  return c.json({ ok: allOk, checks }, allOk ? 200 : 503);
});

// Endpoint público: estado da instância (signups, primeira instalação)
// Login page usa isso pra mostrar/esconder "Criar conta".
app.get('/api/instance', async (c) => {
  const [allowSignupsRaw, onboardingRaw, language] = await Promise.all([
    getSetting('allow_signups').catch(() => null),
    getSetting('onboarding_done').catch(() => null),
    getAppLanguage().catch(() => 'pt-BR' as const),
  ]);
  // Sem onboarding feito: não há admin ainda OR admin não terminou setup.
  // Nesse caso o primeiro signup é o do admin → sempre permitido.
  const userCount = await db.user.count();
  const onboardingDone = onboardingRaw === 'true';
  const allowSignups = userCount === 0 || (onboardingDone && allowSignupsRaw !== 'false');
  return c.json({ allowSignups, hasUsers: userCount > 0, onboardingDone, language });
});

// Capabilities: features opcionais que o admin pode habilitar/desabilitar.
// UI consulta pra mostrar/esconder botões (ex: upload de imagem só aparece
// se admin configurou modelo de visão).
app.get('/api/capabilities', async (c) => {
  const [chatModel, visionModel, webSearchModel, documentModel, xAnalysisModel] = await Promise.all(
    [
      getSetting('default_chat_model').catch(() => null),
      getSetting('default_vision_model').catch(() => null),
      getSetting('default_web_search_model').catch(() => null),
      getSetting('default_document_model').catch(() => null),
      getDefaultXAnalysisModel().catch(() => null),
    ],
  );
  return c.json({
    vision: !!visionModel,
    webSearch: !!(webSearchModel || chatModel),
    document: !!documentModel,
    xAnalysis: !!xAnalysisModel,
  });
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
  const [setupComplete, onboardingRaw, language] = await Promise.all([
    isSetupComplete(),
    getSetting('onboarding_done').catch(() => null),
    getAppLanguage().catch(() => 'pt-BR' as const),
  ]);
  const onboardingDone = onboardingRaw === 'true';
  if (!session) {
    return c.json({ user: null, setupComplete, onboardingDone, language });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, image: true, status: true, role: true },
  });
  return c.json({ user, setupComplete, onboardingDone, language });
});

// Setup endpoints (protegidos por middleware ADMIN no próprio router)
app.route('/api/setup', setupRoutes);

// Admin endpoints (protegidos por middleware no próprio router)
app.route('/api/admin', adminRoutes);

// Jobs endpoints (download + transcrição — spec 002)
app.route('/api/jobs', jobsRoutes);

// Transcripts endpoints (lista + viewer .md do storage S3)
app.route('/api/transcripts', transcriptsRoutes);

// Onboarding (admin first-run) + avatar upload
app.route('/api/onboarding', onboardingRoutes);

// Conta do user (perfil + senha)
app.route('/api/account', accountRoutes);

// Painel de custos (admin)
app.route('/api/admin/custos', costRoutes);

// Chat (proxy autenticado pro serviço chat:8001)
app.route('/api/chat', chatRoutes);
// KB manual de notas (CRUD + FTS + tree)
app.route('/api/notes', notesRoutes);
// Organização compartilhada da biblioteca
app.route('/api/library', libraryRoutes);
// Automações (jobs periódicos com continuidade — spec 008)
app.route('/api/automations', automationsRoutes);
// MCP server (auth via Bearer token; SEM cookie de sessão — IAs externas)
app.route('/mcp', mcpRoutes);
// Graph view (visualização Obsidian-like da KB)
app.route('/api/graph', graphRoutes);
// PWA Web Share Target (Android/Chrome instalado)
app.route('/share-target', shareTargetRoutes);

// Avatar proxy: serve imagem do storage S3 de qualquer user autenticado
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
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const res = await s3Client().send(
        new GetObjectCommand({
          Bucket: s3Bucket(),
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
  // Cache strategy:
  // - HTML (index.html, fallback SPA): no-store. Garante que browser sempre
  //   pega versão fresca após deploy — assets hashados do Vite são linkados
  //   pelo HTML e mudam de path a cada build, então cache de HTML bloqueia
  //   a invalidação automática.
  // - Assets hashados (/assets/[name].[hash].js|css|svg|woff2): max-age=1y
  //   immutable. Vite garante que mudaram → mudou o filename, cache antigo
  //   continua válido em paralelo.
  // - Arquivos do PWA sem hash (sw.js, registerSW.js, manifest.webmanifest):
  //   no-cache. O service worker é o gatilho de update do PWA — se ficar 1h
  //   em cache HTTP, o browser demora 1h pra perceber que existe build novo.
  //   no-cache (≠ no-store) ainda permite revalidação condicional (ETag/304).
  // - workbox-*.js na raiz do dist: tem hash no nome (gerado pelo
  //   vite-plugin-pwa), então é immutable como os /assets/.
  // - Outros estáticos sem hash (/favicon.ico, /voxen-256.png): 1h
  //   (balance entre frescor e load).
  const headers = new Headers();
  const isHtml = target.endsWith('.html');
  // Vite default usa `[name]-[hash].ext` (hífen) ou `[name].[hash].ext` (ponto).
  // Cobrimos as duas formas — separador `[.-]` antes do hash base62 ≥8 chars.
  const isHashedAsset = /\/assets\/[^/]+[.-][A-Za-z0-9_-]{8,}\.(js|css|svg|woff2?|ttf|otf)$/.test(
    reqPath,
  );
  const isPwaEntry = /^\/(sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(reqPath);
  const isWorkboxRuntime = /^\/workbox-[A-Za-z0-9_-]+\.js$/.test(reqPath);
  if (isHtml) {
    headers.set('Cache-Control', 'no-store, must-revalidate');
  } else if (isPwaEntry) {
    headers.set('Cache-Control', 'no-cache, must-revalidate');
  } else if (isHashedAsset || isWorkboxRuntime) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    headers.set('Cache-Control', 'public, max-age=3600');
  }
  return new Response(file, { headers });
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
