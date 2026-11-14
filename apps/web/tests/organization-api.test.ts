import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import app from '../src/index';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { setUserSetting, getUserSetting } from '../src/lib/settings';
import { claimOrganization, withOrganizationLease } from '../src/lib/organization/lease';

const root = mkdtempSync(join(tmpdir(), 'voxen-organization-api-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
suite('authenticated organization consent, history and cancellation API', () => {
  const users: string[] = [],
    cookies: string[] = [];
  let documentId: string, runId: string;
  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = cookies[0]!,
    origin?: string,
  ) {
    return app.fetch(
      new Request(`http://localhost/api/organization${path}`, {
        method,
        headers: {
          cookie,
          host: 'localhost',
          ...(method !== 'GET' && { 'content-type': 'application/json' }),
          ...(origin && { origin }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  }
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `organization-api-${randomUUID()}@example.test`,
        password = 'isolated-organization-test-password-229';
      await app.fetch(
        new Request('http://localhost/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name: 'Organization API' }),
        }),
      );
      const user = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
      users.push(user.id);
      const response = await app.fetch(
        new Request('http://localhost/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }),
      );
      cookies.push((response.headers.get('set-cookie') ?? '').split(';')[0]!);
    }
    documentId = randomUUID();
    const mdPath = `workspaces/${users[0]}/private-${documentId}.md`;
    await storagePut({
      key: mdPath,
      body: 'Orion is explicitly part of the Vega product family.',
      contentType: 'text/markdown',
    });
    await db.transcript.create({
      data: {
        id: documentId,
        userId: users[0]!,
        title: 'Owned organization source',
        source: 'WEB',
        url: 'https://example.test/organization',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath,
        plainText: 'Original source.',
        frontmatter: {},
      },
    });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
    rmSync(root, { recursive: true, force: true });
  });
  test('requires approved sessions, same-origin JSON and bounded strict input', async () => {
    expect((await call('/preferences', 'GET', undefined, '')).status).toBe(401);
    await db.user.update({ where: { id: users[1] }, data: { status: 'PENDING' } });
    expect((await call('/preferences', 'GET', undefined, cookies[1])).status).toBe(403);
    await db.user.update({ where: { id: users[1] }, data: { status: 'APPROVED' } });
    expect(
      (await call('/preferences', 'PUT', { mode: 'OFF' }, cookies[0], 'https://untrusted.example'))
        .status,
    ).toBe(403);
    expect(
      (
        await app.fetch(
          new Request('http://localhost/api/organization/preferences', {
            method: 'PUT',
            headers: { cookie: cookies[0]! },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await app.fetch(
          new Request('http://localhost/api/organization/preferences', {
            method: 'PUT',
            headers: { cookie: cookies[0]!, 'content-type': 'application/json-not-json' },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await call('/preferences', 'PUT', { mode: 'OFF', padding: 'x'.repeat(10_000) })).status,
    ).toBe(413);
    expect((await call('/preferences', 'PUT', { mode: 'OFF', userId: users[1] })).status).toBe(400);
    const initial = await call('/preferences');
    expect(initial.headers.get('cache-control')).toBe('no-store');
    expect(await initial.json()).toMatchObject({ mode: 'OFF', automaticSince: null });
  });
  test('requires only owned Standard credentials and preserves unrelated permissions', async () => {
    await setUserSetting(users[1]!, 'ai_provider_key:anthropic', 'foreign-provider-secret');
    expect((await call('/preferences', 'PUT', { mode: 'MANUAL' })).status).toBe(409);
    await setUserSetting(users[0]!, 'ai_provider_key:anthropic', 'owned-provider-secret');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    const updated = await call('/preferences', 'PUT', { mode: 'MANUAL' });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ mode: 'MANUAL' });
    for (const key of [
      'library_research_preferences',
      'assistant_preferences',
      'assistant_search_key',
    ] as const)
      expect(await getUserSetting(users[0]!, key)).toBeNull();
    expect(await (await call('/preferences', 'GET', undefined, cookies[1])).json()).toMatchObject({
      mode: 'OFF',
    });
  });
  test('enqueues once across retries and hides foreign or missing documents', async () => {
    const requestKey = randomUUID(),
      path = `/documents/${documentId}`;
    const first = await call(path, 'POST', { requestKey });
    expect(first.status).toBe(202);
    runId = (await first.json()).id;
    expect(await (await call(path, 'POST', { requestKey })).json()).toEqual({ id: runId });
    expect(
      await db.organizationRun.count({ where: { userId: users[0], transcriptId: documentId } }),
    ).toBe(1);
    for (const [id, cookie] of [
      [documentId, cookies[1]],
      ['missing-id', cookies[0]],
    ])
      expect(
        (await call(`/documents/${id}`, 'POST', { requestKey: randomUUID() }, cookie)).status,
      ).toBe(404);
    expect((await call(path, 'POST', { requestKey, userId: users[1] })).status).toBe(400);
  });
  test('returns bounded owned history and stable links without internal state or storage paths', async () => {
    const baseline = await db.organizationRun.findFirstOrThrow({
      where: { id: runId, userId: users[0] },
    });
    await db.organizationRun.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        userId: users[0]!,
        transcriptId: documentId,
        runKey: randomUUID(),
        trigger: 'MANUAL' as const,
        status: 'COMPLETED' as const,
        totalSections: 1,
        completedSections: 1,
        generationSettings: {
          privateExecution: 'never-expose-this',
          execution: { chain: [{ model: 'internal-model' }] },
        },
        createdAt: new Date(baseline.createdAt.getTime() + i + 1),
        costUsd: i === 0 ? null : 0.0002,
      })),
    });
    const page = await (await call(`/documents/${documentId}`)).json();
    expect(page.items).toHaveLength(10);
    expect(page).toMatchObject({ mode: 'MANUAL', sourceActive: true });
    expect(page.nextCursor).toBeString();
    const seen = page.items.map((row: { id: string }) => row.id);
    let cursor = page.nextCursor;
    while (cursor) {
      const next = await (await call(`/documents/${documentId}?cursor=${cursor}`)).json();
      expect(next.items.length).toBeLessThanOrEqual(10);
      seen.push(...next.items.map((row: { id: string }) => row.id));
      cursor = next.nextCursor;
    }
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    const read = await call(`/documents/${documentId}/${runId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: runId,
      status: 'PENDING',
      totalSections: 1,
      completedSections: 0,
      costUsd: null,
    });
    const serialized = JSON.stringify(page);
    for (const privateValue of [
      'never-expose-this',
      'privateExecution',
      'generationSettings',
      'leaseOwner',
      'private-',
      'owned-provider-secret',
    ])
      expect(serialized).not.toContain(privateValue);
    expect(
      (await call(`/documents/${documentId}/${runId}`, 'GET', undefined, cookies[1])).status,
    ).toBe(404);
    expect((await call(`/documents/${documentId}?cursor=missing-id`)).status).toBe(404);
    await db.transcript.update({ where: { id: documentId }, data: { status: 'ARCHIVED' } });
    expect(await (await call(`/documents/${documentId}`)).json()).toMatchObject({
      sourceActive: false,
    });
    await db.transcript.update({ where: { id: documentId }, data: { status: 'ACTIVE' } });
  });
  test('guarded cancellation fences late work, retains unknown usage and preserves completed work', async () => {
    const submitted = await call(`/documents/${documentId}`, 'POST', { requestKey: randomUUID() });
    const id = (await submitted.json()).id;
    const lease = (await claimOrganization(users[0]!, id))!;
    expect(lease).not.toBeNull();
    await db.organizationSection.updateMany({
      where: { runId: id, run: { userId: users[0] } },
      data: { callPending: true },
    });
    const path = `/documents/${documentId}/${id}`;
    const current = await (await call(path)).json();
    expect((await call(path, 'PATCH', { expectedRevision: current.revision + 1 })).status).toBe(
      409,
    );
    expect(
      (await call(path, 'PATCH', { expectedRevision: current.revision }, cookies[1])).status,
    ).toBe(404);
    const result = await call(path, 'PATCH', { expectedRevision: current.revision });
    expect(result.status).toBe(200);
    const cancelled = await result.json();
    expect(cancelled).toMatchObject({ id, status: 'CANCELLED', costUsd: null });
    expect(cancelled.warnings).toContain('UNCONFIRMED_USAGE');
    expect(
      await (await call(path, 'PATCH', { expectedRevision: current.revision })).json(),
    ).toEqual(cancelled);
    await expect(withOrganizationLease(lease, async () => {})).rejects.toThrow('LEASE_LOST');
    expect(
      await db.transcript.findFirstOrThrow({ where: { id: documentId, userId: users[0] } }),
    ).toMatchObject({ plainText: 'Original source.' });
    const completed = await db.organizationRun.findFirstOrThrow({
      where: { userId: users[0], transcriptId: documentId, status: 'COMPLETED' },
    });
    expect(
      await (
        await call(`/documents/${documentId}/${completed.id}`, 'PATCH', { expectedRevision: 999 })
      ).json(),
    ).toMatchObject({ status: 'COMPLETED' });
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: completed.id, userId: users[0] } }),
    ).toEqual(completed);
  });
  test('rejects oversized source text explicitly without creating work or changing the source', async () => {
    const id = randomUUID(),
      mdPath = `workspaces/${users[0]}/oversized-${id}.md`;
    const markdown = 'x'.repeat(48_000 * 24 + 1);
    await storagePut({ key: mdPath, body: markdown, contentType: 'text/markdown' });
    const source = await db.transcript.create({
      data: {
        id,
        userId: users[0]!,
        title: 'Oversized organization source',
        source: 'WEB',
        url: `https://example.test/${id}`,
        language: 'en',
        durationSec: 0,
        transcriptionMethod: 'SCRAPE',
        mdPath,
        plainText: 'Original remains available.',
        frontmatter: {},
      },
    });
    const response = await call(`/documents/${id}`, 'POST', { requestKey: randomUUID() });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'TEXT_TOO_LARGE' });
    expect(await db.organizationRun.count({ where: { userId: users[0], transcriptId: id } })).toBe(
      0,
    );
    expect(await db.transcript.findFirstOrThrow({ where: { id, userId: users[0] } })).toEqual(
      source,
    );
  });
  test('allows opt-out without credentials and rate-limits authenticated mutations', async () => {
    await setUserSetting(users[0]!, 'ai_provider_key:anthropic', '');
    expect((await call('/preferences', 'PUT', { mode: 'OFF' })).status).toBe(200);
    expect((await call('/preferences', 'PUT', { mode: 'AUTO' })).status).toBe(409);
    let limited = false;
    for (let i = 0; i < 61; i++) {
      const response = await call('/preferences', 'PUT', { mode: 'OFF' }, cookies[1]);
      if (response.status === 429) {
        limited = true;
        break;
      }
      expect(response.status).toBe(200);
    }
    expect(limited).toBe(true);
  });
});
