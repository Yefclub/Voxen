// ============================================================================
// Integration tests — transcript source refresh (WEB) and reprocess (X)
// ============================================================================
// Requer Postgres. Skipa se DATABASE_URL não setado.
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { closeRedis } from '../src/lib/redis';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function wipeDb(): Promise<void> {
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
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function completeSetup(): Promise<void> {
  await setSetting('openrouter_api_key', 'sk-or-v1-' + 'x'.repeat(40));
  await setSetting('default_chat_model', 'openrouter/auto');
  await setSetting('default_transcription_model', 'x-ai/grok-stt-1.0');
}

async function createTranscript(input: {
  userId: string;
  source: 'X' | 'WEB' | 'YOUTUBE';
  url: string;
  plainText?: string;
}) {
  return db.transcript.create({
    data: {
      userId: input.userId,
      source: input.source,
      url: input.url,
      title: 'Conteúdo existente',
      durationSec: 0,
      language: 'pt',
      transcriptionMethod: input.source === 'X' ? 'X_SEARCH' : 'SCRAPE',
      mdPath: `workspaces/${input.userId}/transcripts/existing.md`,
      plainText: input.plainText ?? 'Conteúdo existente.',
      frontmatter: {},
    },
  });
}

async function postRefresh(cookie: string, transcriptId: string): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/transcripts/${transcriptId}/refresh`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
}

describeIfDb('transcript refresh and reprocess', () => {
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

  it('POST /api/transcripts/:id/refresh sem session → 401', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/transcripts/none/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('X transcript → ANALYZE_X bound to the existing transcript', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    await completeSetup();
    const user = (await db.user.findUnique({ where: { email: 'admin@voxen.local' } }))!;
    const transcript = await createTranscript({
      userId: user.id,
      source: 'X',
      url: 'https://x.com/i/status/123456789',
    });

    const res = await postRefresh(cookie, transcript.id);

    expect(res.status).toBe(201);
    const jobs = await db.job.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe('ANALYZE_X');
    expect(jobs[0]!.refreshTranscriptId).toBe(transcript.id);
    const updated = await db.transcript.findUnique({ where: { id: transcript.id } });
    expect(updated!.sourceRefreshStatus).toBe('CHECKING');
  });

  it('WEB transcript keeps the SCRAPE_WEB refresh job', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    await completeSetup();
    const user = (await db.user.findUnique({ where: { email: 'admin@voxen.local' } }))!;
    const transcript = await createTranscript({
      userId: user.id,
      source: 'WEB',
      url: 'https://example.com/post',
    });

    const res = await postRefresh(cookie, transcript.id);

    expect(res.status).toBe(201);
    const jobs = await db.job.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe('SCRAPE_WEB');
    expect(jobs[0]!.refreshTranscriptId).toBe(transcript.id);
  });

  it('unsupported source → 404 without creating a job', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    await completeSetup();
    const user = (await db.user.findUnique({ where: { email: 'admin@voxen.local' } }))!;
    const transcript = await createTranscript({
      userId: user.id,
      source: 'YOUTUBE',
      url: 'https://youtu.be/dQw4w9WgXcQ',
    });

    const res = await postRefresh(cookie, transcript.id);

    expect(res.status).toBe(404);
    expect(await db.job.count()).toBe(0);
  });

  it('a second reprocess while one is active → 409', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    await completeSetup();
    const user = (await db.user.findUnique({ where: { email: 'admin@voxen.local' } }))!;
    const transcript = await createTranscript({
      userId: user.id,
      source: 'X',
      url: 'https://x.com/i/status/987654321',
    });

    expect((await postRefresh(cookie, transcript.id)).status).toBe(201);
    const second = await postRefresh(cookie, transcript.id);

    expect(second.status).toBe(409);
    expect(await db.job.count()).toBe(1);
  });
});
