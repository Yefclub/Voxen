// ============================================================================
// Integration tests — /api/admin/models (spec 123)
// ============================================================================
// Cobre os critérios de aceite da spec 123:
//   - override persiste e aparece na leitura
//   - remover override volta ao canônico
//   - seleção incompatível com a finalidade é rejeitada, sem persistir
//   - catálogo indisponível não apaga overrides já persistidos
//   - rota rejeita não-ADMIN e não-autenticado
// ============================================================================

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { getSetting, setSettings } from '../src/lib/settings';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

const VALID_KEY = 'sk-or-v1-' + 'x'.repeat(40);

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

const CATALOG = [
  {
    id: 'x-ai/grok-4.5',
    name: 'Grok 4.5',
    architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
  },
  {
    id: 'x-ai/grok-stt-1.0',
    name: 'Grok STT',
    architecture: { output_modalities: ['transcription'] },
  },
  {
    id: 'openai/gpt-5-vision',
    name: 'GPT-5 Vision',
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  },
  {
    id: 'openai/gpt-5-file',
    name: 'GPT-5 Documentos',
    architecture: { input_modalities: ['text', 'file'], output_modalities: ['text'] },
  },
  {
    id: 'openai/gpt-5-mini',
    name: 'GPT-5 mini',
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  },
];

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

function installCatalogMock(): void {
  installFetchMock(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/api/v1/key')) return new Response('{}', { status: 200 });
    if (url.endsWith('/api/v1/models/user')) return Response.json({ data: CATALOG });
    return Response.json({ data: [] });
  });
}

async function setupAdmin(): Promise<{ cookie: string }> {
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
  });
  return { cookie };
}

describeIfDb('/api/admin/models', () => {
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

  it('GET / lista as 6 finalidades sem override quando tudo está no canônico', async () => {
    const { cookie } = await setupAdmin();

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models', { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      purposes: Array<{ purpose: string; canonical: string; override: string | null }>;
      hasApiKey: boolean;
    };
    expect(body.hasApiKey).toBe(true);
    expect(body.purposes).toHaveLength(6);
    for (const p of body.purposes) {
      expect(p.override).toBeNull();
    }
  });

  it('PATCH define um override compatível e ele persiste', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/default_vision_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'openai/gpt-5-vision' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { override: string | null };
    expect(body.override).toBe('openai/gpt-5-vision');

    await expect(getSetting('default_vision_model')).resolves.toBe('openai/gpt-5-vision');

    const listRes = await app.fetch(
      new Request('http://localhost/api/admin/models', { headers: { cookie } }),
    );
    const listBody = (await listRes.json()) as {
      purposes: Array<{ purpose: string; override: string | null }>;
    };
    const visionEntry = listBody.purposes.find((p) => p.purpose === 'default_vision_model');
    expect(visionEntry?.override).toBe('openai/gpt-5-vision');
  });

  it('DELETE remove o override e volta ao modelo canônico', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();

    await app.fetch(
      new Request('http://localhost/api/admin/models/default_document_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'openai/gpt-5-file' }),
      }),
    );
    await expect(getSetting('default_document_model')).resolves.toBe('openai/gpt-5-file');

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/default_document_model', {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { override: string | null; canonical: string };
    expect(body.override).toBeNull();
    expect(body.canonical).toBe('x-ai/grok-4.5');

    await expect(getSetting('default_document_model')).resolves.toBe('x-ai/grok-4.5');
  });

  it('PATCH rejeita modelo incompatível com a finalidade e não persiste', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/default_vision_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'openai/gpt-5-mini' }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/não é compatível/i);

    // Nada foi persistido — finalidade continua no canônico.
    await expect(getSetting('default_vision_model')).resolves.toBe('x-ai/grok-4.5');
  });

  it('PATCH rejeita modelo de transcrição na finalidade de análise X', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/default_x_analysis_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'x-ai/grok-stt-1.0' }),
      }),
    );
    expect(res.status).toBe(422);
    await expect(getSetting('default_x_analysis_model')).resolves.toBe('x-ai/grok-4.5');
  });

  it('PATCH rejeita modelo inexistente no catálogo da chave configurada', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/default_chat_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'inexistente/modelo' }),
      }),
    );
    expect(res.status).toBe(404);
    await expect(getSetting('default_chat_model')).resolves.toBe('x-ai/grok-4.5');
  });

  it('GET /catalog/:purpose informa indisponibilidade sem apagar overrides existentes', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();
    await app.fetch(
      new Request('http://localhost/api/admin/models/default_vision_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'openai/gpt-5-vision' }),
      }),
    );

    installFetchMock(async () => new Response('erro interno', { status: 500 }));

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/catalog/default_vision_model', {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(502);

    // Override anterior segue intacto — falha de leitura do catálogo não apaga nada.
    await expect(getSetting('default_vision_model')).resolves.toBe('openai/gpt-5-vision');
  });

  it('GET /catalog/:purpose filtra o catálogo pela compatibilidade da finalidade', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();

    const res = await app.fetch(
      new Request('http://localhost/api/admin/models/catalog/default_transcription_model', {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<{ id: string }> };
    expect(body.models.map((m) => m.id)).toEqual(['x-ai/grok-stt-1.0']);
  });

  it('trocar a chave (POST /api/setup) não apaga overrides já persistidos', async () => {
    const { cookie } = await setupAdmin();
    installCatalogMock();
    await app.fetch(
      new Request('http://localhost/api/admin/models/default_vision_model', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'openai/gpt-5-vision' }),
      }),
    );
    await expect(getSetting('default_vision_model')).resolves.toBe('openai/gpt-5-vision');

    const res = await app.fetch(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: 'sk-or-v1-' + 'y'.repeat(40) }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(getSetting('default_vision_model')).resolves.toBe('openai/gpt-5-vision');
  });

  it('não-ADMIN recebe 403 em qualquer endpoint da rota', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
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
      new Request('http://localhost/api/admin/models', { headers: { cookie: userCookie } }),
    );
    expect(res.status).toBe(403);
  });

  it('não-autenticado recebe 401', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/models'));
    expect(res.status).toBe(401);
  });
});
