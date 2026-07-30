// ============================================================================
// Integration tests — upload presigned (spec 066)
// ============================================================================
// Requer Postgres + Redis. Skipa se DATABASE_URL não setado.
//
// O presign assina offline (não há chamada de rede ao S3), então o caminho
// feliz é testável sem MinIO. O confirm depende de HeadObject — mockamos o
// módulo s3 para os caminhos que tocam o S3.
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

// Habilita presign para todos os testes deste arquivo.
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000';
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'voxen';
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'voxen_dev_minio_password';

// Mock do HeadObject controlável por teste. Default: objeto de 1 KiB.
let headObjectResult: { ContentLength?: number } | Error = { ContentLength: 1024 };

mock.module('../src/lib/s3', () => {
  return {
    s3Bucket: () => 'voxen-transcripts',
    s3PublicEndpoint: () => process.env.S3_PUBLIC_ENDPOINT,
    presignEnabled: () => Boolean(process.env.S3_PUBLIC_ENDPOINT),
    presignClient: () => ({
      // Stub mínimo que o @aws-sdk/s3-request-presigner consegue assinar.
      config: {
        region: async () => 'us-east-1',
        endpoint: async () => new URL(process.env.S3_PUBLIC_ENDPOINT!),
        credentials: async () => ({ accessKeyId: 'voxen', secretAccessKey: 'secret' }),
      },
      send: async () => {
        throw new Error('presignClient.send não deve ser chamado no presign');
      },
    }),
    s3Client: () => ({
      send: async () => {
        if (headObjectResult instanceof Error) throw headObjectResult;
        return headObjectResult;
      },
    }),
    deleteS3Object: async () => undefined,
  };
});

// Mock do getSignedUrl pra não depender da assinatura real do stub acima.
mock.module('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async () => 'https://s3.example.com/voxen-transcripts/key?X-Amz-Signature=fake',
}));

const { default: app } = await import('../src/index');
const { db } = await import('../src/lib/db');
const { setSetting } = await import('../src/lib/settings');
const { closeRedis } = await import('../src/lib/redis');

async function wipeDb(): Promise<void> {
  await db.costEvent.deleteMany();
  await db.job.deleteMany();
  await db.transcript.deleteMany();
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

async function completeSetup(): Promise<void> {
  await setSetting('openrouter_api_key', 'sk-or-v1-' + 'x'.repeat(40));
  await setSetting('default_chat_model', 'openrouter/auto');
  await setSetting('default_transcription_model', 'x-ai/grok-stt-1.0');
}

async function approvedSession(): Promise<string> {
  await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
  const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
  return extractCookie(signin);
}

async function presign(cookie: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/jobs/upload/presign', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function confirm(cookie: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/jobs/upload/confirm', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describeIfDb('upload presign API', () => {
  beforeAll(async () => {
    await wipeDb();
  });
  beforeEach(async () => {
    await wipeDb();
    headObjectResult = { ContentLength: 1024 };
  });
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
    await closeRedis();
  });

  it('sem session → 401', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/jobs/upload/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: 'a.mp4', contentType: 'video/mp4', size: 100 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('presign com formato não suportado → 400', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    const res = await presign(cookie, {
      filename: 'virus.exe',
      contentType: 'application/octet-stream',
      size: 100,
    });
    expect(res.status).toBe(400);
  });

  it('presign com imagem acima do limite → 413', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    const res = await presign(cookie, {
      filename: 'foto.png',
      contentType: 'image/png',
      size: 21 * 1024 * 1024,
    });
    expect(res.status).toBe(413);
  });

  it('presign de documento sem modelo configurado → 412', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    const res = await presign(cookie, {
      filename: 'relatorio.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    expect(res.status).toBe(412);
  });

  it('presign de mídia válida → key escopada por userId + expiração 300s', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    const me = await db.user.findFirst({ where: { email: 'admin@voxen.local' } });
    const res = await presign(cookie, {
      filename: '../outro/aula.mp4',
      contentType: 'video/mp4',
      size: 10 * 1024 * 1024,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enabled: boolean;
      uploadId: string;
      key: string;
      url: string;
      method: string;
      expiresIn: number;
      sourceUrl: string;
    };
    expect(body.enabled).toBe(true);
    expect(body.method).toBe('PUT');
    expect(body.expiresIn).toBe(300);
    // Key sempre derivada do userId da sessão — nome malicioso é sanitizado.
    expect(body.key.startsWith(`workspaces/${me!.id}/uploads/${body.uploadId}/`)).toBe(true);
    expect(body.key).not.toContain('outro');
    expect(body.key).not.toContain('..');
  });

  it('confirm valida tamanho REAL via HeadObject (objeto grande demais → 413)', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    // Objeto real maior que o limite de mídia.
    headObjectResult = { ContentLength: 600 * 1024 * 1024 };
    const res = await confirm(cookie, {
      uploadId: '123e4567-e89b-12d3-a456-426614174000',
      filename: 'aula.mp4',
      contentType: 'video/mp4',
    });
    expect(res.status).toBe(413);
    // Nenhum job criado.
    expect(await db.job.count()).toBe(0);
  });

  it('confirm com objeto ausente → 400', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    headObjectResult = Object.assign(new Error('not found'), { name: 'NotFound' });
    const res = await confirm(cookie, {
      uploadId: '123e4567-e89b-12d3-a456-426614174000',
      filename: 'aula.mp4',
      contentType: 'video/mp4',
    });
    expect(res.status).toBe(400);
    expect(await db.job.count()).toBe(0);
  });

  it('confirm de mídia válida → 201 + job enfileirado', async () => {
    const cookie = await approvedSession();
    await completeSetup();
    headObjectResult = { ContentLength: 5 * 1024 * 1024 };
    const res = await confirm(cookie, {
      uploadId: '123e4567-e89b-12d3-a456-426614174000',
      filename: 'aula.mp4',
      contentType: 'video/mp4',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobId: string; status: string; kind: string };
    expect(body.kind).toBe('media');
    const job = await db.job.findUnique({ where: { id: body.jobId } });
    expect(job!.type).toBe('UPLOAD_AND_TRANSCRIBE');
    expect(job!.status).toBe('QUEUED');
  });
});
