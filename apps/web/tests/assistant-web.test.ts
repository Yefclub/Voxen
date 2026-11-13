import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { setUserSetting } from '../src/lib/settings';
import { fetchWebPage, searchWeb } from '../src/lib/assistant/web';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
let userId: string | undefined;
afterAll(async () => {
  if (userId) await db.user.delete({ where: { id: userId } });
});
suite('bounded optional assistant web discovery', () => {
  test('uses a fixed endpoint, keeps the credential out of results and filters unsafe URLs', async () => {
    userId = (
      await db.user.create({
        data: {
          email: `assistant-web-${randomUUID()}@example.test`,
          name: 'Web test',
          status: 'APPROVED',
        },
      })
    ).id;
    const signal = new AbortController().signal;
    expect(await searchWeb(userId, 'evidence', signal)).toMatchObject({
      error: 'WEB_NOT_CONFIGURED',
      sources: [],
    });
    const secret = 'fixture-brave-key-not-a-real-credential';
    await setUserSetting(userId, 'assistant_search_key', secret);
    const requests: Array<{ url: URL; headers: Headers }> = [];
    const fetchMock = spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(
      Object.assign(
        (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          requests.push({ url: new URL(String(url)), headers: new Headers(init?.headers) });
          return Promise.resolve(
            Response.json({
              web: {
                results: [
                  {
                    url: 'https://example.com/primary-evidence',
                    title: 'Primary evidence',
                    description: 'A bounded excerpt',
                  },
                  { url: 'http://127.0.0.1/private', title: 'Unsafe' },
                  { url: 'javascript:alert(1)', title: 'Unsafe' },
                ],
              },
            }),
          );
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    try {
      const result = await searchWeb(userId, 'evidence', signal);
      expect(requests[0]?.url.origin).toBe('https://api.search.brave.com');
      expect(requests[0]?.url.pathname).toBe('/res/v1/web/search');
      expect(requests[0]?.headers.get('X-Subscription-Token')).toBe(secret);
      expect(result.sources).toHaveLength(1);
      expect(result).toHaveProperty('retrievedAt');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(await fetchWebPage('http://169.254.169.254/latest/meta-data', signal)).toMatchObject({
        error: 'BLOCKED_ADDRESS',
      });
      fetchMock.mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
      await expect(searchWeb(userId, 'oversized', signal)).rejects.toThrow('WEB_RESULT_TOO_LARGE');
    } finally {
      fetchMock.mockRestore();
    }
  });
});
