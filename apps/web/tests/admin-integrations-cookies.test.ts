// ============================================================================
// Integration tests — /api/admin/integrations/cookies (spec 121)
// ============================================================================
// Cobre os critérios de aceite da spec 121:
//   - grava cifrado em `yt_dlp_cookies` e registra a data de captura
//   - gravar uma plataforma não apaga as outras (nem cookies manuais)
//   - status devolve { platform, hasCookie, capturedAt, stale } e NUNCA o valor
//   - TTL de 7 dias sinaliza stale: true
//   - captura inválida não sobrescreve o que já estava gravado
//   - rota rejeita não-ADMIN e não-autenticado (guard próprio)
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import app from '../src/index';
import { adminIntegrationCookieRoutes } from '../src/routes/admin-integrations-cookies';
import { db } from '../src/lib/db';
import { getSetting, setSetting } from '../src/lib/settings';
import { COOKIE_STALE_AFTER_MS, NETSCAPE_HEADER } from '../src/lib/platform-cookies';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

const ENDPOINT = 'http://localhost/api/admin/integrations/cookies';

function cookieLine(domain: string, name = 'sessionid', value = 'segredo'): string {
  return [domain, 'TRUE', '/', 'TRUE', '1893456000', name, value].join('\t');
}

function netscapeDoc(...lines: string[]): string {
  return `${NETSCAPE_HEADER}\n${lines.join('\n')}\n`;
}

async function wipeDb(): Promise<void> {
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verification.deleteMany();
  await db.setting.deleteMany();
  await db.user.deleteMany();
}

async function signUp(email: string, password: string, name: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),
  );
}

async function signIn(email: string, password: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function extractCookie(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

async function setupAdmin(email = 'admin@voxen.local'): Promise<string> {
  await signUp(email, 'senha-super-segura-123', 'Admin');
  return extractCookie(await signIn(email, 'senha-super-segura-123'));
}

/** Aprova um segundo usuário (não-ADMIN) e devolve o cookie de sessão dele. */
async function setupApprovedUser(adminCookie: string, email: string): Promise<string> {
  await signUp(email, 'senha-super-segura-456', 'User');
  const pending = await db.user.findUnique({ where: { email } });
  await app.fetch(
    new Request(`http://localhost/api/admin/usuarios/${pending!.id}/approve`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
  return extractCookie(await signIn(email, 'senha-super-segura-456'));
}

interface PlatformStatus {
  platform: string;
  hasCookie: boolean;
  capturedAt: string | null;
  stale: boolean;
}

async function patchCookies(cookie: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(ENDPOINT, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describeIfDb('/api/admin/integrations/cookies', () => {
  beforeAll(wipeDb);
  beforeEach(wipeDb);
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
  });

  it('GET lista as três plataformas desconectadas quando não há nada gravado', async () => {
    const cookie = await setupAdmin();
    const res = await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { platforms: PlatformStatus[] };
    expect(body.platforms.map((p) => p.platform)).toEqual(['tiktok', 'instagram', 'youtube']);
    for (const p of body.platforms) {
      expect(p.hasCookie).toBe(false);
      expect(p.capturedAt).toBeNull();
      expect(p.stale).toBe(false);
    }
  });

  it('PATCH grava o cookie cifrado em yt_dlp_cookies e marca a captura', async () => {
    const cookie = await setupAdmin();
    const res = await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com')),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlatformStatus;
    expect(body).toMatchObject({ platform: 'tiktok', hasCookie: true, stale: false });
    expect(typeof body.capturedAt).toBe('string');

    const stored = await getSetting('yt_dlp_cookies');
    expect(stored).toContain('.tiktok.com');
    expect(stored).toContain('segredo');

    // Cifrado em repouso: a coluna crua não contém o valor.
    const row = await db.setting.findFirst({ where: { key: 'yt_dlp_cookies' } });
    expect(row).not.toBeNull();
    expect(row!.valueEnc).not.toContain('segredo');
  });

  it('nenhuma resposta da rota devolve o valor do cookie', async () => {
    const cookie = await setupAdmin();
    const patch = await patchCookies(cookie, {
      platform: 'instagram',
      cookies: netscapeDoc(cookieLine('.instagram.com', 'sessionid', 'VALOR-ULTRA-SECRETO')),
    });
    expect(await patch.text()).not.toContain('VALOR-ULTRA-SECRETO');

    const get = await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
    const text = await get.text();
    expect(text).not.toContain('VALOR-ULTRA-SECRETO');
    expect(text).not.toContain('sessionid');
    expect(text).not.toContain(NETSCAPE_HEADER);
  });

  it('não escreve o valor do cookie em nenhum canal de log', async () => {
    const cookie = await setupAdmin();
    const secret = 'VALOR-QUE-NAO-PODE-VAZAR';
    const captured: string[] = [];
    // eslint-disable-next-line no-console -- o teste precisa interceptar os 3 canais
    const original = { log: console.log, warn: console.warn, error: console.error };
    const spy =
      (...prefix: unknown[]) =>
      (...args: unknown[]): void => {
        captured.push([...prefix, ...args].map(String).join(' '));
      };
    /* eslint-disable no-console -- idem: instalar e restaurar os espiões */
    console.log = spy();
    console.warn = spy();
    console.error = spy();
    /* eslint-enable no-console */
    try {
      await patchCookies(cookie, {
        platform: 'tiktok',
        cookies: netscapeDoc(cookieLine('.tiktok.com', 'sessionid', secret)),
      });
      await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
      await app.fetch(new Request(`${ENDPOINT}/tiktok`, { method: 'DELETE', headers: { cookie } }));
    } finally {
      /* eslint-disable no-console -- restaura os canais originais */
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      /* eslint-enable no-console */
    }
    expect(captured.join('\n')).not.toContain(secret);
  });

  it('gravar uma plataforma não apaga as outras nem cookies manuais de outros domínios', async () => {
    const cookie = await setupAdmin();
    await setSetting('yt_dlp_cookies', netscapeDoc(cookieLine('.exemplo.com', 'manual', 'mantem')));

    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com', 'tt', 'tiktok-v')),
    });
    await patchCookies(cookie, {
      platform: 'youtube',
      cookies: netscapeDoc(cookieLine('.youtube.com', 'yt', 'youtube-v')),
    });

    const stored = (await getSetting('yt_dlp_cookies')) ?? '';
    expect(stored).toContain('mantem');
    expect(stored).toContain('tiktok-v');
    expect(stored).toContain('youtube-v');
    // Um único cabeçalho, não um por gravação.
    expect(stored.split('\n').filter((l) => l === NETSCAPE_HEADER)).toHaveLength(1);

    const res = await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
    const body = (await res.json()) as { platforms: PlatformStatus[] };
    const byId = new Map(body.platforms.map((p) => [p.platform, p]));
    expect(byId.get('tiktok')?.hasCookie).toBe(true);
    expect(byId.get('youtube')?.hasCookie).toBe(true);
    expect(byId.get('instagram')?.hasCookie).toBe(false);
  });

  it('recaptura da mesma plataforma substitui o valor anterior', async () => {
    const cookie = await setupAdmin();
    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com', 'sessionid', 'antigo')),
    });
    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com', 'sessionid', 'novo')),
    });
    const stored = (await getSetting('yt_dlp_cookies')) ?? '';
    expect(stored).toContain('novo');
    expect(stored).not.toContain('antigo');
  });

  it('captura com mais de 7 dias vira stale: true', async () => {
    const cookie = await setupAdmin();
    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com')),
    });

    const old = new Date(Date.now() - COOKIE_STALE_AFTER_MS - 60_000).toISOString();
    await setSetting('platform_cookies_meta', JSON.stringify({ tiktok: { capturedAt: old } }));

    const res = await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
    const body = (await res.json()) as { platforms: PlatformStatus[] };
    const tiktok = body.platforms.find((p) => p.platform === 'tiktok')!;
    expect(tiktok.stale).toBe(true);
    expect(tiktok.capturedAt).toBe(old);
  });

  it('cookie pré-existente sem data de captura aparece conectado e não-stale', async () => {
    const cookie = await setupAdmin();
    await setSetting('yt_dlp_cookies', netscapeDoc(cookieLine('.youtube.com')));

    const res = await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
    const body = (await res.json()) as { platforms: PlatformStatus[] };
    const youtube = body.platforms.find((p) => p.platform === 'youtube')!;
    expect(youtube.hasCookie).toBe(true);
    expect(youtube.capturedAt).toBeNull();
    expect(youtube.stale).toBe(false);
  });

  it('rejeita plataforma desconhecida', async () => {
    const cookie = await setupAdmin();
    const res = await patchCookies(cookie, {
      platform: 'facebook',
      cookies: netscapeDoc(cookieLine('.facebook.com')),
    });
    expect(res.status).toBe(400);
  });

  it('rejeita cookie de domínio que não pertence à plataforma declarada', async () => {
    const cookie = await setupAdmin();
    const res = await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.google.com', 'SID', 'conta-google')),
    });
    expect(res.status).toBe(422);
    expect(await getSetting('yt_dlp_cookies')).toBeNull();
  });

  it('captura inválida não sobrescreve o cookie já gravado', async () => {
    const cookie = await setupAdmin();
    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com', 'sessionid', 'valido')),
    });

    const res = await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: '.tiktok.com\tTRUE\t/\tTRUE\tnao-numero\tsessionid\tquebrado',
    });
    expect(res.status).toBe(422);
    const stored = (await getSetting('yt_dlp_cookies')) ?? '';
    expect(stored).toContain('valido');
    expect(stored).not.toContain('quebrado');
  });

  it('mensagem de erro não vaza o conteúdo do cookie', async () => {
    const cookie = await setupAdmin();
    const res = await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: '.tiktok.com\tTRUE\t/\tTRUE\tnao-numero\tsessionid\tVALOR-SECRETO',
    });
    const text = await res.text();
    expect(text).not.toContain('VALOR-SECRETO');
    expect(text).not.toContain('sessionid');
  });

  it('rejeita corpo sem cookies', async () => {
    const cookie = await setupAdmin();
    const res = await patchCookies(cookie, { platform: 'tiktok' });
    expect(res.status).toBe(400);
  });

  it('DELETE remove só a plataforma pedida e o timestamp dela', async () => {
    const cookie = await setupAdmin();
    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com', 'tt', 'tiktok-v')),
    });
    await patchCookies(cookie, {
      platform: 'instagram',
      cookies: netscapeDoc(cookieLine('.instagram.com', 'ig', 'insta-v')),
    });

    const res = await app.fetch(
      new Request(`${ENDPOINT}/tiktok`, { method: 'DELETE', headers: { cookie } }),
    );
    expect(res.status).toBe(200);

    const stored = (await getSetting('yt_dlp_cookies')) ?? '';
    expect(stored).not.toContain('tiktok-v');
    expect(stored).toContain('insta-v');

    const status = await app.fetch(new Request(ENDPOINT, { headers: { cookie } }));
    const body = (await status.json()) as { platforms: PlatformStatus[] };
    const tiktok = body.platforms.find((p) => p.platform === 'tiktok')!;
    expect(tiktok.hasCookie).toBe(false);
    expect(tiktok.capturedAt).toBeNull();
  });

  it('DELETE da última plataforma apaga a setting inteira', async () => {
    const cookie = await setupAdmin();
    await patchCookies(cookie, {
      platform: 'tiktok',
      cookies: netscapeDoc(cookieLine('.tiktok.com')),
    });
    await app.fetch(new Request(`${ENDPOINT}/tiktok`, { method: 'DELETE', headers: { cookie } }));
    expect(await getSetting('yt_dlp_cookies')).toBeNull();
  });
});

// O app monta `/api/admin` (adminRoutes) ANTES deste router, e o `use('*')` do
// pai também dispara nos subcaminhos — então os testes acima, contra o app
// inteiro, seriam satisfeitos pelo guard do pai mesmo sem guard próprio aqui.
// Montado isolado, só o middleware deste router responde.
describeIfDb('/api/admin/integrations/cookies — guard próprio (router isolado)', () => {
  const isolated = new Hono().route(
    '/api/admin/integrations/cookies',
    adminIntegrationCookieRoutes,
  );

  beforeEach(wipeDb);
  afterAll(wipeDb);

  it('não-autenticado recebe 401', async () => {
    const res = await isolated.fetch(new Request(ENDPOINT));
    expect(res.status).toBe(401);
  });

  it('não-ADMIN recebe 403 em todos os verbos', async () => {
    const adminCookie = await setupAdmin('admin2@voxen.local');
    const userCookie = await setupApprovedUser(adminCookie, 'user2@voxen.local');

    const cases: Array<[string, RequestInit]> = [
      [ENDPOINT, { headers: { cookie: userCookie } }],
      [
        ENDPOINT,
        {
          method: 'PATCH',
          headers: { cookie: userCookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: 'tiktok',
            cookies: netscapeDoc(cookieLine('.tiktok.com')),
          }),
        },
      ],
      [`${ENDPOINT}/tiktok`, { method: 'DELETE', headers: { cookie: userCookie } }],
    ];
    for (const [url, init] of cases) {
      const res = await isolated.fetch(new Request(url, init));
      expect(res.status).toBe(403);
    }

    // E nada foi gravado pela tentativa do não-ADMIN.
    expect(await getSetting('yt_dlp_cookies')).toBeNull();
  });
});
