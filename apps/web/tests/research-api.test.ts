import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import app from '../src/index';
import { db } from '../src/lib/db';
import { getUserSetting, setUserSetting } from '../src/lib/settings';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('authenticated external research API', () => {
  const users: string[] = [];
  const cookies: string[] = [];
  let documentId: string;
  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = cookies[0]!,
    origin?: string,
  ) {
    return app.fetch(
      new Request(`http://localhost/api/research${path}`, {
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
      const email = `research-api-${randomUUID()}@example.test`;
      const password = 'isolated-research-test-password-229';
      await app.fetch(
        new Request('http://localhost/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name: 'Research API' }),
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
    documentId = (
      await db.transcript.create({
        data: {
          userId: users[0]!,
          source: 'WEB',
          url: 'https://example.com/research',
          title: 'Owned source',
          plainText: 'Original source.',
          durationSec: 0,
          language: 'en',
          transcriptionMethod: 'SCRAPE',
          mdPath: 'fixture.md',
          frontmatter: {},
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  test('requires approved sessions, same-origin JSON and bounded input', async () => {
    expect((await call('/preferences', 'GET', undefined, '')).status).toBe(401);
    await db.user.update({ where: { id: users[1]! }, data: { status: 'PENDING' } });
    expect((await call('/preferences', 'GET', undefined, cookies[1])).status).toBe(403);
    await db.user.update({ where: { id: users[1]! }, data: { status: 'APPROVED' } });
    expect(
      (await call('/preferences', 'PUT', { mode: 'OFF' }, cookies[0], 'https://untrusted.example'))
        .status,
    ).toBe(403);
    expect(
      (
        await app.fetch(
          new Request('http://localhost/api/research/preferences', {
            method: 'PUT',
            headers: { cookie: cookies[0]! },
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
    expect(await initial.json()).toMatchObject({ mode: 'OFF', searchConfigured: false });
  });
  test('enables research with owner credentials without changing chat web permission or exposing secrets', async () => {
    expect((await call('/preferences', 'PUT', { mode: 'MANUAL' })).status).toBe(409);
    await setUserSetting(users[0]!, 'ai_provider_key:anthropic', 'fixture-provider-key-229');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    const updated = await call('/preferences', 'PUT', {
      mode: 'MANUAL',
      searchKey: 'fixture-brave-key-229',
    });
    expect(updated.status).toBe(200);
    expect(await getUserSetting(users[0]!, 'assistant_preferences')).toBeNull();
    expect(await getUserSetting(users[0]!, 'assistant_search_key')).toBe('fixture-brave-key-229');
    const body = await (await call('/preferences')).json();
    expect(body).toMatchObject({ mode: 'MANUAL', searchConfigured: true, searchLast4: '-229' });
    expect(JSON.stringify(body)).not.toContain('fixture-brave');
    expect(await (await call('/preferences', 'GET', undefined, cookies[1])).json()).toMatchObject({
      mode: 'OFF',
      searchConfigured: false,
    });
  });
  test('enqueues once, keeps foreign sources invisible and supports guarded cancellation', async () => {
    const requestKey = randomUUID();
    const path = `/documents/${documentId}`;
    expect((await call(path, 'POST', { requestKey, userId: users[1] })).status).toBe(400);
    const submitted = await call(path, 'POST', { requestKey });
    expect(submitted.status).toBe(202);
    const result = (await submitted.json()) as { id: string };
    expect(await (await call(path, 'POST', { requestKey })).json()).toEqual(result);
    for (const id of [documentId, 'missing'])
      expect((await call(`/documents/${id}`, 'GET', undefined, cookies[1])).status).toBe(404);
    const list = (await (await call(path)).json()) as {
      enrichments: Array<{ id: string; revision: number; checksum: string }>;
    };
    const item = list.enrichments[0]!;
    expect(item.id).toBe(result.id);
    const cancelled = await call(`${path}/${item.id}`, 'PATCH', {
      action: 'cancel',
      expectedRevision: item.revision,
      expectedChecksum: item.checksum,
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect(
      (
        await call(`${path}/${item.id}`, 'PATCH', {
          action: 'accept',
          expectedRevision: item.revision,
          expectedChecksum: item.checksum,
        })
      ).status,
    ).toBe(409);
    expect(await db.transcriptEnrichment.count({ where: { transcriptId: documentId } })).toBe(1);
  });
  test('resolves a linked result beyond the first history page without leaking another owner', async () => {
    const oldest = await db.transcriptEnrichment.findFirstOrThrow({
      where: { userId: users[0]!, transcriptId: documentId },
    });
    await db.transcriptEnrichment.createMany({
      data: Array.from({ length: 11 }, (_, i) => ({
        userId: users[0]!,
        transcriptId: documentId,
        runKey: randomUUID(),
        trigger: 'MANUAL' as const,
        status: 'FAILED' as const,
        createdAt: new Date(Date.now() + i + 1),
      })),
    });
    const path = `/documents/${documentId}`;
    const firstPage = (await (await call(path)).json()) as {
      enrichments: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(firstPage.enrichments).toHaveLength(10);
    expect(firstPage.enrichments.some((item) => item.id === oldest.id)).toBe(false);
    expect(firstPage.nextCursor).toBeTruthy();
    const linked = await call(`${path}/${oldest.id}`);
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({ id: oldest.id, status: 'CANCELLED' });
    for (const id of [oldest.id, 'missing'])
      expect((await call(`${path}/${id}`, 'GET', undefined, cookies[1])).status).toBe(404);
    const nextPage = (await (await call(`${path}?cursor=${firstPage.nextCursor}`)).json()) as {
      enrichments: Array<{ id: string }>;
    };
    expect(nextPage.enrichments.some((item) => item.id === oldest.id)).toBe(true);
  });
});
