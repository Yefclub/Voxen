import { tool } from 'ai';
import { z } from 'zod';
import { queryBrainTimeline } from '../brain-temporal';

export function createBrainTimelineTool(userId: string) {
  return tool({
    description:
      'Consulta fatos temporais citáveis do Brain. Sem período, retorna fatos válidos agora, ' +
      'inclusive os que possuem término futuro; use asOf para um instante histórico ou ' +
      'from/to para sobreposição de janela. ' +
      'Os resultados são conhecimento extraído e exigem verificação das evidências retornadas.',
    inputSchema: z.object({
      query: z.string().min(1).max(300).optional(),
      entityRef: z.string().min(1).max(300).optional(),
      asOf: z.string().datetime({ offset: true }).optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    execute: async (input) => {
      try {
        return { facts: await queryBrainTimeline(userId, input) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Invalid temporal query.' };
      }
    },
  });
}
