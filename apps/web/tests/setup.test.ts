// ============================================================================
// Integration tests — setup flow (/api/setup)
// ============================================================================
// Cobre os requirements event-driven da spec 000:
//   - admin com key válida → settings cifradas persistem
//   - admin com key inválida → 400 + nada persiste
//   - não-admin → 403
//   - não-autenticado → 401
// ============================================================================

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { encrypt } from '../src/lib/crypto';
import { db } from '../src/lib/db';
import { getMasterKey } from '../src/lib/master-key';
import { getSetting, setSetting, setSettings } from '../src/lib/settings';

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

const VALID_KEY = 'sk-or-v1-' + 'x'.repeat(40);

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let originalFetch: typeof globalThis.fetch;

function installFetchMock(impl: FetchMock): void {
  globalThis.fetch = ((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://openrouter.ai/')) {
      return impl(input, init);
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
}

describeIfDb('setup flow', () => {
  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    await wipeDb();
  });
  beforeEach(async () => {
    await wipeDb();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await wipeDb();
    await db.$disconnect();
  });

  it('admin com key válida persiste settings cifradas e retorna complete=true', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    installFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/v1/key')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{"data":[]}', { status: 200 });
    });

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: VALID_KEY,
          default_chat_model: 'openrouter/auto',
          default_transcription_model: 'openai/whisper-1',
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { complete: boolean };
    expect(body.complete).toBe(true);

    // Settings persistidas, cifradas (valueEnc não vazio, no formato iv.ct.tag).
    const stored = await db.setting.findMany({
      where: { scope: 'GLOBAL', userId: null },
      select: { key: true, valueEnc: true },
    });
    expect(stored).toHaveLength(3);
    for (const s of stored) {
      expect(s.valueEnc.length).toBeGreaterThan(0);
      expect(s.valueEnc.split('.')).toHaveLength(3);
    }

    const statusRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const status = (await statusRes.json()) as {
      complete: boolean;
    };
    expect(status.complete).toBe(true);
  });

  it('onboarding com somente a key persiste automaticamente os modelos recomendados', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    installFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/v1/key')) {
        return new Response('{}', { status: 200 });
      }
      if (url.endsWith('/api/v1/models/user')) {
        return Response.json({
          data: [
            {
              id: 'x-ai/grok-4.5',
              name: 'Grok 4.5',
              architecture: {
                input_modalities: ['text', 'image', 'file'],
                output_modalities: ['text'],
              },
            },
            {
              id: 'x-ai/grok-stt-1.0',
              name: 'Grok STT',
              architecture: {
                input_modalities: ['audio'],
                output_modalities: ['transcription'],
              },
            },
          ],
        });
      }
      return Response.json({ data: [] });
    });

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: VALID_KEY }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(getSetting('default_chat_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_transcription_model')).resolves.toBe('x-ai/grok-stt-1.0');
    await expect(getSetting('default_web_search_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_vision_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_document_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_x_analysis_model')).resolves.toBe('x-ai/grok-4.5');
  });

  it('onboarding não persiste configuração parcial quando um modelo padrão não existe', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    installFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/v1/key')) {
        return new Response('{}', { status: 200 });
      }
      return Response.json({ data: [] });
    });

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: VALID_KEY }),
      }),
    );

    expect(res.status).toBe(422);
    expect(await db.setting.count({ where: { scope: 'GLOBAL' } })).toBe(0);
  });

  it('serializa gravações concorrentes sem duplicar uma chave global', async () => {
    await Promise.all([
      setSettings({ default_chat_model: 'modelo-a' }),
      setSettings({ default_chat_model: 'modelo-b' }),
    ]);

    const rows = await db.setting.findMany({
      where: { scope: 'GLOBAL', userId: null, key: 'default_chat_model' },
    });
    expect(rows).toHaveLength(1);
    await expect(getSetting('default_chat_model')).resolves.toMatch(/^modelo-[ab]$/);

    await expect(
      db.setting.create({
        data: {
          scope: 'GLOBAL',
          userId: null,
          key: 'default_chat_model',
          valueEnc: encrypt('bypass-do-lock', getMasterKey()),
        },
      }),
    ).rejects.toThrow();
  });

  it('admin pode persistir idioma da plataforma', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    installFetchMock(async () => new Response('{}', { status: 200 }));

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          app_language: 'en',
          openrouter_api_key: VALID_KEY,
          default_chat_model: 'openrouter/auto',
          default_transcription_model: 'openai/whisper-1',
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(getSetting('app_language')).resolves.toBe('en');

    const statusRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const status = (await statusRes.json()) as { language: string };
    expect(status.language).toBe('en');
  });

  it('status reconhece aliases legados do modelo de análise do X', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    await setSetting('openrouter_api_key', VALID_KEY);
    await setSetting('default_chat_model', 'openrouter/auto');
    await setSetting('default_transcription_model', 'openai/whisper-1');
    await db.setting.create({
      data: {
        scope: 'GLOBAL',
        key: 'default_grok_model',
        valueEnc: encrypt('x-ai/grok-4-fast', getMasterKey()),
      },
    });

    const statusRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const status = (await statusRes.json()) as { xAnalysisModel: string | null };

    expect(status.xAnalysisModel).toBe('x-ai/grok-4-fast');

    const clearRes = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          default_chat_model: 'openrouter/auto',
          default_transcription_model: 'openai/whisper-1',
          default_x_analysis_model: '',
        }),
      }),
    );
    expect(clearRes.status).toBe(200);

    const clearedStatusRes = await app.fetch(
      new Request('http://localhost/api/setup', { headers: { cookie } }),
    );
    const clearedStatus = (await clearedStatusRes.json()) as { xAnalysisModel: string | null };
    expect(clearedStatus.xAnalysisModel).toBe('x-ai/grok-4.5');
  });

  it('admin com key inválida → 400 PT-BR e nada persiste', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    installFetchMock(async () => new Response('{}', { status: 401 }));

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: VALID_KEY,
          default_chat_model: 'openrouter/auto',
          default_transcription_model: 'openai/whisper-1',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Chave da OpenRouter inválida/i);

    const stored = await db.setting.findMany({ where: { scope: 'GLOBAL' } });
    expect(stored).toHaveLength(0);
  });

  it('user comum em /api/setup → 403', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');

    // Aprova o user pra ele conseguir logar.
    const adminSignin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const adminCookie = extractCookie(adminSignin);
    const pending = await db.user.findUnique({ where: { email: 'user@voxen.local' } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${pending!.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
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

    installFetchMock(async () => new Response('{}', { status: 200 }));
    await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: VALID_KEY,
          default_chat_model: 'openrouter/auto',
          default_transcription_model: 'openai/whisper-1',
        }),
      }),
    );

    const r2 = await app.fetch(new Request('http://localhost/api/me', { headers: { cookie } }));
    const b2 = (await r2.json()) as { setupComplete: boolean };
    expect(b2.setupComplete).toBe(true);
  });
});
