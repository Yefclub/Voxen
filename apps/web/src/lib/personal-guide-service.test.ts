import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from './db';
import { loadPersonalAgentContext } from './personal-agent-context-service';
import { loadPersonalGuide, loadPersonalGuideSources } from './personal-guide-service';

const describeIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDatabase('personal Guide source isolation', () => {
  let ownerId = '';
  let foreignId = '';
  let ownerTranscriptId = '';
  let archivedTranscriptId = '';
  let foreignTranscriptId = '';

  beforeAll(async () => {
    const suffix = crypto.randomUUID();
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `guide-owner-${suffix}@voxen.local`,
          name: 'Guide owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `guide-foreign-${suffix}@voxen.local`,
          name: 'Guide foreign user',
          status: 'APPROVED',
        },
      }),
    ]);
    ownerId = owner.id;
    foreignId = foreign.id;
    const createTranscript = (userId: string, title: string, status: 'ACTIVE' | 'ARCHIVED') =>
      db.transcript.create({
        data: {
          userId,
          status,
          source: 'WEB',
          url: `https://example.test/${suffix}/${encodeURIComponent(title)}`,
          title,
          durationSec: 0,
          language: 'en',
          transcriptionMethod: 'SUBTITLES',
          mdPath: `tests/${suffix}/${encodeURIComponent(title)}.md`,
          plainText: title,
          summaryMd: `# Summary\n\n${title} with **grounded** evidence.`,
          frontmatter: {},
        },
      });
    const [ownerTranscript, archivedTranscript, foreignTranscript] = await Promise.all([
      createTranscript(ownerId, 'Owner source', 'ACTIVE'),
      createTranscript(ownerId, 'Archived source', 'ARCHIVED'),
      createTranscript(foreignId, 'Foreign source', 'ACTIVE'),
    ]);
    ownerTranscriptId = ownerTranscript.id;
    archivedTranscriptId = archivedTranscript.id;
    foreignTranscriptId = foreignTranscript.id;
    const [contentNode, topicNode, archivedContentNode, archivedTopicNode] = await Promise.all([
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `TRANSCRIPT:${ownerTranscript.id}`,
          type: 'CONTENT',
          label: ownerTranscript.title,
          sourceType: 'TRANSCRIPT',
          sourceId: ownerTranscript.id,
        },
      }),
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `TOPIC:guide:${suffix}`,
          type: 'TOPIC',
          label: 'Grounded guide topic',
        },
      }),
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `TRANSCRIPT:${archivedTranscript.id}`,
          type: 'CONTENT',
          label: archivedTranscript.title,
          sourceType: 'TRANSCRIPT',
          sourceId: archivedTranscript.id,
        },
      }),
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `TOPIC:archived-guide:${suffix}`,
          type: 'TOPIC',
          label: 'Archived secret guide topic',
        },
      }),
    ]);
    await Promise.all([
      db.brainEdge.create({
        data: {
          userId: ownerId,
          fromNodeId: contentNode.id,
          toNodeId: topicNode.id,
          kind: 'MENTIONS',
          confidence: 0.9,
          method: 'test-extraction',
        },
      }),
      db.brainEdge.create({
        data: {
          userId: ownerId,
          fromNodeId: archivedContentNode.id,
          toNodeId: topicNode.id,
          kind: 'MENTIONS',
          confidence: 0.9,
          method: 'test-extraction',
        },
      }),
      db.interestEvent.create({
        data: {
          userId: ownerId,
          transcriptId: ownerTranscript.id,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_MORE',
          signal: 1,
        },
      }),
      db.brainEdge.create({
        data: {
          userId: ownerId,
          fromNodeId: archivedContentNode.id,
          toNodeId: archivedTopicNode.id,
          kind: 'MENTIONS',
          confidence: 0.9,
          method: 'test-extraction',
        },
      }),
      db.interestEvent.create({
        data: {
          userId: ownerId,
          transcriptId: archivedTranscript.id,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_LESS',
          signal: -1,
        },
      }),
    ]);
  });

  afterAll(async () => {
    if (ownerId) await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    if (foreignId) await db.user.delete({ where: { id: foreignId } }).catch(() => undefined);
  });

  test('hydrates only active transcripts owned by the requested user', async () => {
    const sources = await loadPersonalGuideSources(ownerId, [
      ownerTranscriptId,
      archivedTranscriptId,
      foreignTranscriptId,
      ownerTranscriptId,
    ]);

    expect([...sources.keys()]).toEqual([ownerTranscriptId]);
    expect(sources.get(ownerTranscriptId)).toMatchObject({
      title: 'Owner source',
      description: 'Summary Owner source with grounded evidence.',
    });
  });

  test('does not discard authorized evidence after the first database batch', async () => {
    const nonexistentIds = Array.from({ length: 550 }, (_, index) => `missing-${index}`);
    const sources = await loadPersonalGuideSources(ownerId, [...nonexistentIds, ownerTranscriptId]);

    expect([...sources.keys()]).toEqual([ownerTranscriptId]);
  });

  test('builds a personalized end-to-end Guide from owned events and graph records', async () => {
    const guide = await loadPersonalGuide(ownerId, new Date());

    expect(guide.metadata.personalizationMode).toBe('durable-interest');
    expect(guide.trends).toContainEqual(
      expect.objectContaining({ label: 'Grounded guide topic', brainNodeId: expect.any(String) }),
    );
    expect(guide.recommendations).toContainEqual(
      expect.objectContaining({ transcriptId: ownerTranscriptId, title: 'Owner source' }),
    );
    expect(guide.recommendations.some((item) => item.transcriptId === foreignTranscriptId)).toBe(
      false,
    );
  });

  test('builds agent context without archived or foreign source metadata', async () => {
    const context = await loadPersonalAgentContext(ownerId, new Date());
    const serialized = JSON.stringify(context);

    expect(context.preferences).toContainEqual(
      expect.objectContaining({
        label: 'Grounded guide topic',
        provenance: 'DECLARED',
        declaredScore: 1,
      }),
    );
    expect(serialized).toContain(ownerTranscriptId);
    expect(serialized).not.toContain(archivedTranscriptId);
    expect(serialized).not.toContain(foreignTranscriptId);
    expect(serialized).not.toContain('Archived secret guide topic');
  });
});
