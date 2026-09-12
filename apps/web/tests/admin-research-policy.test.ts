import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { setSettings } from '../src/lib/settings';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;
const PASSWORD = 'senha-super-segura-123';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

async function createSession(email: string, name: string): Promise<{ id: string; cookie: string }> {
  const signup = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  expect(signup.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { status: 'APPROVED' } });
  const signin = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(signin.status).toBe(200);
  return { id: user.id, cookie: (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
}

function apiInit(cookie: string, method = 'GET', body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describeIfDb('admin transcript research policy', () => {
  let adminId = '';
  let userId = '';
  let adminCookie = '';
  let userCookie = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const admin = await createSession(`research-admin-${suffix}@voxen.local`, 'Research Admin');
    const user = await createSession(`research-user-${suffix}@voxen.local`, 'Research User');
    adminId = admin.id;
    userId = user.id;
    adminCookie = admin.cookie;
    userCookie = user.cookie;
    await db.user.update({ where: { id: adminId }, data: { role: 'ADMIN', status: 'APPROVED' } });
    await db.user.update({ where: { id: userId }, data: { role: 'USER', status: 'APPROVED' } });
  });

  afterAll(async () => {
    await setSettings({ summary_research_mode: 'OFF' });
    await db.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await db.$disconnect();
  });

  it('rejects non-admin changes and invalid input', async () => {
    expect(
      (await request('/api/admin/research-policy', apiInit(userCookie, 'PATCH', { mode: 'AUTO' })))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/admin/research-policy',
          apiInit(adminCookie, 'PATCH', { mode: 'ALWAYS' }),
        )
      ).status,
    ).toBe(400);
  });

  it('persists modes and cancels work excluded by policy transitions', async () => {
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: `https://example.com/research-policy-${crypto.randomUUID()}`,
        title: 'Research policy source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/research-policy.md`,
        plainText: 'Canonical text.',
        summaryMd: 'Canonical summary.',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'checksum-v1',
      },
    });
    const setMode = (mode: 'OFF' | 'MANUAL' | 'AUTO') =>
      request('/api/admin/research-policy', apiInit(adminCookie, 'PATCH', { mode }));
    const createWork = (trigger: 'AUTO' | 'MANUAL', status: 'PENDING' | 'RUNNING') =>
      db.transcriptEnrichment.create({
        data: {
          userId,
          transcriptId: transcript.id,
          runKey: crypto.randomUUID(),
          trigger,
          status,
          sourceVersion: 1,
          sourceChecksum: 'checksum-v1',
          ...(status === 'RUNNING' ? { startedAt: new Date(), attempt: 1 } : {}),
        },
      });

    expect((await setMode('AUTO')).status).toBe(200);
    const autoPending = await createWork('AUTO', 'PENDING');
    const autoRunning = await createWork('AUTO', 'RUNNING');
    const manualPending = await createWork('MANUAL', 'PENDING');

    expect((await setMode('MANUAL')).status).toBe(200);
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: autoPending.id } }))
        .cancelRequestedAt,
    ).not.toBeNull();
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: autoRunning.id } }))
        .cancelRequestedAt,
    ).not.toBeNull();
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: manualPending.id } })).status,
    ).toBe('PENDING');

    expect((await setMode('OFF')).status).toBe(200);
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: manualPending.id } }))
        .cancelRequestedAt,
    ).not.toBeNull();
    const read = await request('/api/admin/research-policy', apiInit(adminCookie));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ mode: 'OFF' });
  });
});
