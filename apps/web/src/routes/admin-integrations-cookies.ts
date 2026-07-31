// ============================================================================
// /api/admin/integrations/cookies — cookies de plataforma (spec 121)
// ============================================================================
// Recebe da extensão Voxen o `cookies.txt` (formato Netscape) de uma
// plataforma de conteúdo (TikTok/Instagram/YouTube) e o persiste cifrado na
// setting GLOBAL `yt_dlp_cookies` — a MESMA que o worker já consome. As três
// plataformas convivem no mesmo arquivo; ver lib/platform-cookies.ts.
//
// Regra de ouro desta rota: o valor do cookie NUNCA sai daqui. Nenhuma
// resposta, mensagem de erro ou log carrega o conteúdo — nem mascarado. A
// leitura de status devolve só { platform, hasCookie, capturedAt, stale }.
//
// Escrita restrita a ADMIN: é config de infraestrutura do operador, no mesmo
// padrão de `yt_dlp_proxy_urls` e `proxy_agent_token`.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import {
  COOKIE_PLATFORMS,
  hasPlatformCookie,
  isCaptureStale,
  isCookiePlatform,
  mergePlatformCookies,
  parseCaptureMeta,
  parseCapturedCookies,
  removePlatformCookies,
  serializeCaptureMeta,
  type CookiePlatform,
} from '../lib/platform-cookies';
import { deleteSetting, getSettings, setSettings } from '../lib/settings';

type Vars = { adminUserId: string };

export const adminIntegrationCookieRoutes = new Hono<{ Variables: Vars }>();

adminIntegrationCookieRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

interface PlatformCookieStatus {
  platform: CookiePlatform;
  hasCookie: boolean;
  capturedAt: string | null;
  stale: boolean;
}

/** Lê o arquivo atual + metadados. O conteúdo fica só nesta closure. */
async function readState(): Promise<{
  cookies: string | null;
  meta: ReturnType<typeof parseCaptureMeta>;
}> {
  const stored = await getSettings(['yt_dlp_cookies', 'platform_cookies_meta']);
  return {
    cookies: stored.yt_dlp_cookies,
    meta: parseCaptureMeta(stored.platform_cookies_meta),
  };
}

function buildStatus(
  cookies: string | null,
  meta: ReturnType<typeof parseCaptureMeta>,
  platform: CookiePlatform,
): PlatformCookieStatus {
  const hasCookie = hasPlatformCookie(cookies, platform);
  // Sem cookie, um timestamp órfão não significa nada — não exibe data.
  const capturedAt = hasCookie ? (meta[platform]?.capturedAt ?? null) : null;
  return { platform, hasCookie, capturedAt, stale: isCaptureStale(capturedAt) };
}

// GET / — estado das três plataformas. NUNCA devolve o valor dos cookies.
adminIntegrationCookieRoutes.get('/', async (c) => {
  const { cookies, meta } = await readState();
  return c.json({
    platforms: COOKIE_PLATFORMS.map((platform) => buildStatus(cookies, meta, platform)),
  });
});

const PatchBody = z
  .object({
    platform: z.string().trim().min(1).max(32),
    cookies: z.string().min(1),
  })
  .strict();

// PATCH / — grava a captura de uma plataforma (merge por domínio: substitui só
// o bloco daquela plataforma). Captura inválida é rejeitada ANTES de qualquer
// escrita — o que já estava gravado permanece intacto.
adminIntegrationCookieRoutes.patch('/', async (c) => {
  const parsedBody = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsedBody.success) {
    return c.json({ error: 'Informe "platform" e "cookies".' }, 400);
  }
  const { platform, cookies } = parsedBody.data;
  if (!isCookiePlatform(platform)) {
    return c.json({ error: 'Plataforma não suportada.' }, 400);
  }

  const parsed = parseCapturedCookies(platform, cookies);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, parsed.status);
  }

  const state = await readState();
  const merged = mergePlatformCookies(state.cookies, platform, parsed.lines);
  const capturedAt = new Date().toISOString();
  const meta = { ...state.meta, [platform]: { capturedAt } };

  await setSettings({
    yt_dlp_cookies: merged,
    platform_cookies_meta: serializeCaptureMeta(meta),
  });

  return c.json(buildStatus(merged, meta, platform));
});

// DELETE /:platform — revoga a credencial guardada daquela plataforma.
// Preserva as outras plataformas e cookies manuais de outros domínios.
adminIntegrationCookieRoutes.delete('/:platform', async (c) => {
  const platform = c.req.param('platform');
  if (!isCookiePlatform(platform)) {
    return c.json({ error: 'Plataforma não suportada.' }, 400);
  }

  const state = await readState();
  const remaining = removePlatformCookies(state.cookies, platform);
  const meta = { ...state.meta };
  delete meta[platform];

  if (remaining) {
    await setSettings({
      yt_dlp_cookies: remaining,
      platform_cookies_meta: serializeCaptureMeta(meta),
    });
  } else {
    await deleteSetting('yt_dlp_cookies');
    await setSettings({ platform_cookies_meta: serializeCaptureMeta(meta) });
  }

  return c.json(buildStatus(remaining, meta, platform));
});
