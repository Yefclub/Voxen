import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { setSettings } from '../src/lib/settings';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const KEY = 'sk-or-v1-' + 'x'.repeat(40);

let originalFetch: typeof globalThis.fetch;
let probeRequests = 0;

function installCatalogMock(): void {
  globalThis.fetch = ((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://openrouter.ai/')) return originalFetch(input, init);
    if (url.endsWith('/api/v1/models/user')) {
      return Promise.resolve(
        Response.json({
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
              architecture: { output_modalities: ['transcription'] },
            },
          ],
        }),
      );
    }
    if (init?.method === 'POST') probeRequests += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof globalThis.fetch;
}

function cookie(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function createAdmin(): Promise<{ id: string; cookie: string }> {
  const email = 'admin-ai-health@voxen.local';
  const password = 'senha-super-segura-123';
  await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Admin' }),
    }),
  );
  const login = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await setSettings({
    openrouter_api_key: KEY,
    default_chat_model: 'x-ai/grok-4.5',
    default_transcription_model: 'x-ai/grok-stt-1.0',
    default_web_search_model: 'x-ai/grok-4.5',
    default_vision_model: 'x-ai/grok-4.5',
    default_document_model: 'x-ai/grok-4.5',
    default_x_analysis_model: 'x-ai/grok-4.5',
  });
  return { id: user.id, cookie: cookie(login) };
}

describeIfDb('/api/admin/ai-health', () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    probeRequests = 0;
    await db.costEvent.deleteMany();
    await db.configRevision.deleteMany();
    await db.setting.deleteMany();
    await db.session.deleteMany();
    await db.account.deleteMany();
    await db.verification.deleteMany();
    await db.user.deleteMany();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await db.costEvent.deleteMany();
    await db.configRevision.deleteMany();
    await db.setting.deleteMany();
    await db.$disconnect();
  });

  it('expõe sete capacidades e métricas agregadas sem vazar a chave', async () => {
    const admin = await createAdmin();
    installCatalogMock();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const visionJob = await db.job.create({
      data: {
        userId: admin.id,
        type: 'UPLOAD_AND_ANALYZE_IMAGE',
        sourceUrl: 'upload://health-check.png',
        status: 'DONE',
        startedAt,
        finishedAt: new Date('2026-01-01T00:00:01.500Z'),
      },
    });
    await db.costEvent.create({
      data: {
        userId: admin.id,
        kind: 'CHAT',
        model: 'x-ai/grok-4.5',
        tokensIn: 10,
        tokensOut: 5,
        costUsd: '0.012',
      },
    });
    await db.costEvent.create({
      data: {
        userId: admin.id,
        kind: 'CHAT',
        model: 'x-ai/grok-4.5',
        tokensIn: 4,
        tokensOut: 2,
        costUsd: '0.003',
        jobId: visionJob.id,
        meta: { source: 'image_upload' },
      },
    });

    const response = await app.fetch(
      new Request('http://localhost/api/admin/ai-health', { headers: { cookie: admin.cookie } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      capabilities: Array<{
        id: string;
        availability: string;
        metrics: { events: number; costUsd: number; latencyMs: number | null };
      }>;
    };
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body.capabilities).toHaveLength(7);
    expect(body.capabilities.find((item) => item.id === 'chat')).toMatchObject({
      availability: 'ACTIVE',
      metrics: { events: 1, costUsd: 0.012 },
    });
    expect(body.capabilities.find((item) => item.id === 'vision')).toMatchObject({
      availability: 'ACTIVE',
      metrics: { events: 1, costUsd: 0.003, latencyMs: 1500 },
    });
    expect(body.capabilities.find((item) => item.id === 'embeddings')?.availability).toBe(
      'INACTIVE',
    );
    const publicCapabilities = await app.fetch(new Request('http://localhost/api/capabilities'));
    const publicBody = (await publicCapabilities.json()) as { active: string[] };
    expect(publicBody.active).toContain('vision');
    expect(publicBody.active).not.toContain('embeddings');
    expect(JSON.stringify(publicBody)).not.toContain('grok-4.5');
    expect(JSON.stringify(publicBody)).not.toContain(KEY);
  });

  it('verifica uma capacidade sem criar conteúdo, evento de custo ou revisão', async () => {
    const admin = await createAdmin();
    installCatalogMock();
    const before = await Promise.all([
      db.note.count(),
      db.transcript.count(),
      db.costEvent.count(),
      db.configRevision.count(),
    ]);

    const response = await app.fetch(
      new Request('http://localhost/api/admin/ai-health/test', {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ capability: 'vision' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capability: 'vision', ok: true });
    expect(probeRequests).toBe(1);
    await expect(
      Promise.all([
        db.note.count(),
        db.transcript.count(),
        db.costEvent.count(),
        db.configRevision.count(),
      ]),
    ).resolves.toEqual(before);
  });

  it('simula modelo incompatível sem alterar a configuração', async () => {
    const admin = await createAdmin();
    installCatalogMock();
    const response = await app.fetch(
      new Request('http://localhost/api/admin/ai-health/impact', {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ capability: 'vision', modelId: 'x-ai/grok-stt-1.0' }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      compatible: false,
      affectedCapabilities: ['vision'],
    });
  });

  it('rejeita acesso não autenticado', async () => {
    const response = await app.fetch(new Request('http://localhost/api/admin/ai-health'));
    expect(response.status).toBe(401);
  });

  it('não expõe saúde, modelos ou métricas para usuário comum', async () => {
    const admin = await createAdmin();
    const email = 'user-ai-health@voxen.local';
    const password = 'senha-super-segura-456';
    await app.fetch(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'User' }),
      }),
    );
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${user.id}/approve`, {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const login = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    const response = await app.fetch(
      new Request('http://localhost/api/admin/ai-health', { headers: { cookie: cookie(login) } }),
    );
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(KEY);
  });
});
