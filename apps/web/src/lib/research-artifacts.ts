import { db } from './db';
import { loadTranscriptMd, readLinesFromMd } from './retrieval';

export type ArtifactType = 'BRIEFING' | 'FAQ' | 'STUDY_GUIDE' | 'TIMELINE' | 'MIND_MAP';
export type ArtifactCitation = {
  sourceType: 'TRANSCRIPT';
  sourceId: string;
  title: string;
  quote: string;
  fromLine: number;
  toLine: number;
  href: string;
  verified: true;
};
export type UnavailableArtifactSource = { id: string; title: string };

type ScopeInput = {
  transcriptIds?: string[];
  folderId?: string;
  tagIds?: string[];
  query?: string;
};
type ArtifactSource = { id: string; title: string; url: string; publishedAt: Date | null };
type ResolvedArtifactScope = {
  sources: ArtifactSource[];
  unavailableSources: UnavailableArtifactSource[];
};

export async function resolveArtifactSources(
  userId: string,
  scope: ScopeInput,
): Promise<ResolvedArtifactScope> {
  const requested = [...new Set(scope.transcriptIds ?? [])].slice(0, 40);
  const where = {
    userId,
    status: 'ACTIVE' as const,
    ...(requested.length ? { id: { in: requested } } : {}),
    ...(scope.folderId ? { folderId: scope.folderId } : {}),
    ...(scope.tagIds?.length ? { tags: { some: { tagId: { in: scope.tagIds } } } } : {}),
    ...(scope.query
      ? {
          OR: [
            { title: { contains: scope.query, mode: 'insensitive' as const } },
            { plainText: { contains: scope.query, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [sources, unavailableSources] = await Promise.all([
    db.transcript.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, title: true, url: true, publishedAt: true },
    }),
    requested.length
      ? db.transcript.findMany({
          where: { userId, id: { in: requested }, status: { not: 'ACTIVE' } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
  ]);
  return { sources, unavailableSources };
}

export async function buildResearchArtifact(
  userId: string,
  type: ArtifactType,
  sources: ArtifactSource[],
  initiallyUnavailableSources: UnavailableArtifactSource[] = [],
): Promise<{
  title: string;
  content: string;
  citations: ArtifactCitation[];
  unavailableSources: UnavailableArtifactSource[];
}> {
  const evidence: ArtifactCitation[] = [];
  const unavailableSources: UnavailableArtifactSource[] = [...initiallyUnavailableSources];
  for (const source of [...sources].sort(
    (left, right) =>
      (left.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (right.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
  )) {
    try {
      const loaded = await loadTranscriptMd(userId, source.id);
      if (!loaded) {
        unavailableSources.push({ id: source.id, title: source.title });
        continue;
      }
      const excerpt = readLinesFromMd(loaded.md, 1, 12);
      const quote = excerpt.lines
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 600);
      if (!quote || excerpt.lines.length === 0) {
        unavailableSources.push({ id: source.id, title: source.title });
        continue;
      }
      evidence.push({
        sourceType: 'TRANSCRIPT',
        sourceId: source.id,
        title: source.title,
        quote,
        fromLine: excerpt.from,
        toLine: excerpt.to,
        href: `/transcricoes/${source.id}#l=${excerpt.from}`,
        verified: true,
      });
    } catch {
      unavailableSources.push({ id: source.id, title: source.title });
    }
  }
  return renderResearchArtifact(type, evidence, unavailableSources);
}

export function renderResearchArtifact(
  type: ArtifactType,
  evidence: ArtifactCitation[],
  unavailableSources: UnavailableArtifactSource[] = [],
): {
  title: string;
  content: string;
  citations: ArtifactCitation[];
  unavailableSources: UnavailableArtifactSource[];
} {
  const lines = evidence.map(
    (item, index) => `[^${index + 1}]: [${item.title}](${item.href}) — “${item.quote}”`,
  );
  const refs = evidence.map((_, index) => `[^${index + 1}]`);
  const entries = evidence.map((item, index) => `- ${item.title} ${refs[index]}`).join('\n');
  const title = labels[type];
  const body = templates[type](evidence, refs, entries);
  return {
    title,
    content: `${body}\n\n## Evidências\n${lines.join('\n') || 'Nenhuma evidência verificável foi encontrada.'}`,
    citations: evidence,
    unavailableSources: Array.from(
      new Map(unavailableSources.map((source) => [source.id, source])).values(),
    ),
  };
}

const labels: Record<ArtifactType, string> = {
  BRIEFING: 'Briefing de pesquisa',
  FAQ: 'FAQ fundamentado',
  STUDY_GUIDE: 'Guia de estudo',
  TIMELINE: 'Linha do tempo',
  MIND_MAP: 'Mapa mental',
};
const templates: Record<
  ArtifactType,
  (e: ArtifactCitation[], refs: string[], entries: string) => string
> = {
  BRIEFING: (_e, _r, entries) => `# Briefing\n\n## Fontes analisadas\n${entries}`,
  FAQ: (e, r) =>
    `# FAQ\n\n${e.map((item, i) => `## O que a fonte “${item.title}” apresenta?\n${item.quote} ${r[i]}`).join('\n\n') || 'Sem evidência suficiente.'}`,
  STUDY_GUIDE: (e, r) =>
    `# Guia de estudo\n\n${e.map((item, i) => `1. Estude **${item.title}** e registre o ponto central: ${item.quote} ${r[i]}`).join('\n') || 'Sem evidência suficiente.'}`,
  TIMELINE: (e, r) =>
    `# Linha do tempo de fontes\n\n${e.map((item, i) => `- **${item.title}**: ${item.quote} ${r[i]}`).join('\n') || 'Sem evidência suficiente.'}`,
  MIND_MAP: (e, r) =>
    `# Mapa mental\n\n- Tema\n${e.map((item, i) => `  - ${item.title}\n    - ${item.quote} ${r[i]}`).join('\n') || '  - Sem evidência suficiente.'}`,
};
