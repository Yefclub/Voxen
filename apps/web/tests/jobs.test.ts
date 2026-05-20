// ============================================================================
// Integration tests — jobs API (spec 002)
// ============================================================================
// Requer Postgres + Redis. Skipa se DATABASE_URL não setado.
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { closeRedis, getRedisPublisher } from '../src/lib/redis';
import { publishJobEvent } from '../src/lib/job-events';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

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

async function approveUser(email: string, adminCookie: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email } });
  await app.fetch(
    new Request(`http://localhost/api/admin/usuarios/${user!.id}/approve`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
}

async function completeSetup(): Promise<void> {
  // Bypassa o validateApiKey gravando direto no DB cifrado.
  await setSetting('openrouter_api_key', 'sk-or-v1-' + 'x'.repeat(40));
  await setSetting('default_chat_model', 'openrouter/auto');
  await setSetting('default_transcription_model', 'openai/whisper-1');
}

const VALID_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CANONICAL = 'https://youtu.be/dQw4w9WgXcQ';

describeIfDb('jobs API', () => {
  beforeAll(async () => {
    await wipeDb();
  });
  beforeEach(async () => {
    await wipeDb();
  });
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
    await closeRedis();
  });

  it('POST /api/jobs sem session → 401', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/jobs com setup incompleto → 412', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Setup incompleto/i);
  });

  it('POST /api/jobs com URL não-YouTube → 400', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const res = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://vimeo.com/12345' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/YouTube/i);
  });

  it('POST /api/jobs URL válida → 201 + Job criado com canonical URL', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const res = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobId: string; status: string; sourceUrl: string };
    expect(body.status).toBe('QUEUED');
    expect(body.sourceUrl).toBe(CANONICAL);

    const job = await db.job.findUnique({ where: { id: body.jobId } });
    expect(job).not.toBeNull();
    expect(job!.sourceUrl).toBe(CANONICAL);
    expect(job!.status).toBe('QUEUED');
  });

  it('POST /api/jobs duplicado (QUEUED) → 409', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const first = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    expect(first.status).toBe(201);

    const dup = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    expect(dup.status).toBe(409);
    const body = (await dup.json()) as { error: string };
    expect(body.error).toMatch(/já está sendo processada/i);
  });

  it('POST /api/jobs quando já existe Transcript → 409 com transcriptId', async () => {
    const u = await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    expect(u.status).toBe(200);
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const t = await db.transcript.create({
      data: {
        userId: admin.id,
        source: 'YOUTUBE',
        url: CANONICAL,
        title: 'Test',
        durationSec: 60,
        language: 'pt',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `workspaces/${admin.id}/transcripts/test.md`,
        plainText: 'corpo',
        frontmatter: {},
      },
    });

    const res2 = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    expect(res2.status).toBe(409);
    const body = (await res2.json()) as { error: string; transcriptId: string };
    expect(body.transcriptId).toBe(t.id);
  });

  it('POST /api/jobs/scrape URL inválida → 400', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const res = await app.fetch(
      new Request('http://localhost/api/jobs/scrape', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'file:///etc/passwd' }),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/URL inválida/i);
  });

  it('POST /api/jobs/scrape URL válida → 201 + Job SCRAPE_WEB normalizado', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const res = await app.fetch(
      new Request('http://localhost/api/jobs/scrape', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/artigo#secao' }),
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobId: string; status: string; sourceUrl: string };
    expect(body.status).toBe('QUEUED');
    expect(body.sourceUrl).toBe('https://example.com/artigo');
    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.type).toBe('SCRAPE_WEB');
    expect(job.sourceUrl).toBe('https://example.com/artigo');
  });

  it('POST /api/jobs/scrape quando já existe Transcript → 409 com transcriptId', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: admin.id,
        source: 'WEB',
        url: 'https://example.com/artigo',
        title: 'Artigo',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${admin.id}/transcripts/artigo.md`,
        plainText: 'texto',
        frontmatter: {},
      },
    });

    const res = await app.fetch(
      new Request('http://localhost/api/jobs/scrape', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/artigo#outra' }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { transcriptId: string };
    expect(body.transcriptId).toBe(transcript.id);
  });

  it('POST /api/jobs/scrape duplicado ativo → 409 com jobId', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();

    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const job = await db.job.create({
      data: {
        userId: admin.id,
        type: 'SCRAPE_WEB',
        status: 'QUEUED',
        sourceUrl: 'https://example.com/artigo',
      },
    });

    const res = await app.fetch(
      new Request('http://localhost/api/jobs/scrape', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/artigo' }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toBe(job.id);
  });

  it('GET /api/jobs/:id de outro user → 404 (não 403)', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('outro@voxen.local', 'senha-super-segura-456', 'Outro');
    const adminSignin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const adminCookie = extractCookie(adminSignin);
    await completeSetup();
    await approveUser('outro@voxen.local', adminCookie);

    const create = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    const { jobId } = (await create.json()) as { jobId: string };

    const outroSignin = await signIn('outro@voxen.local', 'senha-super-segura-456');
    const outroCookie = extractCookie(outroSignin);
    const r = await app.fetch(
      new Request(`http://localhost/api/jobs/${jobId}`, { headers: { cookie: outroCookie } }),
    );
    expect(r.status).toBe(404);
  });

  it('GET /api/jobs lista apenas jobs do próprio user', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('outro@voxen.local', 'senha-super-segura-456', 'Outro');
    const adminSignin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const adminCookie = extractCookie(adminSignin);
    await completeSetup();
    await approveUser('outro@voxen.local', adminCookie);

    // admin cria 1 job
    await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );

    const outroSignin = await signIn('outro@voxen.local', 'senha-super-segura-456');
    const outroCookie = extractCookie(outroSignin);
    const list = await app.fetch(
      new Request('http://localhost/api/jobs', { headers: { cookie: outroCookie } }),
    );
    const body = (await list.json()) as { jobs: unknown[] };
    expect(body.jobs).toHaveLength(0);
  });

  it('POST /api/jobs/:id/retry preserva tipo original do job', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });

    const failed = await db.job.create({
      data: {
        userId: admin.id,
        type: 'SCRAPE_WEB',
        status: 'FAILED',
        sourceUrl: 'https://example.com/artigo',
        errorMsg: 'falhou',
      },
    });

    const res = await app.fetch(
      new Request(`http://localhost/api/jobs/${failed.id}/retry`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobId: string };
    const retry = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(retry.type).toBe('SCRAPE_WEB');
  });

  it('SSE entrega evento publicado no canal e fecha em stage terminal', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await completeSetup();
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });

    const create = await app.fetch(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: VALID_URL }),
      }),
    );
    const { jobId } = (await create.json()) as { jobId: string };

    const sseRes = await app.fetch(
      new Request(`http://localhost/api/jobs/${jobId}/events`, { headers: { cookie } }),
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toMatch(/event-stream/);

    // Publica evento running, depois done (terminal → server fecha)
    const pub = getRedisPublisher();
    // Dá tempo do subscribe registrar
    await new Promise((r) => setTimeout(r, 100));
    await publishJobEvent(admin.id, { jobId, stage: 'running', percent: 0 }, pub);
    await publishJobEvent(admin.id, { jobId, stage: 'done', percent: 100 }, pub);

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      if (buf.includes('"stage":"done"')) break;
    }
    expect(buf).toContain('"stage":"running"');
    expect(buf).toContain('"stage":"done"');
  });
});
