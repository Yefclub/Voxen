import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../lib/db';
import { getRedisPublisher } from '../lib/redis';
import { sessionIntentKey, SESSION_INTENT_TTL_SEC } from '../lib/personal-interest-session';
import { registerAccountInterestRoutes } from './account-interests';

const describeIfServices =
  process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;

describeIfServices('personal interest account API', () => {
  let ownerId = '';
  let foreignId = '';
  let ownerNodeId = '';
  let foreignNodeId = '';
  const sessionId = `session_${crypto.randomUUID().replaceAll('-', '')}`;
  const app = new Hono<{ Variables: { userId: string } }>();

  beforeAll(async () => {
    const suffix = crypto.randomUUID();
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `interest-api-owner-${suffix}@voxen.local`,
          name: 'Interest API owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `interest-api-foreign-${suffix}@voxen.local`,
          name: 'Interest API foreign',
          status: 'APPROVED',
        },
      }),
    ]);
    ownerId = owner.id;
    foreignId = foreign.id;
    const [ownerNode, foreignNode] = await Promise.all([
      db.brainNode.create({
        data: {
          userId: owner.id,
          key: `topic:${suffix}:owner`,
          type: 'TOPIC',
          label: 'Owner topic',
        },
      }),
      db.brainNode.create({
        data: {
          userId: foreign.id,
          key: `topic:${suffix}:foreign`,
          type: 'TOPIC',
          label: 'Foreign topic',
        },
      }),
    ]);
    ownerNodeId = ownerNode.id;
    foreignNodeId = foreignNode.id;
    app.use('*', async (c, next) => {
      c.set('userId', ownerId);
      return next();
    });
    registerAccountInterestRoutes(app);
  });

  afterAll(async () => {
    if (ownerId) {
      await getRedisPublisher()
        .del(sessionIntentKey(ownerId, sessionId))
        .catch(() => undefined);
      await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    }
    if (foreignId) await db.user.delete({ where: { id: foreignId } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('returns three durable horizons without requiring temporary intent', async () => {
    const response = await app.request('/interests');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projections: Array<{ horizon: string; items: unknown[] }>;
      sessionIntent: null;
      sessionIntentAvailable: boolean;
    };
    expect(body.projections.map((projection) => projection.horizon).sort()).toEqual([
      'LONG',
      'MEDIUM',
      'SHORT',
    ]);
    expect(body.sessionIntent).toBeNull();
    expect(body.sessionIntentAvailable).toBe(true);
  });

  test('rejects a Brain node owned by another user', async () => {
    const response = await app.request('/interests/session', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        items: [
          {
            dimension: 'TOPIC',
            key: 'foreign-topic',
            label: 'Foreign topic',
            weight: 1,
            brainNodeId: foreignNodeId,
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(await getRedisPublisher().get(sessionIntentKey(ownerId, sessionId))).toBeNull();
  });

  test('stores a bounded, replaceable session intent beside durable projections', async () => {
    const response = await app.request('/interests/session', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        items: [
          {
            dimension: 'TOPIC',
            key: 'owner-topic',
            label: 'Owner topic',
            weight: 0.9,
            brainNodeId: ownerNodeId,
          },
          {
            dimension: 'TOPIC',
            key: 'owner-topic',
            label: 'Owner topic updated',
            weight: 0.7,
            brainNodeId: ownerNodeId,
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const ttl = await getRedisPublisher().ttl(sessionIntentKey(ownerId, sessionId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SESSION_INTENT_TTL_SEC);

    const read = await app.request(`/interests?sessionId=${sessionId}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      projections: unknown[];
      sessionIntent: { items: Array<{ label: string; weight: number }> };
    };
    expect(body.projections).toHaveLength(3);
    expect(body.sessionIntent.items).toHaveLength(1);
    expect(body.sessionIntent.items[0]).toMatchObject({
      label: 'Owner topic updated',
      weight: 0.7,
    });
  });

  test('clears only the selected session intent and validates session identifiers', async () => {
    expect((await app.request('/interests?sessionId=invalid%20session')).status).toBe(400);
    const cleared = await app.request(`/interests/session/${sessionId}`, { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(await getRedisPublisher().get(sessionIntentKey(ownerId, sessionId))).toBeNull();
  });

  test('keeps durable projections available when the temporary intent store is down', async () => {
    const unavailableApp = new Hono<{ Variables: { userId: string } }>();
    unavailableApp.use('*', async (c, next) => {
      c.set('userId', ownerId);
      return next();
    });
    registerAccountInterestRoutes(unavailableApp, {
      readIntent: async () => {
        throw new Error('Redis unavailable');
      },
    });
    const response = await unavailableApp.request(`/interests?sessionId=${sessionId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projections: unknown[];
      sessionIntent: null;
      sessionIntentAvailable: boolean;
    };
    expect(body.projections).toHaveLength(3);
    expect(body.sessionIntent).toBeNull();
    expect(body.sessionIntentAvailable).toBe(false);
  });
});
