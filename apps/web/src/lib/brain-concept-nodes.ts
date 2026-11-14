import { db } from './db';

// Lexical reindexing may reuse identities named or archived by the owner or
// grounded organization. Only creation supplies heuristic defaults.
export function upsertTopicNode(userId: string, topic: { slug: string; label: string }) {
  const key = `TOPIC:${topic.slug}`;
  return db.brainNode.upsert({
    where: { userId_key: { userId, key } },
    update: {},
    create: {
      userId,
      key,
      type: 'TOPIC',
      label: topic.label,
      description: 'Tópico detectado automaticamente nos conteúdos da biblioteca.',
      metadata: { method: 'keyword' },
    },
  });
}
export function upsertEntityNode(
  userId: string,
  entity: { slug: string; label: string; kind: string },
) {
  const key = `ENTITY:${entity.slug}`;
  return db.brainNode.upsert({
    where: { userId_key: { userId, key } },
    update: {},
    create: {
      userId,
      key,
      type: 'ENTITY',
      label: entity.label,
      description: 'Entidade detectada automaticamente nos conteúdos da biblioteca.',
      metadata: { method: 'entity-heuristic', kind: entity.kind },
    },
  });
}
