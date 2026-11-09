import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiRole, CaptureDeps } from '../src/lib/capture/runner';

// The capture deps module imports the AI client from the providers delivery
// (spec 220, PR 2). Until that module exists in this tree, give the import a
// stub so the app can load; the test seam below replaces it at runtime anyway.
if (!existsSync(join(import.meta.dir, '../src/lib/ai/client.ts'))) {
  mock.module('../src/lib/ai/client', () => ({
    resolveRole: async () => {
      throw Object.assign(new Error('stub'), { code: 'AI_NOT_CONFIGURED' });
    },
    generateStructured: async () => {
      throw new Error('stub');
    },
    transcribeAudio: async () => {
      throw new Error('stub');
    },
  }));
}

const storageRoot = mkdtempSync(join(tmpdir(), 'voxen-share-target-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = storageRoot;

const { extractSharedUrl } = await import('../src/routes/share-target');
const { default: app } = await import('../src/index');
const { db } = await import('../src/lib/db');
const { setCaptureDepsForTests } = await import('../src/lib/capture/deps');

describe('extractSharedUrl', () => {
  it('prefers the url field', () => {
    expect(
      extractSharedUrl({ url: 'https://example.com/a', text: 'see https://example.com/b' }),
    ).toBe('https://example.com/a');
  });

  it('finds the link inside Android share text (YouTube, TikTok, Instagram, X)', () => {
    expect(
      extractSharedUrl({ title: 'Rick Astley', text: 'https://youtu.be/dQw4w9WgXcQ?si=abc123' }),
    ).toBe('https://youtu.be/dQw4w9WgXcQ?si=abc123');
    expect(
      extractSharedUrl({
        text: "Check out Ana's video! #tiktok https://vm.tiktok.com/ZMabc123/",
      }),
    ).toBe('https://vm.tiktok.com/ZMabc123/');
    expect(
      extractSharedUrl({ text: 'https://www.instagram.com/reel/C8abcDEF/?igsh=MTc4eHo=' }),
    ).toBe('https://www.instagram.com/reel/C8abcDEF/?igsh=MTc4eHo=');
    expect(
      extractSharedUrl({
        text: 'Thread on capture (https://x.com/someone/status/2087524884410736840?s=20).',
      }),
    ).toBe('https://x.com/someone/status/2087524884410736840?s=20');
  });

  it('falls back to the title and ignores non-http schemes', () => {
    expect(extractSharedUrl({ text: 'no link here', title: 'http://example.org/t' })).toBe(
      'http://example.org/t',
    );
    expect(extractSharedUrl({ url: 'ftp://example.com/x', text: 'javascript:alert(1)' })).toBe(
      null,
    );
    expect(extractSharedUrl({})).toBe(null);
  });
});

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describeIfDb('POST /share-target', () => {
  const roles = new Set<AiRole>();
  const deps: CaptureDeps = {
    worker: {
      extract: async () => {
        throw new Error('the share target must never fetch or extract');
      },
      audio: async () => {
        throw new Error('unused');
      },
      file: async () => {
        throw new Error('unused');
      },
    },
    ai: {
      isRoleConfigured: async (_userId, role) => roles.has(role),
      generateStructured: async () => {
        throw new Error('unused');
      },
      transcribeAudio: async () => {
        throw new Error('unused');
      },
    },
  };

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

  async function share(
    fields: Record<string, string | File>,
    options: { cookie?: string; fetchSite?: string } = {},
  ): Promise<Response> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const headers = new Headers();
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.fetchSite) headers.set('sec-fetch-site', options.fetchSite);
    return app.fetch(
      new Request('http://localhost/share-target', { method: 'POST', headers, body: form }),
    );
  }

  function location(res: Response): URL {
    expect(res.status).toBe(303);
    return new URL(res.headers.get('location') ?? '', 'http://localhost');
  }

  let a: { cookie: string; userId: string };
  let b: { cookie: string; userId: string };
  const stamp = Date.now();

  beforeAll(async () => {
    setCaptureDepsForTests(deps);
    a = await signedInUser(`share-a-${stamp}@voxen.local`);
    b = await signedInUser(`share-b-${stamp}@voxen.local`);
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

  it('without a session stores nothing and carries only the URL across login', async () => {
    const before = await db.job.count();
    const res = await share({ title: 'Video', text: 'https://youtu.be/dQw4w9WgXcQ?si=x' });
    const target = location(res);
    expect(target.pathname).toBe('/entrar');
    const next = new URL(target.searchParams.get('next') ?? '', 'http://localhost');
    expect(next.pathname).toBe('/capturar');
    expect(next.searchParams.get('shared')).toBe('https://youtu.be/dQw4w9WgXcQ?si=x');
    expect(target.searchParams.get('next')).not.toContain('://');
    expect(await db.job.count()).toBe(before);
  });

  it('without a session never stores shared files', async () => {
    const before = await db.job.count();
    const res = await share({
      files: new File(['# Nota'], 'nota.md', { type: 'text/markdown' }),
    });
    const next = new URL(location(res).searchParams.get('next') ?? '', 'http://localhost');
    expect(next.searchParams.get('error')).toBe('SHARE_LOGIN_FILES');
    expect(await db.job.count()).toBe(before);
    expect(readdirSync(storageRoot)).toEqual([]);
  });

  it('rejects cross-site posts even with a valid session', async () => {
    const res = await share(
      { url: 'https://example.com/cross-site' },
      { cookie: a.cookie, fetchSite: 'cross-site' },
    );
    expect(location(res).searchParams.get('error')).toBe('SHARE_REJECTED');
    expect(await db.job.count({ where: { userId: a.userId } })).toBe(0);
  });

  it('creates a capture job from a shared text and dedupes a second share', async () => {
    const first = location(
      await share(
        { title: 'Rick', text: 'Look https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc' },
        { cookie: a.cookie, fetchSite: 'none' },
      ),
    );
    expect(first.pathname).toBe('/capturar');
    const jobId = first.searchParams.get('job');
    expect(jobId).toBeTruthy();
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId ?? '' } });
    expect(job).toMatchObject({ userId: a.userId, type: 'CAPTURE_LINK', status: 'QUEUED' });

    const again = location(
      await share({ text: 'https://youtu.be/dQw4w9WgXcQ' }, { cookie: a.cookie }),
    );
    expect(again.searchParams.get('job')).toBe(jobId);
    expect(await db.job.count({ where: { userId: a.userId } })).toBe(1);
  });

  it('points to the existing document only for its owner', async () => {
    const doc = await db.transcript.create({
      data: {
        userId: a.userId,
        source: 'WEB',
        url: 'https://example.com/already-captured',
        title: 'Existing',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'workspaces/x/transcripts/share.md',
        plainText: 'text',
        frontmatter: {},
      },
    });
    const own = location(
      await share({ url: 'https://example.com/already-captured' }, { cookie: a.cookie }),
    );
    expect(own.searchParams.get('existing')).toBe(doc.id);

    const other = location(
      await share({ url: 'https://example.com/already-captured' }, { cookie: b.cookie }),
    );
    expect(other.searchParams.get('existing')).toBeNull();
    const otherJob = await db.job.findUniqueOrThrow({
      where: { id: other.searchParams.get('job') ?? '' },
    });
    expect(otherJob.userId).toBe(b.userId);
    await db.transcript.delete({ where: { id: doc.id } });
  });

  it('reports submit errors as codes without creating jobs', async () => {
    roles.clear();
    const noKey = location(
      await share({ url: 'https://example.com/no-key' }, { cookie: a.cookie }),
    );
    expect(noKey.searchParams.get('error')).toBe('AI_NOT_CONFIGURED');
    roles.add('standard');
    const blocked = location(await share({ url: 'http://127.0.0.1/admin' }, { cookie: a.cookie }));
    expect(blocked.searchParams.get('error')).toBe('BLOCKED_ADDRESS');
    const empty = location(await share({ text: 'just words' }, { cookie: a.cookie }));
    expect(empty.searchParams.get('error')).toBe('SHARE_EMPTY');
    expect(await db.job.count({ where: { userId: a.userId } })).toBe(0);
  });

  it('queues shared files through the upload service', async () => {
    const res = await share(
      {
        text: 'ignored when files exist',
        files: new File(['# Nota\n\nConteúdo'], 'nota.md', { type: 'text/markdown' }),
      },
      { cookie: a.cookie, fetchSite: 'same-origin' },
    );
    const jobId = location(res).searchParams.get('job');
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId ?? '' } });
    expect(job).toMatchObject({ userId: a.userId, type: 'CAPTURE_UPLOAD' });

    const rejected = location(
      await share(
        {
          files: new File([new Uint8Array([1, 2])], 'tool.exe', {
            type: 'application/x-msdownload',
          }),
        },
        { cookie: a.cookie },
      ),
    );
    expect(rejected.searchParams.get('error')).toBe('UNSUPPORTED');
  });
});
