import { z } from 'zod';
export const MCP_GRAPH_NODE_SCHEMA = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.string(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  metadata: z.json(),
  updatedAt: z.string(),
  createdAt: z.string().optional(),
});
const endpoint = z.object({ id: z.string(), key: z.string(), label: z.string(), type: z.string() });
const source = z
  .object({
    sourceType: z.string(),
    sourceId: z.string().nullable(),
    startLine: z.number().nullable(),
    endLine: z.number().nullable(),
    startSec: z.number().nullable(),
    endSec: z.number().nullable(),
    excerpt: z.string().nullable(),
    id: z.string().optional(),
    edgeId: z.string().nullable().optional(),
    chunkId: z.string().nullable().optional(),
    fact: z
      .object({
        factKey: z.string(),
        predicate: z.string(),
        validFrom: z.string().nullable(),
        validTo: z.string().nullable(),
        observedAt: z.string(),
        invalidatedAt: z.string().nullable(),
        confidence: z.number(),
        method: z.string(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
export const MCP_GRAPH_OUTPUT_SHAPES = {
  voxen_brain_search: { results: z.array(MCP_GRAPH_NODE_SCHEMA), query: z.string() },
  voxen_brain_neighbors: {
    node: MCP_GRAPH_NODE_SCHEMA,
    edges: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        method: z.string(),
        confidence: z.number(),
        status: z.string(),
        fromNodeId: z.string(),
        toNodeId: z.string(),
        from: MCP_GRAPH_NODE_SCHEMA,
        to: MCP_GRAPH_NODE_SCHEMA,
      }),
    ),
  },
  voxen_brain_sources: { sources: z.array(source), conflicting_sources: z.array(source) },
  voxen_brain_compilation_status: {
    compilation: z
      .object({
        status: z.string(),
        totalSegments: z.number().int(),
        completedSegments: z.number().int(),
        lastError: z.string().nullable(),
        updatedAt: z.string(),
      })
      .nullable(),
  },
  voxen_brain_hubs: {
    hubs: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        label: z.string(),
        type: z.string(),
        degree: z.number().int(),
      }),
    ),
  },
  voxen_brain_path: {
    paths: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        method: z.string(),
        fromNodeId: z.string(),
        toNodeId: z.string(),
        viaNodeId: z.string().nullable(),
        viaLabel: z.string().nullable(),
        depth: z.number().int(),
        nodeIds: z.array(z.string()),
        edges: z.array(
          z.object({
            id: z.string(),
            fromNodeId: z.string(),
            toNodeId: z.string(),
            kind: z.string(),
            method: z.string(),
            reversed: z.boolean(),
          }),
        ),
      }),
    ),
    maxDepth: z.number().int(),
  },
  voxen_brain_timeline: {
    facts: z.array(
      z.object({
        id: z.string(),
        factKey: z.string(),
        predicate: z.string(),
        kind: z.string(),
        confidence: z.number(),
        method: z.string(),
        validFrom: z.string().nullable(),
        validTo: z.string().nullable(),
        observedAt: z.string(),
        invalidatedAt: z.string().nullable(),
        subject: endpoint,
        object: endpoint,
        sources: z.array(
          z.object({ sourceType: z.string(), sourceId: z.string().nullable() }).passthrough(),
        ),
      }),
    ),
  },
};
