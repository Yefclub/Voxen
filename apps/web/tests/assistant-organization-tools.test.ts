import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { buildAssistantTools, type AssistantReference } from '../src/lib/assistant/tools';
import { claimAssistantRun, sendAssistantMessage } from '../src/lib/assistant/store';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('assistant source-grounded relationship reading', () => {
  const users: string[] = [],
    docs: string[] = [];
  const refs = new Map<string, AssistantReference>();
  let tools: Awaited<ReturnType<typeof buildAssistantTools>>;
  const options = { toolCallId: 'organization-read', messages: [], context: undefined };
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({
        data: {
          email: `assistant-organization-${randomUUID()}@example.test`,
          name: 'Relationship reader',
          status: 'APPROVED',
        },
      });
      users.push(user.id);
      const doc = await db.transcript.create({
        data: {
          userId: user.id,
          title: i ? 'Foreign private relationships' : 'Owned relationship source',
          source: 'WEB',
          url: `https://example.test/${randomUUID()}`,
          language: 'en',
          durationSec: 0,
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${user.id}/private-source.md`,
          plainText: 'Orion is explicitly part of Vega.',
          frontmatter: {},
        },
      });
      docs.push(doc.id);
      const content = await db.brainNode.create({
        data: {
          userId: user.id,
          key: `TRANSCRIPT:${doc.id}`,
          type: 'CONTENT',
          label: doc.title,
          sourceType: 'TRANSCRIPT',
          sourceId: doc.id,
        },
      });
      for (const [index, authority] of [
        'CAPTURED_SOURCE',
        'USER_CORRECTED',
        'PREPARED_DOCUMENT',
        null,
      ].entries()) {
        const node = await db.brainNode.create({
          data: {
            userId: user.id,
            key: `TOPIC:read-${index}`,
            type: 'TOPIC',
            label: `Owned topic ${index}`,
          },
        });
        const edge = await db.brainEdge.create({
          data: {
            userId: user.id,
            fromNodeId: content.id,
            toNodeId: node.id,
            kind: 'MENTIONS',
            method: authority ? 'llm-grounded-organization' : 'llm-grounded',
          },
        });
        await db.brainSource.create({
          data: {
            userId: user.id,
            nodeId: node.id,
            edgeId: edge.id,
            sourceType: 'TRANSCRIPT',
            sourceId: doc.id,
            excerpt: authority ? 'Orion is explicitly part of Vega.' : 'Unclassified legacy hint.',
            startLine: 1,
            endLine: 1,
            authority: authority as
              | 'CAPTURED_SOURCE'
              | 'USER_CORRECTED'
              | 'PREPARED_DOCUMENT'
              | null,
          },
        });
      }
    }
    const run = await sendAssistantMessage(users[0]!, {
      text: 'Read source-backed relationships.',
      revision: 0,
      requestKey: randomUUID(),
    });
    tools = await buildAssistantTools(
      (await claimAssistantRun(run.id))!,
      new AbortController().signal,
      refs,
      async () => undefined,
    );
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  test('reads recorded authority and exact anchors without promoting legacy hints or exposing internal fields', async () => {
    expect(tools.document_relationships).toBeDefined();
    const result = (await tools.document_relationships!.execute!(
      { id: docs[0], limit: 8 },
      options,
    )) as {
      document: { id: string };
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; from: string; to: string }>;
      evidence: Array<{ authority: string; excerpt: string; startLine: number; endLine: number }>;
      truncated: boolean;
    };
    expect(result.document.id).toBe(docs[0]!);
    expect(result.evidence.map((row) => row.authority).sort()).toEqual([
      'CAPTURED_SOURCE',
      'PREPARED_DOCUMENT',
      'USER_CORRECTED',
    ]);
    expect(
      result.evidence.every(
        (row) =>
          row.excerpt === 'Orion is explicitly part of Vega.' &&
          row.startLine === 1 &&
          row.endLine === 1,
      ),
    ).toBe(true);
    const ids = new Set(result.nodes.map((node) => node.id));
    expect(result.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    for (const secret of [
      'private-source.md',
      'generationSettings',
      'userId',
      'Unclassified legacy hint',
      'Foreign private',
    ])
      expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.truncated).toBe(false);
    expect(refs.get(`/transcricoes/${docs[0]}`)).toMatchObject({ source: 'library' });
    expect(refs.get(`/transcricoes/${docs[0]}`)?.verified).not.toBe(true);
  });
  test('excludes invalidated evidence and manually archived relationships', async () => {
    const source = await db.brainSource.findFirstOrThrow({
      where: { userId: users[0], sourceId: docs[0], authority: 'CAPTURED_SOURCE' },
    });
    await db.brainSource.update({ where: { id: source.id }, data: { invalidatedAt: new Date() } });
    const read = () =>
      tools.document_relationships!.execute!({ id: docs[0], limit: 8 }, options) as Promise<{
        edges: Array<{ id: string }>;
        evidence: Array<{ id: string }>;
      }>;
    expect((await read()).evidence.some((item) => item.id === source.id)).toBe(false);
    await db.brainSource.update({ where: { id: source.id }, data: { invalidatedAt: null } });
    await db.brainEdge.update({ where: { id: source.edgeId! }, data: { status: 'ARCHIVED' } });
    expect((await read()).edges.some((item) => item.id === source.edgeId)).toBe(false);
    await db.brainEdge.update({ where: { id: source.edgeId! }, data: { status: 'ACTIVE' } });
    expect((await read()).evidence.some((item) => item.id === source.id)).toBe(true);
  });
  test('limits supported relationships and gives identical results for missing and foreign documents', async () => {
    const limited = (await tools.document_relationships!.execute!(
      { id: docs[0], limit: 2 },
      options,
    )) as { edges: unknown[]; evidence: unknown[]; truncated: boolean };
    expect(limited.edges).toHaveLength(2);
    expect(limited.evidence).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    expect(
      await tools.document_relationships!.execute!({ id: docs[1], limit: 8 }, options),
    ).toEqual(
      await tools.document_relationships!.execute!({ id: 'missing-id', limit: 8 }, options),
    );
    expect(refs.has(`/transcricoes/${docs[1]}`)).toBe(false);
    await db.transcript.update({ where: { id: docs[0] }, data: { status: 'ARCHIVED' } });
    expect(
      await tools.document_relationships!.execute!({ id: docs[0], limit: 8 }, options),
    ).toMatchObject({ error: 'NOT_FOUND' });
  });
});
