// ============================================================================
// Voxen Web — entrypoint
// ============================================================================
// Bun + Hono. API em /api/*; estática em /* (Vite build, futuro).
// ============================================================================

import { Hono } from 'hono';
import { auth } from './lib/auth';
import { db } from './lib/db';
import { getAppLanguage, getSetting, isSetupComplete } from './lib/settings';
import { adminRoutes } from './routes/admin';
import { adminModelsRoutes } from './routes/admin-models';
import { adminConfigRevisionRoutes } from './routes/admin-config-revisions';
import { integrationCookieRoutes } from './routes/integration-cookies';
import { getPublicActiveCapabilities } from './lib/capabilities';
import { jobsRoutes } from './routes/jobs';
import { libraryRoutes } from './routes/library';
import { setupRoutes } from './routes/setup';
import { transcriptsRoutes } from './routes/transcripts';
import { savedMediaRoutes } from './routes/saved-media';
import { onboardingRoutes } from './routes/onboarding';
import { accountRoutes } from './routes/account';
import { costRoutes } from './routes/cost';
import { notesRoutes } from './routes/notes';
import { automationsRoutes } from './routes/automations';
import { mcpRoutes } from './routes/mcp';
import { mcpTokenRoutes } from './routes/mcp-tokens';
import { graphRoutes } from './routes/graph';
import { guideRoutes } from './routes/guide';
import { createReleasesRoutes } from './routes/releases';
import { shareTargetRoutes } from './routes/share-target';
import { chatRoutes } from './routes/chat';
import { extensionMetaRoutes } from './routes/extension-meta';
import { researchArtifactsRoutes } from './routes/research-artifacts';
import { transcriptEnrichmentRoutes } from './routes/transcript-enrichments';
import { getRedisPublisher } from './lib/redis';
import { clientIp } from './lib/client-ip';
import { rateLimit } from './lib/rate-limit';
import { resolveStorageDriver, storageGet } from './lib/storage';
import { publicAuthenticationRoutes } from './routes/public-authentication';
import { mcpOAuthDiscoveryRoutes } from './routes/mcp-oauth';
import { mcpOAuthAccountRoutes } from './routes/mcp-oauth-account';

const app = new Hono();

// Healthcheck liveness — sempre 200, mesmo antes do setup (spec 000)
app.get('/health', (c) => c.json({ ok: true, service: 'web' }));

// Versão da build — fonte canônica em ordem de prioridade:
//   1. env VOXEN_VERSION (release.yml injeta da tag git; Makefile injeta
//      via `git describe --tags --always --dirty` no dev local)
//   2. package.json quando já contém uma prerelease (o version-dev é canônico)
//   3. Easypanel source deploy de uma versão estável: package next-patch +
//      DEPLOY_TIMESTAMP (`X.Y.Z-dev.<unix_epoch_seconds>`) quando há GIT_SHA
//   4. package.json (fallback se build foi feito sem injeção)
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
  // Uma versão produzida pelo workflow version-dev precisa coincidir
  // literalmente com releases.json. Reescrevê-la no startup criaria uma
  // versão sintética sem notas correspondentes.
  if (packageVersion.includes('-')) return null;
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

// Healthcheck deep — checa DB + Redis + S3 em paralelo.
// 200 se todos ok, 503 se algum falhar. Pra monitoramento externo (Uptime
// Kuma, Healthchecks.io). Rate-limit por IP pra evitar DoS amplificado
// (cada hit gera 4 round-trips reais).
app.get('/health/deep', async (c) => {
  const ip = clientIp(c);
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

  const [postgres, redis, storage] = await Promise.all([
    timed(async () => {
      await db.$queryRaw`SELECT 1`;
    }),
    timed(async () => {
      const pong = await getRedisPublisher().ping();
      if (pong !== 'PONG') throw new Error(`Resposta inesperada: ${pong}`);
    }),
    timed(async () => {
      const { checkStorage } = await import('./lib/storage-health');
      await checkStorage();
    }),
  ]);

  const checks = { postgres, redis, storage: { ...storage, driver: resolveStorageDriver() } };
  const allOk = Object.values(checks).every((c) => c.ok);
  return c.json({ ok: allOk, checks }, allOk ? 200 : 503);
});

app.route('/', mcpOAuthDiscoveryRoutes);
app.route('/', publicAuthenticationRoutes);

// Capabilities: features opcionais que o admin pode habilitar/desabilitar.
// UI consulta pra mostrar/esconder botões (ex: upload de imagem só aparece
// se admin configurou modelo de visão).
app.get('/api/capabilities', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  return c.json(await getPublicActiveCapabilities());
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
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      status: true,
      role: true,
      theme: true,
      interfaceMode: true,
    },
  });
  const theme =
    user?.theme === 'linear' ||
    user?.theme === 'emerald' ||
    user?.theme === 'light' ||
    user?.theme === 'zinc'
      ? user.theme
      : 'linear';
  const interfaceMode = user?.interfaceMode === 'focus' ? 'focus' : 'classic';
  return c.json({
    user: user ? { ...user, theme, interfaceMode } : null,
    setupComplete,
    onboardingDone,
    language,
  });
});

// Setup endpoints (protegidos por middleware ADMIN no próprio router)
app.route('/api/setup', setupRoutes);

// Admin endpoints (protegidos por middleware no próprio router)
app.route('/api/admin', adminRoutes);

// Seleção manual de modelos por finalidade (spec 123, admin only)
app.route('/api/admin/models', adminModelsRoutes);

app.route('/api/admin/config-revisions', adminConfigRevisionRoutes);

// Cookies de plataforma capturados pela extensão, dedicados ao usuário da sessão.
app.route('/api/integrations/cookies', integrationCookieRoutes);

// Jobs endpoints (download + transcrição — spec 002)
app.route('/api/jobs', jobsRoutes);

// Transcripts endpoints (list + canonical Markdown from selected storage)
app.route('/api/transcripts', transcriptsRoutes);
app.route('/api/saved-media', savedMediaRoutes);
app.route('/api/transcripts', transcriptEnrichmentRoutes);

// Onboarding (admin first-run) + avatar upload
app.route('/api/onboarding', onboardingRoutes);

// Conta do user (perfil + senha)
app.route('/api/account', accountRoutes);

// Painel de custos (admin)
app.route('/api/admin/custos', costRoutes);

// KB manual de notas (CRUD + FTS + tree)
app.route('/api/notes', notesRoutes);
app.route('/api/research-artifacts', researchArtifactsRoutes);
// Organização compartilhada da biblioteca
app.route('/api/library', libraryRoutes);
// Automações (jobs periódicos com continuidade — spec 008)
app.route('/api/automations', automationsRoutes);
// MCP server (auth via Bearer token; SEM cookie de sessão — IAs externas)
app.route('/mcp', mcpRoutes);
app.route('/api/mcp/tokens', mcpTokenRoutes);
app.route('/api/mcp/oauth', mcpOAuthAccountRoutes);
// Graph view (visualização Obsidian-like da KB)
app.route('/api/graph', graphRoutes);
// Explainable, deterministic personal Guide built from user-owned signals and graph data.
app.route('/api/guide', guideRoutes);
// Changelog / release notes (releases.json)
app.route('/api/releases', createReleasesRoutes(VOXEN_VERSION));
// Conversa canônica por usuário, streaming e ferramentas da Base de conhecimento.
app.route('/api/chat', chatRoutes);
// PWA Web Share Target (Android/Chrome instalado)
app.route('/share-target', shareTargetRoutes);
// Extensão browser — version.json (update check)
app.route('/extension', extensionMetaRoutes);

// Authenticated avatar proxy for the selected storage driver.
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
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const object = await storageGet(`workspaces/${userId}/avatar.${ext}`);
      const ctype = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
      return new Response(object.body, {
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

// Fallback de identidade para builds antigos ou sem Vite. Builds atuais gravam
// estes metas durante a compilação; assim uma variável alterada apenas no
// runtime não pode fazer JavaScript antigo se declarar como build novo.
const VOXEN_BUILD_ID = (VOXEN_GIT_SHA || VOXEN_VERSION).replace(/[^A-Za-z0-9._+-]/g, '');
const VOXEN_VERSION_ID = VOXEN_VERSION.replace(/[^A-Za-z0-9._+-]/g, '');

// Cache em memória do HTML transformado por path: o dist é imutável durante a
// vida do processo, então lemos/injetamos uma única vez por arquivo em vez de
// reprocessar a cada request (o Cache-Control do HTML é no-store).
const htmlBuildMetaCache = new Map<string, string>();

async function serveHtmlWithBuildMeta(target: string, headers: Headers): Promise<Response> {
  let html = htmlBuildMetaCache.get(target);
  if (html === undefined) {
    const raw = await Bun.file(target).text();
    html =
      raw.includes('name="voxen-build"') && raw.includes('name="voxen-version"')
        ? raw
        : raw.replace(
            '<head>',
            `<head><meta name="voxen-build" content="${VOXEN_BUILD_ID}"><meta name="voxen-version" content="${VOXEN_VERSION_ID}">`,
          );
    htmlBuildMetaCache.set(target, html);
  }
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(html, { headers });
}

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
    return serveHtmlWithBuildMeta(target, headers);
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

// Sincroniza o authfile do chisel embutido com o `proxy_agent_token` no boot
// (uma vez). Best-effort: roda fora do path de serve e nunca quebra o startup.
// Só em produção (entrypoint seta NODE_ENV=production): em dev/test o import de
// `../src/index` pelos testes não deve tocar /run/voxen nem DB.
if (process.env.NODE_ENV === 'production') {
  void import('./lib/proxy-agent-tunnel')
    .then(({ syncChiselAuthfile }) => syncChiselAuthfile())
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[proxy-agent] sync no boot falhou: ${message}`);
    });

  // Turnos do chat são duráveis: Redis impede execução duplicada e esta
  // reconciliação retoma o que ficou pendente após restart/deploy.
  void import('./lib/chat/turn-runtime')
    .then(({ reconcilePendingChatTurns }) => {
      void reconcilePendingChatTurns().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[chat] reconciliação inicial falhou: ${message}`);
      });
      setInterval(() => {
        void reconcilePendingChatTurns().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[chat] reconciliação periódica falhou: ${message}`);
        });
      }, 30_000);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[chat] runtime de continuidade indisponível: ${message}`);
    });

  void import('./routes/graph')
    .then(({ reconcileGraphUsers }) => {
      const reconcile = (): void => {
        void reconcileGraphUsers().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[graph] reconciliação automática falhou: ${message}`);
        });
      };
      reconcile();
      setInterval(reconcile, 60_000);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[graph] rotina automática indisponível: ${message}`);
    });
}

// Proxy de WebSocket do túnel: antes de cair no Hono, tentamos fazer upgrade do
// path do túnel (default /_tunnel) e encaminhar pro chisel server local. Só
// intercepta o path EXATO do túnel; qualquer outra rota segue pro Hono normal.
import { tryUpgradeTunnel, tunnelWebSocketHandler } from './lib/tunnel-proxy';
import type { Server } from 'bun';

function isLongLivedStreamRequest(req: Request): boolean {
  if (req.method === 'POST') {
    const path = new URL(req.url).pathname;
    // Chat SSE: turno pode ficar aberto minutos (request_transcription).
    return path === '/api/chat' || path.endsWith('/api/chat');
  }
  if (req.method === 'GET') {
    const path = new URL(req.url).pathname;
    // Jobs SSE: heartbeat a cada 10s, mas idle do Bun ainda pode matar a conexão.
    return /\/api\/jobs\/[^/]+\/events$/.test(path) || path.endsWith('/api/graph/events');
  }
  return false;
}

export default {
  port,
  // Bun.serve fecha conexões ociosas em 10s por padrão (inclui streams quietos).
  // 255s é o máximo da API; streams longos desabilitam o timeout por request.
  idleTimeout: 255,
  // `server` é injetado pelo Bun no runtime real. Em testes, importadores chamam
  // `app.fetch(req)` direto (sem server) — por isso é opcional: sem server não há
  // como fazer `server.upgrade`, então pulamos o proxy e seguimos pro Hono.
  // Tipamos o retorno como `Response | Promise<Response>` pra não poluir os
  // callers de teste (que fazem `const res = await app.fetch(req)`); no upgrade
  // bem-sucedido o Bun aceita `undefined` em runtime — encapsulamos com cast.
  fetch(req: Request, server?: Server<unknown>): Response | Promise<Response> {
    if (server) {
      if (isLongLivedStreamRequest(req)) {
        // 0 = sem idle timeout nesta request (docs Bun: SSE / long streams).
        server.timeout(req, 0);
      }
      const upgraded = tryUpgradeTunnel(req, server);
      // `tryUpgradeTunnel`: `undefined` = upgrade aceito (o Bun assume a resposta);
      // `Response` = interceptou e recusou; `null` = não é o path do túnel.
      if (upgraded !== null) return upgraded as unknown as Response;
    }
    return app.fetch(req, server ? { server } : undefined);
  },
  websocket: tunnelWebSocketHandler,
};

// Em testes, importadores fazem `import app from '../src/index'` e Bun NÃO
// chama auto-serve (módulo é importado, não executado direto). Os tests
// usam `app.fetch(new Request(...))` direto.
export { app };
