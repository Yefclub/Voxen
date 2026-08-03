// ============================================================================
// /api/integrations/cookies — contas pessoais de plataforma (spec 152)
// ============================================================================
// Recebe da extensão Voxen o `cookies.txt` (formato Netscape) de uma
// plataforma de conteúdo (TikTok/Instagram/YouTube) e o persiste cifrado no
// escopo USER. As três plataformas convivem no arquivo daquele usuário; ver
// lib/platform-cookies.ts.
//
// Regra de ouro desta rota: o valor do cookie NUNCA sai daqui. Nenhuma
// resposta, mensagem de erro ou log carrega o conteúdo — nem mascarado. A
// leitura de status devolve só { platform, hasCookie, capturedAt, stale }.
//
// A sessão do Voxen identifica o dono em todas as operações. Não existe
// fallback para cookies globais legados: eles não têm proprietário verificável.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { decrypt, encrypt } from '../lib/crypto';
import { db } from '../lib/db';
import { getMasterKey } from '../lib/master-key';
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
import { getUserSettings } from '../lib/settings';

type Vars = { userId: string };

export const integrationCookieRoutes = new Hono<{ Variables: Vars }>();

integrationCookieRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  c.set('userId', session.user.id);
  return next();
});

interface PlatformCookieStatus {
  platform: CookiePlatform;
  hasCookie: boolean;
  capturedAt: string | null;
  stale: boolean;
}

/** Lê o arquivo atual + metadados. O conteúdo fica só nesta closure. */
async function readState(userId: string): Promise<{
  cookies: string | null;
  meta: ReturnType<typeof parseCaptureMeta>;
}> {
  const stored = await getUserSettings(userId, ['yt_dlp_cookies', 'platform_cookies_meta']);
  return {
    cookies: stored.yt_dlp_cookies,
    meta: parseCaptureMeta(stored.platform_cookies_meta),
  };
}

/**
 * Serializa o read-modify-write de um usuário dentro do Postgres. Sem este
 * lock, duas capturas simultâneas poderiam fazer a última escrita apagar o
 * bloco de plataforma que a primeira acabou de incluir.
 */
async function mutateState<Result>(
  userId: string,
  mutate: (state: { cookies: string | null; meta: ReturnType<typeof parseCaptureMeta> }) => {
    cookies: string | null;
    meta: ReturnType<typeof parseCaptureMeta>;
    result: Result;
  },
): Promise<Result> {
  const masterKey = getMasterKey();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voxen:user-settings:${userId}`}))`;
    const rows = await tx.setting.findMany({
      where: {
        scope: 'USER',
        userId,
        key: { in: ['yt_dlp_cookies', 'platform_cookies_meta'] },
      },
      select: { key: true, valueEnc: true },
    });
    const stored = new Map(rows.map((row) => [row.key, decrypt(row.valueEnc, masterKey)]));
    const next = mutate({
      cookies: stored.get('yt_dlp_cookies') ?? null,
      meta: parseCaptureMeta(stored.get('platform_cookies_meta') ?? null),
    });
    const values = {
      yt_dlp_cookies: next.cookies,
      platform_cookies_meta: serializeCaptureMeta(next.meta),
    } as const;
    for (const [key, value] of Object.entries(values)) {
      const uniqueWhere = { scope_userId_key: { scope: 'USER' as const, userId, key } };
      if (value === null) {
        await tx.setting.deleteMany({ where: { scope: 'USER', userId, key } });
      } else {
        await tx.setting.upsert({
          where: uniqueWhere,
          create: { scope: 'USER', userId, key, valueEnc: encrypt(value, masterKey) },
          update: { valueEnc: encrypt(value, masterKey) },
        });
      }
    }
    return next.result;
  });
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
integrationCookieRoutes.get('/', async (c) => {
  const { cookies, meta } = await readState(c.get('userId'));
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
integrationCookieRoutes.patch('/', async (c) => {
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

  const capturedAt = new Date().toISOString();
  const status = await mutateState(c.get('userId'), (state) => {
    const cookies = mergePlatformCookies(state.cookies, platform, parsed.lines);
    const meta = { ...state.meta, [platform]: { capturedAt } };
    return { cookies, meta, result: buildStatus(cookies, meta, platform) };
  });
  return c.json(status);
});

// DELETE /:platform — revoga a credencial guardada daquela plataforma.
// Preserva as outras plataformas e cookies manuais de outros domínios.
integrationCookieRoutes.delete('/:platform', async (c) => {
  const platform = c.req.param('platform');
  if (!isCookiePlatform(platform)) {
    return c.json({ error: 'Plataforma não suportada.' }, 400);
  }

  const status = await mutateState(c.get('userId'), (state) => {
    const cookies = removePlatformCookies(state.cookies, platform) || null;
    const meta = { ...state.meta };
    delete meta[platform];
    return { cookies, meta, result: buildStatus(cookies, meta, platform) };
  });
  return c.json(status);
});
