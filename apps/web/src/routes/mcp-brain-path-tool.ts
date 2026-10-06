import { withMcpReadDeadline } from './mcp-read-deadline';
import { Prisma } from '../../prisma-generated/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { currentBrainNodeSourceCondition } from '../lib/brain-source-visibility';
import { fail, ok, READ_ONLY } from './mcp-tool-helpers';

type PathRow = {
  id: string;
  kind: string;
  method: string;
  fromNodeId: string;
  toNodeId: string;
  viaNodeId: string | null;
  viaLabel: string | null;
  depth: number;
  nodeIds: string[];
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    kind: string;
    method: string;
    reversed: boolean;
  }>;
};

export function registerBrainPathTool(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_brain_path',
    {
      title: 'Conexão entre dois nós',
      description:
        'Tenta encontrar caminhos simples de até 3 saltos entre dois nós ativos do Brain. Retorna a ordem de navegação e a direção de cada aresta; abra as evidências antes de afirmar fatos.',
      inputSchema: {
        from_node_id: z.string().min(1).max(300).describe('ID ou key do nó de origem.'),
        to_node_id: z.string().min(1).max(300).describe('ID ou key do nó de destino.'),
        max_depth: z.number().int().min(1).max(3).optional(),
      },
      annotations: { ...READ_ONLY, title: 'Conexão entre dois nós' },
    },
    async (args) => {
      const fromRef = args.from_node_id.trim();
      const toRef = args.to_node_id.trim();
      if (!fromRef || !toRef) return fail('from_node_id e to_node_id são obrigatórios.');
      const maxDepth = args.max_depth ?? 3;
      try {
        const paths = await withMcpReadDeadline(async (tx) => {
          return tx.$queryRaw<PathRow[]>`
          WITH RECURSIVE visible_nodes AS (
            SELECT n.* FROM "BrainNode" n
            WHERE n."userId" = ${userId} AND n.status = 'ACTIVE'::"ContentStatus"
              AND ${currentBrainNodeSourceCondition('n')}
          ), endpoints AS (
            SELECT
              (SELECT id FROM visible_nodes WHERE id = ${fromRef} OR key = ${fromRef} ORDER BY id LIMIT 1) AS from_id,
              (SELECT id FROM visible_nodes WHERE id = ${toRef} OR key = ${toRef} ORDER BY id LIMIT 1) AS to_id
          ), active_edges AS (
            SELECT e.* FROM "BrainEdge" e
            JOIN visible_nodes f ON f.id = e."fromNodeId"
            JOIN visible_nodes t ON t.id = e."toNodeId"
            WHERE e."userId" = ${userId} AND e.status = 'ACTIVE'::"ContentStatus"
          ), walk AS (
            SELECT ep.from_id AS current_id, ARRAY[ep.from_id]::text[] AS node_ids,
              ARRAY[n.label]::text[] AS node_labels, ARRAY[]::text[] AS edge_ids,
              ARRAY[]::text[] AS kinds, ARRAY[]::text[] AS methods,
              '[]'::jsonb AS traversal, 0 AS depth
            FROM endpoints ep JOIN visible_nodes n ON n.id = ep.from_id
            WHERE ep.to_id IS NOT NULL AND ep.from_id <> ep.to_id
            UNION ALL
            SELECT next.id, w.node_ids || next.id, w.node_labels || next.label,
              w.edge_ids || e.id, w.kinds || e.kind::text, w.methods || e.method,
              w.traversal || jsonb_build_object('id', e.id, 'fromNodeId', e."fromNodeId",
                'toNodeId', e."toNodeId", 'kind', e.kind, 'method', e.method,
                'reversed', e."toNodeId" = w.current_id), w.depth + 1
            FROM walk w JOIN endpoints ep ON TRUE
            JOIN active_edges e ON e."fromNodeId" = w.current_id OR e."toNodeId" = w.current_id
            JOIN visible_nodes next ON next.id = CASE WHEN e."fromNodeId" = w.current_id THEN e."toNodeId" ELSE e."fromNodeId" END
            WHERE w.depth < ${maxDepth} AND w.current_id <> ep.to_id
              AND NOT next.id = ANY(w.node_ids)
              AND (w.depth + 1 < ${maxDepth} OR next.id = ep.to_id)
          )
          SELECT array_to_string(w.edge_ids, ':') AS id,
            array_to_string(w.kinds, ' -> ') AS kind, array_to_string(w.methods, ' -> ') AS method,
            w.node_ids[1] AS "fromNodeId", w.current_id AS "toNodeId",
            CASE WHEN w.depth > 1 THEN w.node_ids[2] ELSE NULL END AS "viaNodeId",
            CASE WHEN w.depth > 1 THEN array_to_string(w.node_labels[2:w.depth], ' / ') ELSE NULL END AS "viaLabel",
            w.depth, w.node_ids AS "nodeIds", w.traversal AS edges
          FROM walk w JOIN endpoints ep ON w.current_id = ep.to_id
          WHERE w.depth > 0 ORDER BY w.depth, id LIMIT 15
        `;
        });
        return ok({ paths, maxDepth });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2010' &&
          error.meta?.code === '57014'
        ) {
          return fail(
            'GRAPH_QUERY_TIMEOUT: a consulta excedeu o limite. Tente um caminho mais curto.',
          );
        }
        throw error;
      }
    },
  );
}
