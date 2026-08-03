// ============================================================================
// Integration tests — /api/integrations/cookies (spec 152)
// ============================================================================

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { getUserSettings } from '../src/lib/settings';
import { NETSCAPE_HEADER } from '../src/lib/platform-cookies';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;
const ENDPOINT = 'http://localhost/api/integrations/cookies';

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

function sessionCookie(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function createApprovedUser(email: string): Promise<{ id: string; cookie: string }> {
  await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-super-segura-123', name: email }),
    }),
  );
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { status: 'APPROVED' } });
  const signedIn = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-super-segura-123' }),
    }),
  );
  return { id: user.id, cookie: sessionCookie(signedIn) };
}

async function patch(cookie: string, platform: string, cookies: string): Promise<Response> {
  return app.fetch(
    new Request(ENDPOINT, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ platform, cookies }),
    }),
  );
}

describeIfDb('/api/integrations/cookies', () => {
  beforeEach(wipeDb);
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
  });

  it('permite qualquer usuário aprovado e grava cookies cifrados no escopo pessoal', async () => {
    const user = await createApprovedUser('user@voxen.local');
    const response = await patch(user.cookie, 'tiktok', netscapeDoc(cookieLine('.tiktok.com')));

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('segredo');
    const stored = await getUserSettings(user.id, ['yt_dlp_cookies', 'platform_cookies_meta']);
    expect(stored.yt_dlp_cookies).toContain('segredo');
    const raw = await db.setting.findUniqueOrThrow({
      where: { scope_userId_key: { scope: 'USER', userId: user.id, key: 'yt_dlp_cookies' } },
    });
    expect(raw.valueEnc).not.toContain('segredo');
  });

  it('isola status, conteúdo e revogação entre dois usuários', async () => {
    const first = await createApprovedUser('first@voxen.local');
    const second = await createApprovedUser('second@voxen.local');
    await patch(
      first.cookie,
      'tiktok',
      netscapeDoc(cookieLine('.tiktok.com', 'sessionid', 'first-secret')),
    );
    await patch(
      second.cookie,
      'tiktok',
      netscapeDoc(cookieLine('.tiktok.com', 'sessionid', 'second-secret')),
    );

    const firstState = await getUserSettings(first.id, ['yt_dlp_cookies']);
    const secondState = await getUserSettings(second.id, ['yt_dlp_cookies']);
    expect(firstState.yt_dlp_cookies).toContain('first-secret');
    expect(firstState.yt_dlp_cookies).not.toContain('second-secret');
    expect(secondState.yt_dlp_cookies).toContain('second-secret');

    const revoked = await app.fetch(
      new Request(`${ENDPOINT}/tiktok`, { method: 'DELETE', headers: { cookie: first.cookie } }),
    );
    expect(revoked.status).toBe(200);
    expect((await getUserSettings(first.id, ['yt_dlp_cookies'])).yt_dlp_cookies).toBeNull();
    expect((await getUserSettings(second.id, ['yt_dlp_cookies'])).yt_dlp_cookies).toContain(
      'second-secret',
    );
  });

  it('preserva capturas simultâneas de plataformas diferentes do mesmo usuário', async () => {
    const user = await createApprovedUser('concurrent@voxen.local');
    const [tiktok, instagram] = await Promise.all([
      patch(user.cookie, 'tiktok', netscapeDoc(cookieLine('.tiktok.com', 'sid', 'tiktok-secret'))),
      patch(
        user.cookie,
        'instagram',
        netscapeDoc(cookieLine('.instagram.com', 'sessionid', 'instagram-secret')),
      ),
    ]);

    expect(tiktok.status).toBe(200);
    expect(instagram.status).toBe(200);
    const stored = await getUserSettings(user.id, ['yt_dlp_cookies', 'platform_cookies_meta']);
    expect(stored.yt_dlp_cookies).toContain('tiktok-secret');
    expect(stored.yt_dlp_cookies).toContain('instagram-secret');
    expect(stored.platform_cookies_meta).toContain('tiktok');
    expect(stored.platform_cookies_meta).toContain('instagram');
  });

  it('rejeita uma captura inválida sem apagar a sessão pessoal anterior', async () => {
    const user = await createApprovedUser('valid@voxen.local');
    await patch(
      user.cookie,
      'tiktok',
      netscapeDoc(cookieLine('.tiktok.com', 'sessionid', 'valid-secret')),
    );
    const response = await patch(
      user.cookie,
      'tiktok',
      '.tiktok.com\tTRUE\t/\tTRUE\tinvalid\tsessionid\tbroken',
    );
    expect(response.status).toBe(422);
    expect((await getUserSettings(user.id, ['yt_dlp_cookies'])).yt_dlp_cookies).toContain(
      'valid-secret',
    );
  });

  it('rejeita sessão ausente', async () => {
    expect((await app.fetch(new Request(ENDPOINT))).status).toBe(401);
  });
});
