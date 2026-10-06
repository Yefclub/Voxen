import { mcpHubsQuery } from './mcp-hubs-query';
import { withMcpReadDeadline } from './mcp-read-deadline';
import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/server';
import { db } from '../lib/db';
import { searchBrainNodes } from '../lib/brain-search';
import { bounded, fail, ok, publicMcpProcessingError, READ_ONLY } from './mcp-tool-helpers';
import { registerBrainPathTool } from './mcp-brain-path-tool';
import { filterAccessibleBrainNodes } from '../lib/brain-source-visibility';
import { registerBrainTimelineTool } from './mcp-brain-timeline-tool';
import { keepCurrentOwnedSources } from './mcp-brain-source-lifecycle';

export function registerBrainTools(server: McpServer, userId: string): void {
  registerBrainTimelineTool(server, userId);

  server.registerTool(
    'voxen_brain_search',
    {
      title: 'Buscar nós no Brain',
      description:
        'Busca nós no grafo de conhecimento "Voxen Brain" por label, descrição ou key. ' +
        'Nós representam conteúdos, entidades, tópicos, claims e clusters derivados da Base de conhecimento. ' +
        'Use voxen_brain_neighbors para expandir um nó e voxen_brain_sources para ver evidências.',
      inputSchema: {
        query: z.string().min(1).describe('Texto a casar em key/label/description.'),
        limit: z.number().int().min(1).max(30).optional().describe('Máx. nós (padrão 8).'),
        include_archived: z.boolean().optional().describe('Inclui nós arquivados (padrão false).'),
      },
      annotations: { ...READ_ONLY, title: 'Buscar nós no Brain' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const limit = bounded(args.limit, 8, 1, 30);
      const nodes = args.include_archived
        ? await db.brainNode.findMany({
            where: {
              userId,
              status: { in: ['ACTIVE', 'ARCHIVED'] },
              OR: [
                { key: { contains: query, mode: 'insensitive' } },
                { label: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
              ],
            },
            orderBy: { updatedAt: 'desc' },
            take: limit,
            select: BRAIN_NODE_SELECT,
          })
        : await searchBrainNodes(userId, query, limit);
      return ok({
        results: args.include_archived
          ? await filterAccessibleBrainNodes(userId, nodes, true)
          : nodes,
        query,
      });
    },
  );

  server.registerTool(
    'voxen_brain_neighbors',
    {
      title: 'Vizinhos de um nó',
      description:
        'Expande os vizinhos diretos de um nó do Brain (por id ou key), retornando o nó e suas ' +
        'arestas de entrada/saída com os nós conectados. Use para navegar relações a partir de ' +
        'um nó achado em voxen_brain_search.',
      inputSchema: {
        node_id: z.string().min(1).describe('ID ou key do nó central.'),
        limit: z.number().int().min(1).max(80).optional().describe('Máx. arestas (padrão 30).'),
        include_archived: z.boolean().optional(),
      },
      annotations: { ...READ_ONLY, title: 'Vizinhos de um nó' },
    },
    async (args) => {
      const ref = args.node_id.trim();
      if (!ref) return fail('node_id obrigatório.');
      const node = await db.brainNode.findFirst({
        where: {
          userId,
          OR: [{ id: ref }, { key: ref }],
          status: { in: args.include_archived ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE'] },
        },
        select: BRAIN_NODE_SELECT,
      });
      if (
        !node ||
        !(await filterAccessibleBrainNodes(userId, [node], args.include_archived)).length
      )
        return fail('Nó não encontrado.');
      const edges = await db.brainEdge.findMany({
        where: {
          userId,
          OR: [{ fromNodeId: node.id }, { toNodeId: node.id }],
          ...(args.include_archived
            ? {
                status: { in: ['ACTIVE', 'ARCHIVED'] },
                from: { userId, status: { in: ['ACTIVE', 'ARCHIVED'] } },
                to: { userId, status: { in: ['ACTIVE', 'ARCHIVED'] } },
              }
            : {
                status: 'ACTIVE' as const,
                from: { userId, status: 'ACTIVE' as const },
                to: { userId, status: 'ACTIVE' as const },
              }),
        },
        orderBy: { updatedAt: 'desc' },
        take: bounded(args.limit, 30, 1, 80),
        select: {
          id: true,
          kind: true,
          method: true,
          confidence: true,
          status: true,
          fromNodeId: true,
          toNodeId: true,
          from: { select: BRAIN_NODE_SELECT },
          to: { select: BRAIN_NODE_SELECT },
        },
      });
      const visible = new Set(
        (
          await filterAccessibleBrainNodes(
            userId,
            edges.flatMap((edge) => [edge.from, edge.to]),
            args.include_archived,
          )
        ).map((item) => item.id),
      );
      return ok({
        node,
        edges: edges
          .filter((edge) => visible.has(edge.from.id) && visible.has(edge.to.id))
          .map((edge) => ({ ...edge, confidence: Number(edge.confidence) })),
      });
    },
  );

  server.registerTool(
    'voxen_brain_sources',
    {
      title: 'Evidências de um nó/aresta',
      description:
        'Retorna as evidências (proveniência) de um nó, aresta ou sourceId do Brain: tipo de ' +
        'fonte, id, recorte de timestamps e trecho de evidência. Use para CITAR a origem de um ' +
        'claim ou relação antes de afirmar algo.',
      inputSchema: {
        ref: z.string().min(1).describe('node_id, edge_id, key do nó ou sourceId.'),
        limit: z.number().int().min(1).max(50).optional().describe('Máx. evidências (padrão 20).'),
      },
      annotations: { ...READ_ONLY, title: 'Evidências de um nó/aresta' },
    },
    async (args) => {
      const ref = args.ref.trim();
      if (!ref) return fail('ref obrigatório.');
      const sources = await db.brainSource.findMany({
        where: {
          userId,
          invalidatedAt: null,
          AND: [{ OR: [{ factId: null }, { fact: { is: { invalidatedAt: null } } }] }],
          OR: [{ nodeId: ref }, { edgeId: ref }, { sourceId: ref }, { node: { key: ref } }],
        },
        orderBy: { createdAt: 'desc' },
        take: bounded(args.limit, 20, 1, 50),
        select: {
          id: true,
          nodeId: true,
          edgeId: true,
          factId: true,
          sourceType: true,
          sourceId: true,
          chunkId: true,
          startLine: true,
          endLine: true,
          startSec: true,
          endSec: true,
          excerpt: true,
          fact: {
            select: {
              factKey: true,
              predicate: true,
              validFrom: true,
              validTo: true,
              observedAt: true,
              invalidatedAt: true,
              confidence: true,
              method: true,
            },
          },
        },
      });
      const contradiction = await db.brainEdge.findFirst({
        where: { userId, id: ref, kind: 'CONTRADICTS', status: 'ACTIVE' },
        select: { fromNodeId: true, toNodeId: true },
      });
      const conflictingSources = contradiction
        ? (
            await Promise.all(
              [contradiction.fromNodeId, contradiction.toNodeId].map((claimNodeId) =>
                db.brainSource.findMany({
                  where: {
                    userId,
                    invalidatedAt: null,
                    AND: [{ OR: [{ factId: null }, { fact: { is: { invalidatedAt: null } } }] }],
                    edge: {
                      method: 'llm-grounded',
                      kind: 'SUPPORTS',
                      toNodeId: claimNodeId,
                    },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 10,
                  select: {
                    edgeId: true,
                    sourceType: true,
                    sourceId: true,
                    startLine: true,
                    endLine: true,
                    startSec: true,
                    endSec: true,
                    excerpt: true,
                  },
                }),
              ),
            )
          ).flat()
        : [];
      const [currentSources, currentConflicts] = await Promise.all([
        keepCurrentOwnedSources(userId, sources),
        keepCurrentOwnedSources(userId, conflictingSources),
      ]);
      return ok({
        sources: currentSources.map((source) => ({
          ...source,
          fact: source.fact ? { ...source.fact, confidence: Number(source.fact.confidence) } : null,
        })),
        conflicting_sources: currentConflicts,
      });
    },
  );

  server.registerTool(
    'voxen_brain_compilation_status',
    {
      title: 'Status de compilação do Brain',
      description:
        'Retorna a cobertura da extração grounded de um conteúdo: estado, quantidade total de ' +
        'segmentos e quantidade concluída. Use antes de tratar o Brain como cobertura completa.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID do conteúdo na Base de conhecimento.'),
      },
      annotations: { ...READ_ONLY, title: 'Status de compilação do Brain' },
    },
    async (args) => {
      const transcriptId = args.transcript_id.trim();
      if (!transcriptId) return fail('transcript_id obrigatório.');
      const compilation = await db.brainCompilation.findFirst({
        where: { userId, transcriptId },
        select: {
          status: true,
          totalSegments: true,
          completedSegments: true,
          lastError: true,
          updatedAt: true,
        },
      });
      return ok({
        compilation: compilation
          ? { ...compilation, lastError: publicMcpProcessingError(compilation.lastError) }
          : null,
      });
    },
  );

  registerBrainPathTool(server, userId);

  server.registerTool(
    'voxen_brain_hubs',
    {
      title: 'Hubs do grafo (god nodes)',
      description:
        'Lista os nós mais conectados do Brain (maior grau). Use para ver o que concentra ' +
        'relações na Base de conhecimento — tópicos/entidades “centrais”.',
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional().describe('Quantos hubs (default 10).'),
      },
      annotations: { ...READ_ONLY, title: 'Hubs do grafo' },
    },
    async (args) => {
      const limit = args.limit ?? 10;
      type HubRow = {
        id: string;
        key: string;
        label: string;
        type: string;
        degree: number;
      };
      const hubs = await withMcpReadDeadline((tx) =>
        tx.$queryRaw<HubRow[]>(mcpHubsQuery(userId, limit)),
      );
      return ok({ hubs });
    },
  );
}

const BRAIN_NODE_SELECT = {
  id: true,
  key: true,
  type: true,
  label: true,
  description: true,
  status: true,
  sourceType: true,
  sourceId: true,
  metadata: true,
  updatedAt: true,
} as const;
