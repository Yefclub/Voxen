import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { queryBrainTimeline } from '../lib/brain-temporal';
import { fail, ok, READ_ONLY } from './mcp-tool-helpers';

export function registerBrainTimelineTool(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_brain_timeline',
    {
      title: 'Consultar linha do tempo do Brain',
      description:
        'Consulta relações temporais extraídas e citáveis. Sem período, retorna fatos atuais ' +
        '(sem término ou com término futuro); as_of consulta um instante; from/to consulta ' +
        'sobreposição de intervalo. ' +
        'Use as evidências retornadas antes de apresentar qualquer relação como fato.',
      inputSchema: {
        query: z.string().min(1).max(300).optional(),
        entity_ref: z.string().min(1).max(300).optional(),
        as_of: z.string().datetime({ offset: true }).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { ...READ_ONLY, title: 'Consultar linha do tempo do Brain' },
    },
    async (args) => {
      try {
        const facts = await queryBrainTimeline(userId, {
          query: args.query,
          entityRef: args.entity_ref,
          asOf: args.as_of,
          from: args.from,
          to: args.to,
          limit: args.limit,
        });
        return ok({ facts });
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'Consulta temporal inválida.');
      }
    },
  );
}
