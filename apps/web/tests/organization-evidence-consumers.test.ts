import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('organization evidence authority in HTTP and MCP consumers', () => {
  const users: string[] = [];
  const token = `organization-evidence-${randomUUID()}`;
  let cookie: string, documentId: string, foreignId: string;
  const authorities = ['CAPTURED_SOURCE', 'USER_CORRECTED', 'PREPARED_DOCUMENT'] as const;
  const evidenceIds: string[] = [];
  let legacyId: string;
  async function mcp(name: string, args: Record<string, unknown> = {}) {
    const response = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).not.toBe(true);
    return body.result.structuredContent ?? JSON.parse(body.result.content[0].text);
  }
  beforeAll(async () => {
    const email = `organization-evidence-${randomUUID()}@example.test`,
      password = 'isolated-evidence-test-password-229';
    await app.fetch(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'Evidence authority' }),
      }),
    );
    const owner = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
    users.push(
      owner.id,
      (
        await db.user.create({
          data: {
            email: `organization-foreign-${randomUUID()}@example.test`,
            name: 'Foreign',
            status: 'APPROVED',
          },
        })
      ).id,
    );
    const signin = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0]!;
    await db.mcpToken.create({
      data: {
        userId: owner.id,
        tokenHash: hashMcpToken(token),
        label: 'Read evidence',
        scopes: 'READ',
      },
    });
    for (let index = 0; index < 2; index++) {
      const source = await db.transcript.create({
        data: {
          userId: users[index]!,
          source: 'WEB',
          title: index ? 'Foreign source' : 'Owned source',
          url: `https://example.test/${randomUUID()}`,
          language: 'en',
          durationSec: 0,
          transcriptionMethod: 'SCRAPE',
          mdPath: 'unused-read-fixture.md',
          plainText: 'Orion is part of Vega.',
          frontmatter: {},
        },
      });
      if (index) foreignId = source.id;
      else documentId = source.id;
    }
    const content = await db.brainNode.create({
      data: {
        userId: owner.id,
        key: `TRANSCRIPT:${documentId}`,
        type: 'CONTENT',
        label: 'Owned source',
        sourceType: 'TRANSCRIPT',
        sourceId: documentId,
      },
    });
    for (let index = 0; index < 4; index++) {
      const node = await db.brainNode.create({
        data: {
          userId: owner.id,
          key: `ENTITY:evidence-${index}`,
          type: 'ENTITY',
          label: `Evidence ${index}`,
        },
      });
      const edge = await db.brainEdge.create({
        data: {
          userId: owner.id,
          fromNodeId: content.id,
          toNodeId: node.id,
          kind: 'MENTIONS',
          method: index === 3 ? 'llm-grounded' : 'llm-grounded-organization',
        },
      });
      const row = await db.brainSource.create({
        data: {
          userId: owner.id,
          nodeId: node.id,
          edgeId: edge.id,
          sourceType: 'TRANSCRIPT',
          sourceId: documentId,
          excerpt: `Owned evidence ${index}.`,
          startLine: 1,
          endLine: 1,
          authority: authorities[index] ?? null,
        },
      });
      if (index === 3) legacyId = row.id;
      else evidenceIds.push(row.id);
    }
    await db.brainSource.create({
      data: {
        userId: users[1]!,
        sourceType: 'TRANSCRIPT',
        sourceId: documentId,
        authority: 'CAPTURED_SOURCE',
        excerpt: 'Foreign evidence must remain private.',
      },
    });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  test('retains each recorded authority while keeping legacy HTTP evidence unclassified', async () => {
    const response = await app.fetch(
      new Request(`http://localhost/api/transcripts/${documentId}/graph?scope=content`, {
        headers: { cookie },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    for (let i = 0; i < authorities.length; i++)
      expect(body.evidence.find((row: { id: string }) => row.id === evidenceIds[i])).toMatchObject({
        authority: authorities[i],
        startLine: 1,
        endLine: 1,
      });
    const legacy = body.evidence.find((row: { id: string }) => row.id === legacyId);
    expect(legacy).toBeDefined();
    expect(Object.hasOwn(legacy, 'authority')).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Foreign evidence');
  });
  test('returns authority through READ MCP without promoting legacy evidence or exposing foreign references', async () => {
    const result = await mcp('voxen_brain_sources', { ref: documentId });
    for (let i = 0; i < authorities.length; i++)
      expect(result.sources.find((row: { id: string }) => row.id === evidenceIds[i])).toMatchObject(
        { authority: authorities[i] },
      );
    expect(
      Object.hasOwn(
        result.sources.find((row: { id: string }) => row.id === legacyId),
        'authority',
      ),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain('Foreign evidence');
    expect(await mcp('voxen_brain_sources', { ref: foreignId })).toEqual(
      await mcp('voxen_brain_sources', { ref: 'missing-id' }),
    );
  });
  test('keeps invalidated evidence out of both consumers', async () => {
    await db.brainSource.updateMany({
      where: { id: evidenceIds[0], userId: users[0] },
      data: { invalidatedAt: new Date() },
    });
    const mcpResult = await mcp('voxen_brain_sources', { ref: documentId });
    expect(mcpResult.sources.some((row: { id: string }) => row.id === evidenceIds[0])).toBe(false);
    const response = await app.fetch(
      new Request(`http://localhost/api/transcripts/${documentId}/graph?scope=content`, {
        headers: { cookie },
      }),
    );
    expect(
      (await response.json()).evidence.some((row: { id: string }) => row.id === evidenceIds[0]),
    ).toBe(false);
  });
});
