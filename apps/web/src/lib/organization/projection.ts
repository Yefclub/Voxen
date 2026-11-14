import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { runWithBrainIndexLease } from '../brain-index-lease';
import { normalizeEntityAlias } from '../brain-temporal';
import { organizationRangeAuthority } from './provenance';
import { loadEffectiveTranscriptMarkdown, TranscriptReadError } from '../transcript-content';
import type { OrganizationAnalysis, OrganizationNode } from './generate';
import {
  OrganizationError,
  organizationHash,
  organizationNameInQuote,
  organizationSections,
  organizationSnapshot,
  type OrganizationEvidence,
  type OrganizationSource,
} from './source';

const METHOD = 'llm-grounded-organization';
export type OrganizationPublication = { nodes: number; relationships: number; warnings: string[] };
type Tx = Prisma.TransactionClient;

function validateEvidence(source: OrganizationSource, analysis: OrganizationAnalysis): void {
  const section = organizationSections(source).find((row) => row.key === analysis.sectionKey);
  if (!section || analysis.nodes.length > 16 || analysis.relationships.length > 20)
    throw new OrganizationError('INVALID_EVIDENCE');
  const valid = (evidence: OrganizationEvidence) => {
    const { startOffset, endOffset, excerpt, startLine, endLine } = evidence;
    const authority = organizationRangeAuthority(section.spans, startOffset, endOffset);
    return (
      authority !== null &&
      Number.isInteger(startOffset) &&
      Number.isInteger(endOffset) &&
      startOffset >= section.offset &&
      endOffset <= section.offset + section.text.length &&
      excerpt.length >= 20 &&
      excerpt.length <= 1600 &&
      evidence.authority === authority &&
      source.markdown.slice(startOffset, endOffset) === excerpt &&
      startLine === 1 + (source.markdown.slice(0, startOffset).match(/\n/g)?.length ?? 0) &&
      endLine === startLine + (excerpt.match(/\n/g)?.length ?? 0)
    );
  };
  const nodes = new Map(analysis.nodes.map((node) => [node.id, node]));
  if (
    nodes.size !== analysis.nodes.length ||
    analysis.nodes.some(
      (node) => !valid(node.evidence) || !organizationNameInQuote(node.name, node.evidence.excerpt),
    )
  )
    throw new OrganizationError('INVALID_EVIDENCE');
  for (const row of analysis.relationships) {
    const from = nodes.get(row.from),
      to = nodes.get(row.to);
    if (
      !from ||
      !to ||
      from.id === to.id ||
      !valid(row.evidence) ||
      !organizationNameInQuote(from.name, row.evidence.excerpt) ||
      !organizationNameInQuote(to.name, row.evidence.excerpt)
    )
      throw new OrganizationError('INVALID_EVIDENCE');
  }
}

function sameKind(metadata: Prisma.JsonValue, kind: string): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true;
  const value = metadata.entityType ?? metadata.kind;
  if (typeof value !== 'string') return true;
  const current = value.toUpperCase();
  return current === kind || current === 'OTHER';
}

async function resolveNode(tx: Tx, userId: string, node: OrganizationNode) {
  const type = node.kind === 'TOPIC' ? 'TOPIC' : 'ENTITY';
  const normalized = normalizeEntityAlias(node.name);
  const slug = normalized || organizationHash(node.name).slice(0, 24);
  const baseKey = type === 'TOPIC' ? `TOPIC:${slug}` : `ENTITY:${node.kind.toLowerCase()}:${slug}`;
  const identityName = (value: string) =>
    value
      .normalize('NFKC')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const identity = identityName(node.name);
  const original = await tx.brainNode.findUnique({
    where: { userId_key: { userId, key: baseKey } },
  });
  const sameName = (row: { label: string; metadata: Prisma.JsonValue }) => {
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    return identityName(row.label) === identity || metadata.identityName === identity;
  };
  // Punctuation is meaningful in names such as C++ and C#. A shared slug is
  // never enough to merge them, and a manual label is never overwritten.
  const key =
    original && !sameName(original)
      ? `${baseKey}:${organizationHash(identity).slice(0, 12)}`
      : baseKey;
  const aliases =
    type === 'ENTITY' && normalized
      ? await tx.$queryRaw<Array<{ id: string; alias: string }>>`
      SELECT DISTINCT entity.id, alias.alias
      FROM "BrainEntityAlias" alias
      JOIN "BrainNode" entity ON entity.id = alias."entityNodeId" AND entity."userId" = alias."userId"
      JOIN "Transcript" source ON source.id = alias."sourceId" AND source."userId" = alias."userId"
      WHERE alias."userId" = ${userId} AND alias."sourceType" = 'TRANSCRIPT'
        AND alias."normalizedAlias" = ${normalized} AND alias."invalidatedAt" IS NULL
        AND alias."entityType" IN (${node.kind}, 'OTHER')
        AND entity.type = 'ENTITY' AND entity.status = 'ACTIVE' AND source.status = 'ACTIVE'
      ORDER BY entity.id, alias.alias LIMIT 65
    `
      : [];
  if (aliases.length === 65) return { node: null, warning: 'AMBIGUOUS_IDENTITY' };
  const exactAliases = aliases.filter((alias) => identityName(alias.alias) === identity);
  const candidates = await tx.brainNode.findMany({
    where: {
      userId,
      type,
      sourceType: null,
      status: 'ACTIVE',
      OR: [
        { key },
        { label: { equals: node.name, mode: 'insensitive' } },
        ...(exactAliases.length ? [{ id: { in: exactAliases.map((row) => row.id) } }] : []),
      ],
    },
    orderBy: { id: 'asc' },
    take: 32,
  });
  if (candidates.length === 32) return { node: null, warning: 'AMBIGUOUS_IDENTITY' };
  const compatible = candidates.filter(
    (row) =>
      (sameName(row) || exactAliases.some((alias) => alias.id === row.id)) &&
      (type === 'TOPIC' || sameKind(row.metadata, node.kind)),
  );
  if (compatible.length > 1) return { node: null, warning: 'AMBIGUOUS_IDENTITY' };
  if (compatible[0]) return { node: compatible[0], warning: null };
  const existing = await tx.brainNode.findUnique({ where: { userId_key: { userId, key } } });
  const metadata = existing?.metadata;
  if (
    existing?.status === 'ARCHIVED' &&
    existing.type === type &&
    sameName(existing) &&
    existing.sourceType === null &&
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    metadata.method === 'llm-grounded' &&
    metadata.organizationLifecycleArchived === true &&
    (type === 'TOPIC' || sameKind(metadata, node.kind))
  ) {
    const restoredMetadata = { ...metadata };
    delete restoredMetadata.organizationLifecycleArchived;
    const restored = await tx.brainNode.updateMany({
      where: {
        id: existing.id,
        userId,
        status: 'ARCHIVED',
        updatedAt: existing.updatedAt,
        metadata: { equals: metadata },
      },
      data: { status: 'ACTIVE', metadata: restoredMetadata },
    });
    if (restored.count !== 1) return { node: null, warning: 'INACTIVE_IDENTITY' };
    return {
      node: await tx.brainNode.findFirstOrThrow({ where: { id: existing.id, userId } }),
      warning: null,
    };
  }
  if (
    existing &&
    (existing.type !== type ||
      existing.status !== 'ACTIVE' ||
      existing.sourceType !== null ||
      (type === 'ENTITY' && !sameKind(existing.metadata, node.kind)))
  )
    return { node: null, warning: 'INACTIVE_IDENTITY' };
  const created = await tx.brainNode.upsert({
    where: { userId_key: { userId, key } },
    update: {},
    create: {
      userId,
      key,
      type,
      label: node.name,
      metadata: { method: 'llm-grounded', entityType: node.kind, identityName: identity },
    },
  });
  return { node: created, warning: null };
}

/** Graph effects and the caller's durable section receipt share one commit. */
export async function publishOrganizationSection(input: {
  source: OrganizationSource;
  analysis: OrganizationAnalysis;
  assertCurrent: (tx: Tx) => Promise<void>;
  commit: (tx: Tx, result: OrganizationPublication) => Promise<void>;
}): Promise<OrganizationPublication> {
  const { source, analysis } = input;
  validateEvidence(source, analysis);
  let currentMarkdown: string;
  try {
    currentMarkdown = (
      await loadEffectiveTranscriptMarkdown(source.userId, source.id, {
        expectedCorrectionRevision: source.correctionRevision,
        expectedSourceVersion: source.sourceVersion,
      })
    ).md;
  } catch (error) {
    if (error instanceof TranscriptReadError)
      throw new OrganizationError(error.code === 'STALE_REVISION' ? 'STALE_SOURCE' : error.code);
    throw error;
  }
  if (currentMarkdown !== source.markdown) throw new OrganizationError('STALE_SOURCE');
  let result: OrganizationPublication | null = null;
  const applied = await runWithBrainIndexLease(source.userId, async (assertGraphLease) => {
    result = await db.$transaction(
      async (tx) => {
        // The execution guard owns the policy → source → run lock order.
        await input.assertCurrent(tx);
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT source.id FROM "Transcript" source JOIN "User" owner ON owner.id = source."userId"
        WHERE source.id = ${source.id} AND source."userId" = ${source.userId}
          AND source.status = 'ACTIVE' AND owner.status = 'APPROVED'
        FOR UPDATE OF source
      `;
        if (!locked.length) throw new OrganizationError('NOT_FOUND');
        const current = await tx.transcript.findFirstOrThrow({
          where: { id: source.id, userId: source.userId },
        });
        if (
          JSON.stringify(
            organizationSnapshot({
              ...current,
              markdown: currentMarkdown,
              canonicalMarkdown: source.canonicalMarkdown,
            }),
          ) !== JSON.stringify(organizationSnapshot(source))
        )
          throw new OrganizationError('STALE_SOURCE');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voxen:organization:projection:${source.userId}`}))`;
        await assertGraphLease();
        const content = await tx.brainNode.upsert({
          where: { userId_key: { userId: source.userId, key: `TRANSCRIPT:${source.id}` } },
          update: {},
          create: {
            userId: source.userId,
            key: `TRANSCRIPT:${source.id}`,
            type: 'CONTENT',
            label: source.title,
            sourceType: 'TRANSCRIPT',
            sourceId: source.id,
          },
        });
        if (
          content.type !== 'CONTENT' ||
          content.sourceType !== 'TRANSCRIPT' ||
          content.sourceId !== source.id
        )
          throw new OrganizationError('INVALID_CONTENT_IDENTITY');
        const segmentKey = `organization:v1:source:${source.sourceVersion}:correction:${source.correctionRevision}:${organizationHash(JSON.stringify(organizationSnapshot(source)))}:${analysis.sectionKey}`;
        const warnings = new Set(analysis.warnings);
        const ids = new Map<string, string>();
        const writeEdge = async (
          fromNodeId: string,
          toNodeId: string,
          kind: 'MENTIONS' | 'RELATED_TO' | 'PART_OF' | 'SUPPORTS' | 'CONTRADICTS',
          evidence: OrganizationEvidence,
          nodeId: string | null,
        ) => {
          if (fromNodeId === toNodeId) return false;
          if ((kind === 'RELATED_TO' || kind === 'CONTRADICTS') && fromNodeId > toNodeId)
            [fromNodeId, toNodeId] = [toNodeId, fromNodeId];
          await assertGraphLease();
          const identity = { userId: source.userId, fromNodeId, toNodeId, kind, method: METHOD };
          let edge = await tx.brainEdge.findUnique({
            where: { userId_fromNodeId_toNodeId_kind_method: identity },
          });
          if (edge) {
            const metadata =
              edge.metadata && typeof edge.metadata === 'object' && !Array.isArray(edge.metadata)
                ? edge.metadata
                : {};
            if (
              edge.status !== 'ACTIVE' &&
              !(edge.status === 'ARCHIVED' && metadata.organizationLifecycleArchived === true)
            ) {
              warnings.add('INACTIVE_RELATIONSHIP');
              return false;
            }
            const restoredMetadata = { ...metadata };
            delete restoredMetadata.organizationLifecycleArchived;
            const changed = await tx.brainEdge.updateMany({
              where: {
                id: edge.id,
                userId: source.userId,
                status: edge.status,
                updatedAt: edge.updatedAt,
              },
              data: {
                status: 'ACTIVE',
                ...(metadata.organizationLifecycleArchived === true
                  ? { metadata: restoredMetadata }
                  : {}),
              },
            });
            if (changed.count !== 1) throw new OrganizationError('GRAPH_BUSY');
          } else
            edge = await tx.brainEdge.create({
              data: { ...identity, metadata: { organizationVersion: 1 } },
            });
          const evidenceKey = `organization:${organizationHash(JSON.stringify([source.userId, source.id, segmentKey, edge.id, nodeId, evidence]))}`;
          await tx.brainSource.upsert({
            where: { userId_evidenceKey: { userId: source.userId, evidenceKey } },
            update: {},
            create: {
              userId: source.userId,
              edgeId: edge.id,
              nodeId,
              sourceType: 'TRANSCRIPT',
              sourceId: source.id,
              segmentKey,
              evidenceKey,
              excerpt: evidence.excerpt,
              authority: evidence.authority,
              startLine: evidence.startLine,
              endLine: evidence.endLine,
            },
          });
          return true;
        };
        for (const node of analysis.nodes) {
          const resolved = await resolveNode(tx, source.userId, node);
          if (resolved.warning) warnings.add(resolved.warning);
          if (!resolved.node) continue;
          ids.set(node.id, resolved.node.id);
          await writeEdge(
            content.id,
            resolved.node.id,
            'MENTIONS',
            node.evidence,
            resolved.node.id,
          );
        }
        let relationships = 0;
        for (const row of analysis.relationships) {
          const from = ids.get(row.from),
            to = ids.get(row.to);
          if (!from || !to || from === to) continue;
          if (await writeEdge(from, to, row.kind, row.evidence, null)) relationships++;
        }
        const publication = { nodes: ids.size, relationships, warnings: [...warnings] };
        await input.commit(tx, publication);
        await input.assertCurrent(tx);
        await assertGraphLease();
        return publication;
      },
      { timeout: 15_000 },
    );
  });
  if (!applied || !result) throw new OrganizationError('GRAPH_BUSY');
  return result;
}
