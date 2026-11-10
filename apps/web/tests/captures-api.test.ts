import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiRole, CaptureDeps } from '../src/lib/capture/runner';

const storageRoot = mkdtempSync(join(tmpdir(), 'voxen-captures-api-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = storageRoot;

const { default: app } = await import('../src/index');
const { db } = await import('../src/lib/db');
const { setCaptureDepsForTests } = await import('../src/lib/capture/deps');

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

const roles = new Set<AiRole>();
const deps: CaptureDeps = {
  worker: {
    extract: async () => {
      throw new Error('the API must never fetch or extract');
    },
    audio: async () => {
      throw new Error('unused');
    },
    frames: async () => {
      throw new Error('unused');
    },
    file: async () => {
      throw new Error('unused');
    },
  },
  ai: {
    isRoleConfigured: async (_userId, role) => roles.has(role),
    chainLength: async (_userId, role) => (roles.has(role) ? 1 : 0),
    sttAudioFormat: async () => 'mp3',
    generateStructured: async () => {
      throw new Error('unused');
    },
    transcribeAudio: async () => {
      throw new Error('unused');
    },
  },
};

async function call(path: string, init: RequestInit & { cookie: string }): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', init.cookie);
  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }));
}

async function signedInUser(email: string): Promise<{ cookie: string; userId: string }> {
  const password = 'senha-super-segura-123';
  await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: email.split('@')[0] }),
    }),
  );
  const user = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
  const res = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { cookie, userId: user.id };
}

function postUrl(cookie: string, url: unknown): Promise<Response> {
  return call('/api/captures', {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

describeIfDb('capture API', () => {
  let a: { cookie: string; userId: string };
  let b: { cookie: string; userId: string };
  const stamp = Date.now();

  beforeAll(async () => {
    setCaptureDepsForTests(deps);
    a = await signedInUser(`capture-a-${stamp}@voxen.local`);
    b = await signedInUser(`capture-b-${stamp}@voxen.local`);
  });

  beforeEach(async () => {
    roles.clear();
    roles.add('standard');
    await db.job.deleteMany({ where: { userId: { in: [a.userId, b.userId] } } });
  });

  afterAll(async () => {
    setCaptureDepsForTests(null);
    await db.user
      .deleteMany({ where: { id: { in: [a.userId, b.userId] } } })
      .catch(() => undefined);
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('requires a session', async () => {
    const res = await app.fetch(new Request('http://localhost/api/captures'));
    expect(res.status).toBe(401);
  });

  it('rejects private and invalid URLs synchronously without creating a job', async () => {
    for (const url of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://169.254.169.254/']) {
      const res = await postUrl(a.cookie, url);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'BLOCKED_ADDRESS',
      );
    }
    const invalid = await postUrl(a.cookie, 'ftp://example.com/x');
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('INVALID_URL');
    expect(await db.job.count({ where: { userId: a.userId } })).toBe(0);
  });

  it('returns 409 AI_NOT_CONFIGURED with a settings link when no text role exists', async () => {
    roles.clear();
    const res = await postUrl(a.cookie, 'https://example.com/no-key');
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; settingsUrl: string; action: string };
    };
    expect(body.error).toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      settingsUrl: '/conta/ia',
      action: 'configure_ai',
    });
    expect(await db.job.count({ where: { userId: a.userId } })).toBe(0);
  });

  it('creates a job once and dedupes equivalent URLs while active', async () => {
    const first = await postUrl(a.cookie, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc');
    expect(first.status).toBe(202);
    const created = (await first.json()) as { job: { id: string; status: string } };
    expect(created.job.status).toBe('QUEUED');
    const again = await postUrl(a.cookie, 'https://youtu.be/dQw4w9WgXcQ');
    expect(again.status).toBe(200);
    expect((await again.json()) as { job: { id: string }; deduped: boolean }).toMatchObject({
      job: { id: created.job.id },
      deduped: true,
    });
    const job = await db.job.findUniqueOrThrow({ where: { id: created.job.id } });
    expect(job.sourceUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('returns the existing document instead of duplicating, even without a key', async () => {
    roles.clear();
    const doc = await db.transcript.create({
      data: {
        userId: a.userId,
        source: 'X',
        url: 'https://x.com/i/status/2087524884410736840',
        title: 'Post existente',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'workspaces/x/transcripts/y.md',
        plainText: 'texto',
        frontmatter: {},
      },
    });
    const res = await postUrl(a.cookie, 'https://twitter.com/foo/status/2087524884410736840?s=20');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      existing: true,
      transcript: { id: doc.id, title: 'Post existente' },
    });
    await db.transcript.delete({ where: { id: doc.id } });
  });

  it('isolates captures between users', async () => {
    const res = await postUrl(a.cookie, 'https://example.com/private-a');
    const { job } = (await res.json()) as { job: { id: string } };
    expect((await call(`/api/captures/${job.id}`, { cookie: b.cookie })).status).toBe(404);
    expect(
      (await call(`/api/captures/${job.id}/cancel`, { cookie: b.cookie, method: 'POST' })).status,
    ).toBe(404);
    expect(
      (await call(`/api/captures/${job.id}/retry`, { cookie: b.cookie, method: 'POST' })).status,
    ).toBe(404);
    const list = (await (await call('/api/captures', { cookie: b.cookie })).json()) as {
      captures: unknown[];
    };
    expect(list.captures).toEqual([]);
  });

  it('cancels an active capture and retries it on the same row with attempt reset', async () => {
    const res = await postUrl(a.cookie, 'https://example.com/cancel-retry');
    const { job } = (await res.json()) as { job: { id: string } };
    const cancelled = await call(`/api/captures/${job.id}/cancel`, {
      cookie: a.cookie,
      method: 'POST',
    });
    expect(cancelled.status).toBe(200);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('CANCELLED');
    await db.job.update({ where: { id: job.id }, data: { attempt: 3 } });
    const retried = await call(`/api/captures/${job.id}/retry`, {
      cookie: a.cookie,
      method: 'POST',
    });
    expect(retried.status).toBe(202);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'QUEUED', attempt: 0, captureErrorCode: null });
  });

  it('retry clears the purge marker and refuses an upload whose file expired', async () => {
    const res = await postUrl(a.cookie, 'https://example.com/purged-link');
    const { job } = (await res.json()) as { job: { id: string } };
    await db.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', captureMeta: { artifactPurged: true, platform: 'web' } },
    });
    expect(
      (await call(`/api/captures/${job.id}/retry`, { cookie: a.cookie, method: 'POST' })).status,
    ).toBe(202);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect((row.captureMeta as Record<string, unknown>).artifactPurged).toBeUndefined();

    const upload = await db.job.create({
      data: {
        userId: a.userId,
        type: 'CAPTURE_UPLOAD',
        status: 'FAILED',
        sourceUrl: 'upload://00000000-0000-4000-8000-000000000001/x.mp3',
        captureMeta: {
          artifactPurged: true,
          upload: { objectKey: 'gone', filename: 'x.mp3', mimeType: 'audio/mpeg' },
        },
      },
    });
    const refused = await call(`/api/captures/${upload.id}/retry`, {
      cookie: a.cookie,
      method: 'POST',
    });
    expect(refused.status).toBe(409);
  });

  it('reprocess queues a refresh job only for the owner', async () => {
    const doc = await db.transcript.create({
      data: {
        userId: a.userId,
        source: 'WEB',
        url: 'https://github.com/jgraph/drawio-react',
        title: 'drawio-react',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'workspaces/x/transcripts/z.md',
        plainText: 'texto',
        frontmatter: {},
      },
    });
    expect(
      (await call(`/api/captures/reprocess/${doc.id}`, { cookie: b.cookie, method: 'POST' }))
        .status,
    ).toBe(404);
    const res = await call(`/api/captures/reprocess/${doc.id}`, {
      cookie: a.cookie,
      method: 'POST',
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string; reprocessOf: string } };
    expect(job.reprocessOf).toBe(doc.id);
    await db.job.deleteMany({ where: { refreshTranscriptId: doc.id } });
    await db.transcript.delete({ where: { id: doc.id } });
  });

  it('rejects unsupported uploads with 415', async () => {
    const form = new FormData();
    form.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'malware.exe', { type: 'application/x-msdownload' }),
    );
    const res = await call('/api/captures/upload', {
      cookie: a.cookie,
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(415);
  });

  it('accepts a text upload and queues a CAPTURE_UPLOAD job', async () => {
    const form = new FormData();
    form.set('file', new File(['# Nota\n\nConteúdo'], 'nota.md', { type: 'text/markdown' }));
    const res = await call('/api/captures/upload', {
      cookie: a.cookie,
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string; kind: string; filename: string } };
    expect(job).toMatchObject({ kind: 'upload', filename: 'nota.md' });
  });

  it('resumes SSE after Last-Event-ID without repeating earlier events', async () => {
    const res = await postUrl(a.cookie, 'https://example.com/sse-resume');
    const { job } = (await res.json()) as { job: { id: string } };
    const first = await db.jobProgressEvent.findFirstOrThrow({ where: { jobId: job.id } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.jobProgressEvent.create({
      data: { jobId: job.id, userId: a.userId, stage: 'extracting', percent: 10 },
    });
    await db.job.update({ where: { id: job.id }, data: { status: 'DONE' } });
    const stream = await call(`/api/captures/${job.id}/events`, {
      cookie: a.cookie,
      headers: { 'last-event-id': first.id },
    });
    const text = await stream.text();
    expect(text).not.toContain(`id: ${first.id}`);
    expect(text).toContain('"stage":"extracting"');
  });

  it('does not replay the previous attempt after a retry', async () => {
    const res = await postUrl(a.cookie, 'https://example.com/retry-replay');
    const { job } = (await res.json()) as { job: { id: string } };
    await db.jobProgressEvent.create({
      data: { jobId: job.id, userId: a.userId, stage: 'failed' },
    });
    await db.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', captureErrorCode: 'NO_TEXT' },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      (await call(`/api/captures/${job.id}/retry`, { cookie: a.cookie, method: 'POST' })).status,
    ).toBe(202);
    await db.jobProgressEvent.create({
      data: { jobId: job.id, userId: a.userId, stage: 'extracting', percent: 10 },
    });
    await db.job.update({ where: { id: job.id }, data: { status: 'DONE' } });
    const text = await (await call(`/api/captures/${job.id}/events`, { cookie: a.cookie })).text();
    expect(text).not.toContain('"stage":"failed"');
    expect(text).toContain('"stage":"extracting"');
  });

  it('rejects non-web ports as INVALID_URL and keeps blocking private hosts', async () => {
    const port = await postUrl(a.cookie, 'https://example.com:8443/x');
    expect(port.status).toBe(400);
    expect(((await port.json()) as { error: { code: string } }).error.code).toBe('INVALID_URL');
  });

  it('rejects office documents with 415 even though the library accepts them', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([80, 75, 3, 4])], 'planilha.xlsx'));
    const res = await call('/api/captures/upload', {
      cookie: a.cookie,
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(415);
  });

  it('normalizes an octet-stream upload type from its extension', async () => {
    const form = new FormData();
    form.set(
      'file',
      new File([new Uint8Array([0xff, 0xfb, 0x90])], 'voz.mp3', {
        type: 'application/octet-stream',
      }),
    );
    const res = await call('/api/captures/upload', {
      cookie: a.cookie,
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string } };
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect((row.captureMeta as { upload: { mimeType: string } }).upload.mimeType).toBe(
      'audio/mpeg',
    );
  });

  it('replays persisted progress events over SSE and closes on a terminal state', async () => {
    const res = await postUrl(a.cookie, 'https://example.com/sse');
    const { job } = (await res.json()) as { job: { id: string } };
    await db.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', captureErrorCode: 'NO_TEXT' },
    });
    await db.jobProgressEvent.create({
      data: { jobId: job.id, userId: a.userId, stage: 'failed' },
    });
    const stream = await call(`/api/captures/${job.id}/events`, { cookie: a.cookie });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const text = await stream.text();
    expect(text).toContain('"stage":"queued"');
    expect(text).toContain('"stage":"failed"');
    expect(text).toContain('"code":"NO_TEXT"');
  });
});
