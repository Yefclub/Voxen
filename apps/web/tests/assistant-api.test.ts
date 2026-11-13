import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import app from '../src/index';
import { db } from '../src/lib/db';
import { getUserSetting, setUserSetting } from '../src/lib/settings';
import {
  getConversation,
  rewindConversation,
  sendAssistantMessage,
  stopAssistantRun,
} from '../src/lib/assistant/store';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('authenticated assistant API', () => {
  const users: string[] = [];
  const cookies: string[] = [];
  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = cookies[0]!,
    origin?: string,
  ) {
    return app.fetch(
      new Request(`http://localhost/api/chat${path}`, {
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
      const email = `assistant-api-${randomUUID()}@example.test`;
      const password = 'test-assistant-long-password-228';
      await app.fetch(
        new Request('http://localhost/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name: 'Assistant API' }),
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
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  test('requires an approved session and rejects cross-origin mutations', async () => {
    expect((await call('', 'GET', undefined, '')).status).toBe(401);
    await db.user.update({ where: { id: users[1]! }, data: { status: 'PENDING' } });
    expect((await call('', 'GET', undefined, cookies[1])).status).toBe(403);
    await db.user.update({ where: { id: users[1]! }, data: { status: 'APPROVED' } });
    expect(
      (await call('/messages', 'POST', {}, cookies[0], 'https://untrusted.example')).status,
    ).toBe(403);
  });

  test('preserves a keyless library and never accepts caller-supplied ownership or a mode flag', async () => {
    const input = { text: 'Read my library', revision: 0, requestKey: randomUUID() };
    const missing = await call('/messages', 'POST', input);
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: 'AI_NOT_CONFIGURED' });
    expect((await call('/messages', 'POST', { ...input, userId: users[1] })).status).toBe(400);
    expect((await call('/messages', 'POST', { ...input, allowAdditions: true })).status).toBe(400);
    expect((await call('/messages', 'POST', { ...input, text: 'x'.repeat(100_000) })).status).toBe(
      413,
    );
    expect(await db.assistantMessage.count({ where: { userId: users[0]! } })).toBe(0);
  });

  test('persists one run on retry, conflicts with another turn and isolates stop and history', async () => {
    await setUserSetting(users[0]!, 'ai_provider_key:anthropic', 'test-key-not-a-real-credential');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    const input = { text: 'An owned request', revision: 0, requestKey: randomUUID() };
    const first = await call('/messages', 'POST', input);
    expect(first.status).toBe(202);
    const body = (await first.json()) as { id: string };
    expect(await (await call('/messages', 'POST', input)).json()).toMatchObject({ id: body.id });
    expect((await call('/messages', 'POST', { ...input, requestKey: randomUUID() })).status).toBe(
      409,
    );
    expect((await call(`/runs/${body.id}/stop`, 'POST', {}, cookies[1])).status).toBe(404);
    const other = (await (await call('', 'GET', undefined, cookies[1])).json()) as {
      messages: unknown[];
    };
    expect(other.messages).toHaveLength(0);
    await stopAssistantRun(users[0]!, body.id);
  });

  test('stores encrypted web credentials and only returns configuration status', async () => {
    const secret = 'brave-fixture-secret-never-return-this';
    const response = await call('/preferences', 'PUT', {
      role: 'standard',
      webEnabled: true,
      searchKey: secret,
    });
    expect(response.status).toBe(200);
    const configured = await (await call('/preferences')).json();
    expect(configured).toMatchObject({ webEnabled: true, searchConfigured: true });
    expect(JSON.stringify(configured)).not.toContain(secret);
    expect(await getUserSetting(users[0]!, 'assistant_search_key')).toBe(secret);
    expect(await (await call('/preferences', 'GET', undefined, cookies[1])).json()).toMatchObject({
      searchConfigured: false,
    });
    await call('/preferences', 'PUT', { role: 'standard', webEnabled: false, searchKey: null });
    expect(await (await call('/preferences')).json()).toMatchObject({ searchConfigured: false });
  });

  test('replays only owned events, respects the cursor and resets an obsolete revision', async () => {
    const foreign = await sendAssistantMessage(users[1]!, {
      text: 'Foreign stream',
      revision: 0,
      requestKey: randomUUID(),
    });
    async function batch(after = 0, lastEventId?: string) {
      const response = await app.fetch(
        new Request(`http://localhost/api/chat/events?revision=0&after=${after}`, {
          headers: {
            cookie: cookies[0]!,
            host: 'localhost',
            ...(lastEventId && { 'Last-Event-ID': lastEventId }),
          },
          signal: AbortSignal.timeout(5000),
        }),
      );
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      let output = '';
      try {
        while (!output.includes('event: heartbeat') && !output.includes('event: reset')) {
          const next = await reader.read();
          if (next.done) break;
          output += new TextDecoder().decode(next.value);
        }
      } finally {
        await reader.cancel();
      }
      return output;
    }
    const replay = await batch();
    expect(replay).toContain('event: progress');
    expect(replay).not.toContain(foreign.id);
    const cursor = [...replay.matchAll(/id: (\d+)/g)].at(-1)![1]!;
    expect(await batch(0, cursor)).not.toContain('event: progress');
    const state = await getConversation(users[0]!);
    await rewindConversation(users[0]!, {
      messageId: state.messages[0]!.id,
      revision: state.revision,
    });
    expect(await batch()).toContain('event: reset');
    await stopAssistantRun(users[1]!, foreign.id);
  });
});
