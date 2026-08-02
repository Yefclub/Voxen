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
import type { OrModel } from '../src/lib/openrouter';
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

const VALID_KEY = 'sk-or-v1-' + 'x'.repeat(40);
const REPLACEMENT_KEY = 'sk-or-v1-' + 'y'.repeat(40);

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

const CANONICAL_MODELS: OrModel[] = [
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
      output_modalities: ['transcription'],
    },
  },
];

function installValidOpenRouterMock(models = CANONICAL_MODELS): void {
  installFetchMock(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/api/v1/key')) {
      return new Response('{}', { status: 200 });
    }
    if (url.endsWith('/api/v1/models/user')) {
      return Response.json({
        data: models,
      });
    }
    return Response.json({ data: [] });
  });
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

    installValidOpenRouterMock();

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: VALID_KEY }),
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
    expect(stored).toHaveLength(7);
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

    installValidOpenRouterMock();

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

  it('rejeita overrides manuais de modelo no contrato unificado', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: VALID_KEY,
          default_chat_model: 'custom/chat',
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await db.setting.count({ where: { scope: 'GLOBAL' } })).toBe(0);
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
      setSettings({
        openrouter_api_key: VALID_KEY,
        default_chat_model: 'modelo-a',
        app_language: 'en',
        app_timezone: 'UTC',
      }),
      setSettings({
        openrouter_api_key: REPLACEMENT_KEY,
        default_chat_model: 'modelo-b',
        app_language: 'pt-BR',
        app_timezone: 'America/Sao_Paulo',
      }),
    ]);

    const rows = await db.setting.findMany({
      where: { scope: 'GLOBAL', userId: null, key: 'default_chat_model' },
    });
    expect(rows).toHaveLength(1);
    const persisted = await getSettings([
      'openrouter_api_key',
      'default_chat_model',
      'app_language',
      'app_timezone',
    ] as const);
    const possibleBundles: Array<Record<keyof typeof persisted, string | null>> = [
      {
        openrouter_api_key: VALID_KEY,
        default_chat_model: 'modelo-a',
        app_language: 'en',
        app_timezone: 'UTC',
      },
      {
        openrouter_api_key: REPLACEMENT_KEY,
        default_chat_model: 'modelo-b',
        app_language: 'pt-BR',
        app_timezone: 'America/Sao_Paulo',
      },
    ];
    expect(possibleBundles).toContainEqual(persisted);

    const duplicateWrite = Promise.resolve(
      db.setting.create({
        data: {
          scope: 'GLOBAL',
          userId: null,
          key: 'default_chat_model',
          valueEnc: encrypt('bypass-do-lock', getMasterKey()),
        },
      }),
    );
    await expect(duplicateWrite).rejects.toThrow();
  });

  it('admin pode atualizar idioma e fuso sem reenviar a chave', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    await setSetting('openrouter_api_key', VALID_KEY);
    installFetchMock(async () => {
      throw new Error('preferências não devem chamar a OpenRouter');
    });

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

  it('não persiste preferências antes da primeira chave válida', async () => {
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

    expect(res.status).toBe(400);
    await expect(getSetting('app_language')).resolves.toBeNull();
    await expect(getSetting('app_timezone')).resolves.toBeNull();
    await expect(getSetting('openrouter_api_key')).resolves.toBeNull();
  });

  it('trocar a chave mantém os modelos canônicos quando não havia override', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    await setSettings({
      openrouter_api_key: VALID_KEY,
      default_chat_model: 'x-ai/grok-4.5',
      default_transcription_model: 'x-ai/grok-stt-1.0',
      default_web_search_model: 'x-ai/grok-4.5',
      default_vision_model: 'x-ai/grok-4.5',
      default_document_model: 'x-ai/grok-4.5',
      default_x_analysis_model: 'x-ai/grok-4.5',
      app_language: 'pt-BR',
      app_timezone: 'America/Sao_Paulo',
    });
    installValidOpenRouterMock();

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: REPLACEMENT_KEY,
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(getSetting('openrouter_api_key')).resolves.toBe(REPLACEMENT_KEY);
    await expect(getSetting('default_chat_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_transcription_model')).resolves.toBe('x-ai/grok-stt-1.0');
    await expect(getSetting('default_web_search_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_vision_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_document_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('default_x_analysis_model')).resolves.toBe('x-ai/grok-4.5');
    await expect(getSetting('app_language')).resolves.toBe('en');
    await expect(getSetting('app_timezone')).resolves.toBe('UTC');
  });

  it('recusa troca quando um override não está no catálogo da nova chave sem persistir nada', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const previous = {
      openrouter_api_key: VALID_KEY,
      default_chat_model: 'custom/indisponivel',
      default_transcription_model: 'x-ai/grok-stt-1.0',
      default_web_search_model: 'x-ai/grok-4.5',
      default_vision_model: 'x-ai/grok-4.5',
      default_document_model: 'x-ai/grok-4.5',
      default_x_analysis_model: 'x-ai/grok-4.5',
      app_language: 'pt-BR',
      app_timezone: 'America/Sao_Paulo',
    } as const;
    await setSettings(previous);
    installValidOpenRouterMock();

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: REPLACEMENT_KEY,
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      incompatible: Array<{
        purpose: string;
        modelId: string;
        reason: string;
        compatibleModels: Array<{ id: string; name: string }>;
      }>;
    };
    expect(body.incompatible).toContainEqual({
      purpose: 'default_chat_model',
      modelId: 'custom/indisponivel',
      reason: 'unavailable',
      compatibleModels: [{ id: 'x-ai/grok-4.5', name: 'Grok 4.5' }],
    });
    await expect(
      getSettings(Object.keys(previous) as Array<keyof typeof previous>),
    ).resolves.toEqual(previous);
  });

  it('recusa modalidade incompatível e oferece substituições compatíveis', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await setSettings({
      openrouter_api_key: VALID_KEY,
      default_chat_model: 'x-ai/grok-4.5',
      default_transcription_model: 'x-ai/grok-stt-1.0',
      default_web_search_model: 'x-ai/grok-4.5',
      default_vision_model: 'custom/sem-imagem',
      default_document_model: 'x-ai/grok-4.5',
      default_x_analysis_model: 'x-ai/grok-4.5',
    });
    installValidOpenRouterMock([
      ...CANONICAL_MODELS,
      {
        id: 'custom/sem-imagem',
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      },
      {
        id: 'openai/vision-compativel',
        name: 'Vision compatível',
        architecture: { input_modalities: ['image'], output_modalities: ['text'] },
      },
    ]);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: REPLACEMENT_KEY }),
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      incompatible: Array<{
        purpose: string;
        modelId: string;
        reason: string;
        compatibleModels: Array<{ id: string; name: string }>;
      }>;
    };
    expect(body.incompatible).toContainEqual({
      purpose: 'default_vision_model',
      modelId: 'custom/sem-imagem',
      reason: 'incompatible',
      compatibleModels: [
        { id: 'x-ai/grok-4.5', name: 'Grok 4.5' },
        { id: 'openai/vision-compativel', name: 'Vision compatível' },
      ],
    });
    await expect(getSetting('openrouter_api_key')).resolves.toBe(VALID_KEY);
    await expect(getSetting('default_vision_model')).resolves.toBe('custom/sem-imagem');
  });

  it('persiste nova chave e substituições compatíveis na mesma operação', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await setSettings({
      openrouter_api_key: VALID_KEY,
      default_chat_model: 'custom/indisponivel',
      default_transcription_model: 'x-ai/grok-stt-1.0',
      default_web_search_model: 'x-ai/grok-4.5',
      default_vision_model: 'x-ai/grok-4.5',
      default_document_model: 'x-ai/grok-4.5',
      default_x_analysis_model: 'x-ai/grok-4.5',
      app_language: 'pt-BR',
      app_timezone: 'America/Sao_Paulo',
    });
    installValidOpenRouterMock([
      ...CANONICAL_MODELS,
      {
        id: 'openai/chat-compativel',
        name: 'Chat compatível',
        architecture: { output_modalities: ['text'] },
      },
    ]);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: REPLACEMENT_KEY,
          model_replacements: { default_chat_model: 'openai/chat-compativel' },
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(getSetting('openrouter_api_key')).resolves.toBe(REPLACEMENT_KEY);
    await expect(getSetting('default_chat_model')).resolves.toBe('openai/chat-compativel');
    await expect(getSetting('app_language')).resolves.toBe('en');
    await expect(getSetting('app_timezone')).resolves.toBe('UTC');
  });

  // Spec 123, critério de aceite: "Trocar a chave da OpenRouter não apaga
  // overrides existentes." — revalidar/trocar a chave NUNCA reseta
  // silenciosamente uma finalidade sobrescrita manualmente pelo admin de
  // volta ao canônico.
  it('trocar a chave preserva overrides de modelo configurados manualmente', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    await setSettings({
      openrouter_api_key: VALID_KEY,
      default_chat_model: 'custom/chat',
      default_transcription_model: 'custom/stt',
      default_web_search_model: 'custom/web',
      default_vision_model: 'custom/vision',
      default_document_model: 'custom/document',
      default_x_analysis_model: 'custom/x',
      app_language: 'pt-BR',
      app_timezone: 'America/Sao_Paulo',
    });
    installValidOpenRouterMock([
      { id: 'custom/chat', architecture: { output_modalities: ['text'] } },
      { id: 'custom/stt', architecture: { output_modalities: ['transcription'] } },
      { id: 'custom/web', architecture: { output_modalities: ['text'] } },
      {
        id: 'custom/vision',
        architecture: { input_modalities: ['image'], output_modalities: ['text'] },
      },
      {
        id: 'custom/document',
        architecture: { input_modalities: ['file'], output_modalities: ['text'] },
      },
      { id: 'custom/x', name: 'Grok custom', architecture: { output_modalities: ['text'] } },
    ]);

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: REPLACEMENT_KEY,
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(getSetting('openrouter_api_key')).resolves.toBe(REPLACEMENT_KEY);
    await expect(getSetting('default_chat_model')).resolves.toBe('custom/chat');
    await expect(getSetting('default_transcription_model')).resolves.toBe('custom/stt');
    await expect(getSetting('default_web_search_model')).resolves.toBe('custom/web');
    await expect(getSetting('default_vision_model')).resolves.toBe('custom/vision');
    await expect(getSetting('default_document_model')).resolves.toBe('custom/document');
    await expect(getSetting('default_x_analysis_model')).resolves.toBe('custom/x');
    await expect(getSetting('app_language')).resolves.toBe('en');
    await expect(getSetting('app_timezone')).resolves.toBe('UTC');
  });

  it('key inválida preserva chave, modelos, idioma e fuso anteriores', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    await setSettings({
      openrouter_api_key: REPLACEMENT_KEY,
      default_chat_model: 'custom/chat',
      app_language: 'pt-BR',
      app_timezone: 'America/Sao_Paulo',
    });
    installFetchMock(async () => new Response('{}', { status: 401 }));

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: VALID_KEY,
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Chave da OpenRouter inválida/i);

    await expect(getSetting('openrouter_api_key')).resolves.toBe(REPLACEMENT_KEY);
    await expect(getSetting('default_chat_model')).resolves.toBe('custom/chat');
    await expect(getSetting('app_language')).resolves.toBe('pt-BR');
    await expect(getSetting('app_timezone')).resolves.toBe('America/Sao_Paulo');
  });

  it('falha ao consumir o catálogo preserva toda a configuração anterior', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const previousKeys = [
      'openrouter_api_key',
      'default_chat_model',
      'default_transcription_model',
      'default_web_search_model',
      'default_vision_model',
      'default_document_model',
      'default_x_analysis_model',
      'app_language',
      'app_timezone',
    ] as const;
    const previous = {
      openrouter_api_key: REPLACEMENT_KEY,
      default_chat_model: 'custom/chat',
      default_transcription_model: 'custom/stt',
      default_web_search_model: 'custom/web',
      default_vision_model: 'custom/vision',
      default_document_model: 'custom/document',
      default_x_analysis_model: 'custom/x',
      app_language: 'pt-BR',
      app_timezone: 'America/Sao_Paulo',
    } as const;
    await setSettings(previous);
    installFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/v1/key')) {
        return new Response('{}', { status: 200 });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(
              new DOMException(
                'Cliente-Acme-Fusao-Secreta.pdf Bearer sk-or-private',
                'TimeoutError',
              ),
            );
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          openrouter_api_key: VALID_KEY,
          app_language: 'en',
          app_timezone: 'UTC',
        }),
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/OpenRouter|tente novamente/i);
    expect(body.error).not.toContain('Cliente-Acme');
    expect(body.error).not.toContain('sk-or-private');
    await expect(getSettings(previousKeys)).resolves.toEqual(previous);
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

    installValidOpenRouterMock();
    await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: VALID_KEY }),
      }),
    );

    const r2 = await app.fetch(new Request('http://localhost/api/me', { headers: { cookie } }));
    const b2 = (await r2.json()) as { setupComplete: boolean };
    expect(b2.setupComplete).toBe(true);
  });
});
