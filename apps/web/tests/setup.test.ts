// ============================================================================
// Integration tests — setup flow (/api/setup, Product 1)
// ============================================================================
// Knowledge-base setup requires no provider account, key, or model config
// (spec 215): admin persists language/timezone, readiness comes from
// onboarding_done.
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { encrypt } from '../src/lib/crypto';
import { db } from '../src/lib/db';
import { getMasterKey } from '../src/lib/master-key';
import { getSetting, getSettings, setSetting, setSettings } from '../src/lib/settings';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

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

describeIfDb('setup flow', () => {
  beforeAll(async () => {
    await wipeDb();
  });
  beforeEach(async () => {
    await wipeDb();
  });
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
  });

  it('admin persiste preferências cifradas e setup segue o onboarding', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ app_language: 'en', app_timezone: 'UTC' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { complete: boolean };
    expect(body.complete).toBe(false);

    // Settings persistidas, cifradas (valueEnc não vazio, no formato iv.ct.tag).
    const stored = await db.setting.findMany({
      where: { scope: 'GLOBAL', userId: null },
      select: { key: true, valueEnc: true },
    });
    expect(stored.map((item) => item.key).sort()).toEqual(['app_language', 'app_timezone']);
    for (const s of stored) {
      expect(s.valueEnc.length).toBeGreaterThan(0);
      expect(s.valueEnc.split('.')).toHaveLength(3);
    }

    const statusRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const status = (await statusRes.json()) as {
      complete: boolean;
      language: string;
      timezone: string;
    };
    expect(status).toMatchObject({ complete: false, language: 'en', timezone: 'UTC' });

    await setSettings({ onboarding_done: 'true' });
    const doneRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const done = (await doneRes.json()) as { complete: boolean };
    expect(done.complete).toBe(true);
  });

  it('rejeita payload sem preferências reconhecidas', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: 'sk-or-v1-ignorado' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.setting.count({ where: { scope: 'GLOBAL' } })).toBe(0);
  });

  it('rejeita timezone inválido sem persistir nada', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ app_timezone: 'Marte/Olympus' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.setting.count({ where: { scope: 'GLOBAL' } })).toBe(0);
  });

  it('serializa gravações concorrentes sem duplicar uma chave global', async () => {
    await Promise.all([
      setSettings({
        app_language: 'en',
        app_timezone: 'UTC',
      }),
      setSettings({
        app_language: 'pt-BR',
        app_timezone: 'America/Sao_Paulo',
      }),
    ]);

    const rows = await db.setting.findMany({
      where: { scope: 'GLOBAL', userId: null, key: 'app_language' },
    });
    expect(rows).toHaveLength(1);
    const persisted = (await getSettings([
      'app_language',
      'app_timezone',
    ] as const)) as unknown as Record<string, string | null>;
    expect([
      { app_language: 'en', app_timezone: 'UTC' },
      { app_language: 'pt-BR', app_timezone: 'America/Sao_Paulo' },
    ] as unknown as Array<Record<string, string | null>>).toContainEqual(persisted);

    const duplicateWrite = Promise.resolve(
      db.setting.create({
        data: {
          scope: 'GLOBAL',
          userId: null,
          key: 'app_language',
          valueEnc: encrypt('bypass-do-lock', getMasterKey()),
        },
      }),
    );
    await expect(duplicateWrite).rejects.toThrow();
  });

  it('admin pode atualizar idioma e fuso sem chave', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(getSetting('app_language')).resolves.toBe('en');
    await expect(getSetting('app_timezone')).resolves.toBe('UTC');

    const statusRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const status = (await statusRes.json()) as { language: string; timezone: string };
    expect(status).toMatchObject({ language: 'en', timezone: 'UTC' });
  });

  it('user comum em /api/setup → 403', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    await db.user.update({
      where: { email: 'user@voxen.local' },
      data: { status: 'APPROVED' },
    });

    const userSignin = await signIn('user@voxen.local', 'senha-super-segura-456');
    const userCookie = extractCookie(userSignin);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie: userCookie } }),
    );
    expect(res.status).toBe(403);
  });

  it('não-autenticado em /api/setup → 401', async () => {
    const res = await app.fetch(new Request('http://localhost/api/setup'));
    expect(res.status).toBe(401);
  });

  it('/api/me expõe setupComplete', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const r1 = await app.fetch(new Request('http://localhost/api/me'));
    const b1 = (await r1.json()) as { setupComplete: boolean };
    expect(b1.setupComplete).toBe(false);

    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ app_language: 'en' }),
      }),
    );

    const r2 = await app.fetch(new Request('http://localhost/api/me', { headers: { cookie } }));
    const b2 = (await r2.json()) as { setupComplete: boolean };
    expect(b2.setupComplete).toBe(false);

    await setSetting('onboarding_done', 'true');
    const r3 = await app.fetch(new Request('http://localhost/api/me', { headers: { cookie } }));
    const b3 = (await r3.json()) as { setupComplete: boolean };
    expect(b3.setupComplete).toBe(true);
  });
});
