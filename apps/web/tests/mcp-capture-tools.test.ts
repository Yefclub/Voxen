import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { getCaptureDeps, setCaptureDepsForTests } from '../src/lib/capture/deps';
import { createMcpToken } from '../src/lib/mcp-tokens';
import { getRedisPublisher } from '../src/lib/redis';
import { submitRateLimited } from '../src/routes/captures';

type Capture = {
  id: string;
  status: string;
  platform: string | null;
  stage: string | null;
  percent: number | null;
  warnings: string[];
  error: { code: string; message: string } | null;
  transcript: { id: string; title: string } | null;
};
type Result = {
  isError?: boolean;
  content: { text: string }[];
  structuredContent: {
    job: Capture;
    capture: Capture;
    captures: Capture[];
    transcript: { id: string; title: string };
    existing: boolean;
    deduped: boolean;
    alreadyFinished: boolean;
    nextTool: string;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

describe.skipIf(!process.env.DATABASE_URL)('MCP capture tools (spec 222)', () => {
  let owner = '';
  let other = '';
  let token = '';
  let readToken = '';
  let foreignToken = '';
  let configured = true;

  async function rpc(method: string, params: object, credential = token) {
    return app.fetch(
      new Request(new URL('/mcp', process.env.APP_BASE_URL || 'http://localhost'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
  }

  async function tool(name: string, args: object, credential = token): Promise<Result> {
    const response = await rpc('tools/call', { name, arguments: args }, credential);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: Result; error?: unknown };
    expect(body.error).toBeUndefined();
    return body.result;
  }

  const submit = (url: string) => tool('voxen_capture_url', { url });
  const status = (id: string, credential = token) =>
    tool('voxen_capture_status', { capture_id: id }, credential);

  beforeAll(async () => {
    const users = await Promise.all(
      ['owner', 'other'].map((name) =>
        db.user.create({
          data: {
            name,
            email: `mcp-capture-${name}-${crypto.randomUUID()}@example.test`,
            status: 'APPROVED',
          },
        }),
      ),
    );
    owner = users[0]!.id;
    other = users[1]!.id;
    const issue = async (userId: string, scopes: ('READ' | 'WRITE')[]) =>
      (await createMcpToken({ userId, scopes, label: 'Capture test', expiresAt: null })).token;
    token = await issue(owner, ['READ', 'WRITE']);
    readToken = await issue(owner, ['READ']);
    foreignToken = await issue(other, ['READ', 'WRITE']);
    const deps = getCaptureDeps();
    setCaptureDepsForTests({
      ...deps,
      ai: { ...deps.ai, isRoleConfigured: async () => configured },
      worker: {
        ...deps.worker,
        extract: async () => {
          throw new Error('MCP must only enqueue');
        },
      },
    });
  });

  beforeEach(async () => {
    configured = true;
    await db.job.deleteMany({ where: { userId: { in: [owner, other] } } });
    await db.transcript.deleteMany({ where: { userId: { in: [owner, other] } } });
    await getRedisPublisher().del(`capture-submit:${owner}`);
  });

  afterAll(async () => {
    setCaptureDepsForTests(null);
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await getRedisPublisher().del(`capture-submit:${owner}`);
  });

  test('READ catalog exposes status/list only; write calls require mcp:write', async () => {
    const response = await rpc('tools/list', {}, readToken);
    const { result } = (await response.json()) as { result: { tools: { name: string }[] } };
    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain('voxen_capture_status');
    expect(names).toContain('voxen_list_captures');
    for (const name of ['voxen_capture_url', 'voxen_cancel_capture']) {
      expect(names).not.toContain(name);
      const denied = await rpc('tools/call', { name, arguments: {} }, readToken);
      expect(denied.status).toBe(403);
      expect(denied.headers.get('www-authenticate')).toContain('insufficient_scope');
      expect(denied.headers.get('www-authenticate')).toContain('mcp:write');
    }
  });

  test('catalog declares the external AI cost and exact effects of both writes', async () => {
    const response = await rpc('tools/list', {});
    const { result } = (await response.json()) as {
      result: { tools: { name: string; description: string; annotations: object }[] };
    };
    const capture = result.tools.find((item) => item.name === 'voxen_capture_url');
    expect(capture?.description).toContain('provider charges');
    expect(capture?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(
      result.tools.find((item) => item.name === 'voxen_cancel_capture')?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  test('submits without extracting and deduplicates canonical links', async () => {
    const first = await submit('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc');
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({
      existing: false,
      deduped: false,
      nextTool: 'voxen_capture_status',
      job: { status: 'QUEUED', platform: 'youtube' },
    });
    const id = first.structuredContent.job.id;
    const again = await submit('https://youtu.be/dQw4w9WgXcQ');
    expect(again.structuredContent).toMatchObject({ deduped: true, job: { id } });
    expect(await db.job.count({ where: { userId: owner } })).toBe(1);
    expect(await db.job.findUnique({ where: { id } })).toMatchObject({
      userId: owner,
      type: 'CAPTURE_LINK',
    });
  });

  test('returns a stored document even without AI configured', async () => {
    configured = false;
    const doc = await db.transcript.create({
      data: {
        userId: owner,
        source: 'WEB',
        url: 'https://example.com/stored',
        title: 'Stored document',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'test.md',
        plainText: 'Captured content.',
        frontmatter: {},
      },
    });
    const result = await submit(doc.url);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      existing: true,
      transcript: { id: doc.id, title: doc.title },
    });
    expect(await db.job.count({ where: { userId: owner } })).toBe(0);
  });

  test('reports stable errors and shares the API/PWA submission limit', async () => {
    for (const [url, code] of [
      ['bad', 'INVALID_URL'],
      ['http://127.0.0.1', 'BLOCKED_ADDRESS'],
    ]) {
      const result = await submit(url!);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain(code!);
    }
    configured = false;
    const missing = await submit('https://example.com/no-ai');
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing)).toContain('AI_NOT_CONFIGURED');
    expect(JSON.stringify(missing)).toContain('/conta/ia');
    expect(await db.job.count({ where: { userId: owner } })).toBe(0);
    configured = true;
    await getRedisPublisher().del(`capture-submit:${owner}`);
    for (let n = 0; n < 29; n++) expect(await submitRateLimited(owner)).toBe(false);
    expect((await submit('https://example.com/thirtieth')).isError).not.toBe(true);
    const refused = await submit('https://example.com/thirty-first');
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).toContain('RATE_LIMITED');
    expect(await db.job.count({ where: { userId: owner } })).toBe(1);
    expect(await submitRateLimited(owner)).toBe(true);
  });

  test('status returns progress, public errors, warnings and the resulting document', async () => {
    const created = await submit('https://example.com/status');
    const id = created.structuredContent.job.id;
    await db.job.update({
      where: { id },
      data: {
        status: 'RUNNING',
        progressStage: 'interpreting',
        progressPercent: 65,
      },
    });
    expect((await status(id)).structuredContent.capture).toMatchObject({
      stage: 'interpreting',
      percent: 65,
    });
    await db.job.update({
      where: { id },
      data: {
        status: 'FAILED',
        captureErrorCode: 'LLM_AUTH',
        errorMsg: 'PRIVATE_PROVIDER_SECRET',
      },
    });
    const failed = await status(id);
    expect(failed.structuredContent.capture.error?.code).toBe('LLM_AUTH');
    expect(failed.structuredContent.capture.error?.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_PROVIDER_SECRET');
    const doc = await db.transcript.create({
      data: {
        userId: owner,
        source: 'WEB',
        url: 'https://example.com/status',
        title: 'Captured document',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'test.md',
        plainText: 'Captured content.',
        frontmatter: {},
      },
    });
    for (const terminal of ['DONE', 'COMPLETED_WITH_WARNINGS'] as const) {
      await db.job.update({
        where: { id },
        data: {
          status: terminal,
          transcriptId: doc.id,
          captureErrorCode: null,
          captureMeta: { platform: 'web', warnings: ['images_not_described'] },
        },
      });
      expect((await status(id)).structuredContent.capture).toMatchObject({
        status: terminal,
        warnings: ['images_not_described'],
        transcript: { id: doc.id, title: doc.title },
      });
    }
  });

  test('isolates status and cancellation, including non-capture jobs', async () => {
    const id = (await submit('https://example.com/owned')).structuredContent.job.id;
    for (const name of ['voxen_capture_status', 'voxen_cancel_capture']) {
      const foreign = await tool(name, { capture_id: id }, foreignToken);
      const missing = await tool(name, { capture_id: 'missing' }, foreignToken);
      expect(foreign.isError).toBe(true);
      expect(foreign.content[0]?.text.replace(/"requestId":"[^"]+"/, '')).toBe(
        missing.content[0]?.text.replace(/"requestId":"[^"]+"/, ''),
      );
      const maintenance = await db.job.create({
        data: {
          userId: owner,
          type: 'SCRAPE_WEB',
          sourceUrl: `test://${crypto.randomUUID()}`,
        },
      });
      expect((await tool(name, { capture_id: maintenance.id })).isError).toBe(true);
    }
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe('QUEUED');
  });

  test('paginates by time/id, binds cursors to the owner and survives boundary deletion', async () => {
    const queuedAt = new Date('2026-01-01T00:00:00Z');
    for (const [userId, id] of [
      [owner, 'cap-c'],
      [owner, 'cap-b'],
      [owner, 'cap-a'],
      [other, 'cap-other'],
    ]) {
      await db.job.create({
        data: {
          id,
          userId: userId!,
          type: 'CAPTURE_LINK',
          sourceUrl: `https://example.com/${id}`,
          queuedAt,
        },
      });
    }
    const first = await tool('voxen_list_captures', { limit: 2 });
    expect(first.structuredContent.captures.map((row) => row.id)).toEqual(['cap-c', 'cap-b']);
    expect(first.structuredContent.hasMore).toBe(true);
    const cursor = first.structuredContent.nextCursor;
    expect(typeof cursor).toBe('string');
    expect((await tool('voxen_list_captures', { limit: 2, cursor }, foreignToken)).isError).toBe(
      true,
    );
    expect((await tool('voxen_list_captures', { cursor: `${cursor}x` })).isError).toBe(true);
    await db.job.delete({ where: { id: 'cap-b' } });
    const second = await tool('voxen_list_captures', { limit: 2, cursor });
    expect(second.structuredContent.captures.map((row) => row.id)).toEqual(['cap-a']);
    expect(second.structuredContent.nextCursor).toBeNull();
    expect(second.structuredContent.hasMore).toBe(false);
    expect((await tool('voxen_list_captures', { limit: 51 })).isError).toBe(true);
  });

  test('listing defaults to 20, supports 50 and includes uploads without exposing storage keys', async () => {
    await db.job.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        userId: owner,
        type: 'CAPTURE_UPLOAD' as const,
        sourceUrl: `upload://${crypto.randomUUID()}/sample.txt`,
        queuedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        captureMeta: { upload: { filename: 'sample.txt', objectKey: 'PRIVATE_STORAGE_KEY' } },
      })),
    });
    const defaults = await tool('voxen_list_captures', {});
    expect(defaults.structuredContent.captures).toHaveLength(20);
    const maximum = await tool('voxen_list_captures', { limit: 50 });
    expect(maximum.structuredContent.captures).toHaveLength(50);
    expect(maximum.structuredContent.hasMore).toBe(true);
    expect(JSON.stringify(maximum)).not.toContain('PRIVATE_STORAGE_KEY');
  });

  test('cancels active jobs and returns terminal captures unchanged on repeat', async () => {
    const id = (await submit('https://example.com/cancel')).structuredContent.job.id;
    const cancelled = await tool('voxen_cancel_capture', { capture_id: id });
    expect(cancelled.isError).not.toBe(true);
    expect(cancelled.structuredContent).toMatchObject({
      alreadyFinished: false,
      capture: { status: 'CANCELLED' },
    });
    const stored = await db.job.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({
      captureErrorCode: 'CANCELLED',
      workerId: null,
      leaseExpiresAt: null,
    });
    const again = await tool('voxen_cancel_capture', { capture_id: id });
    expect(again.structuredContent).toMatchObject({
      alreadyFinished: true,
      capture: { status: 'CANCELLED' },
    });
    expect(await db.job.findUniqueOrThrow({ where: { id } })).toEqual(stored);
    for (const terminal of ['DONE', 'COMPLETED_WITH_WARNINGS', 'FAILED'] as const) {
      await db.job.update({ where: { id }, data: { status: terminal } });
      const before = await db.job.findUniqueOrThrow({ where: { id } });
      expect(
        (await tool('voxen_cancel_capture', { capture_id: id })).structuredContent,
      ).toMatchObject({ alreadyFinished: true, capture: { status: terminal } });
      expect(await db.job.findUniqueOrThrow({ where: { id } })).toEqual(before);
    }
  });
});
