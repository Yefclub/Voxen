import { MCP_CORRECTION_OUTPUT_SHAPES } from './mcp-correction-output-schemas';
import { MCP_ENRICHMENT_OUTPUT_SHAPES } from './mcp-enrichment-output-schemas';
import { MCP_PERSONAL_OUTPUT_SHAPE } from './mcp-personal-output-schema';
import { z } from 'zod';
import { MCP_READING_OUTPUT_SHAPES } from './mcp-reading-output-schemas';
import { MCP_GRAPH_OUTPUT_SHAPES } from './mcp-graph-output-schemas';
const additionalShapes: Record<string, z.ZodRawShape> = {
  ...MCP_READING_OUTPUT_SHAPES,
  ...MCP_CORRECTION_OUTPUT_SHAPES,
  ...MCP_ENRICHMENT_OUTPUT_SHAPES,
  ...MCP_GRAPH_OUTPUT_SHAPES,
  voxen_personal_context: MCP_PERSONAL_OUTPUT_SHAPE,
};
export function mcpNormalOutputSchema(name: string, provided: z.ZodRawShape | undefined) {
  const shape = provided ?? additionalShapes[name];
  if (!shape) throw new Error('MCP public output contract is missing');
  return z.object(shape).passthrough();
}
