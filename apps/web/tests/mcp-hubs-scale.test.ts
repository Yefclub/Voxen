import { afterAll, describe, expect, test } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { createMcpToken } from '../src/lib/mcp-tokens';

describe.skipIf(!process.env.DATABASE_URL)('bounded hub aggregation', () => {
  let ownerId = '',
    foreignId = '',
    token = '';
  const count = 20_000;
  async function seedGraph(): Promise<void> {
    ownerId = (
      await db.user.create({
        data: {
          email: `hubs-scale-${crypto.randomUUID()}@example.test`,
          name: 'Scale QA',
          status: 'APPROVED',
        },
      })
    ).id;
    foreignId = (
      await db.user.create({
        data: {
          email: `hubs-foreign-${crypto.randomUUID()}@example.test`,
          name: 'Foreign QA',
          status: 'APPROVED',
        },
      })
    ).id;
    token = (
      await createMcpToken({
        userId: ownerId,
        label: 'Scale QA',
        scopes: ['READ'],
        expiresAt: null,
      })
    ).token;
    await db.$executeRaw`INSERT INTO "BrainNode" (id,"userId",key,type,label) SELECT ${ownerId} || '-node-' || n, ${ownerId}, 'TOPIC:scale-' || n, 'TOPIC'::"BrainNodeType", 'QA node ' || n FROM generate_series(1,${count}::int) n`;
    await db.$executeRaw`INSERT INTO "BrainEdge" (id,"userId","fromNodeId","toNodeId",kind) SELECT ${ownerId} || '-edge-' || n || '-' || step, ${ownerId}, ${ownerId} || '-node-' || n, ${ownerId} || '-node-' || ((n+step-1)%${count}::int+1), 'RELATED_TO'::"BrainEdgeKind" FROM generate_series(1,${count}::int) n CROSS JOIN (VALUES (1),(3)) AS steps(step)`;
    const foreign = await db.brainNode.create({
      data: { userId: foreignId, key: 'TOPIC:foreign', type: 'TOPIC', label: 'Foreign' },
    });
    const stale = await db.brainNode.create({
      data: {
        userId: ownerId,
        key: 'CONTENT:missing',
        type: 'CONTENT',
        label: 'Missing source',
        sourceType: 'TRANSCRIPT',
        sourceId: 'missing',
      },
    });
    const archived = await db.brainNode.create({
      data: {
        userId: ownerId,
        key: 'TOPIC:archived',
        type: 'TOPIC',
        label: 'Archived',
        status: 'ARCHIVED',
      },
    });
    await db.brainEdge.createMany({
      data: [foreign.id, stale.id, archived.id, ownerId + '-node-1'].map((toNodeId) => ({
        userId: ownerId,
        fromNodeId: ownerId + '-node-1',
        toNodeId,
        kind: 'RELATED_TO',
      })),
    });
  }
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [ownerId, foreignId] } } });
  });
  test('20k nodes/40k edges respect the existing SQL deadline and count valid endpoints exactly', async () => {
    await seedGraph();
    const response = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'voxen_brain_hubs', arguments: { limit: 5 } },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const reply = (await response.json()) as {
      result: {
        isError?: boolean;
        structuredContent?: { hubs: Array<{ id: string; degree: number }> };
      };
    };
    expect(reply.result.isError).not.toBe(true);
    const hubs = reply.result.structuredContent!.hubs;
    expect(hubs[0]).toMatchObject({ id: ownerId + '-node-1', degree: 5 });
    expect(hubs.slice(1).every((h) => h.degree === 4)).toBe(true);
    expect(hubs.slice(1).map((h) => h.id)).toEqual(
      hubs
        .slice(1)
        .map((h) => h.id)
        .sort(),
    );
  }, 30_000);
});
