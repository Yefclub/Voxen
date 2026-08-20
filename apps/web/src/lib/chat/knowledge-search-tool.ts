import { tool } from 'ai';
import { z } from 'zod';
import { searchKnowledgeBaseMultiQuery } from '../knowledge-search-multiquery';

export function createKnowledgeSearchTool(userId: string) {
  return tool({
    description:
      'Busca na Base de conhecimento inteira (notas curadas, transcrições e contexto externo ' +
      'revisado e aceito). Use como primeiro passo para perguntas factuais ou temáticas. ' +
      'Antes de chamar, proponha até três consultas curtas e semanticamente complementares (a primeira é a intenção principal). ' +
      'Retorna trechos curtos, tipo da fonte e link de citação; abra resultados ' +
      'external_enrichment com read_external_enrichment antes de usá-los.',
    inputSchema: z.object({
      query: z.string().min(1).max(300),
      queries: z.array(z.string().min(1).max(300)).min(1).max(2).optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async ({ query, queries, limit }) => {
      const search = await searchKnowledgeBaseMultiQuery(
        userId,
        [query, ...(queries ?? [])],
        limit ?? 8,
      );
      return {
        results: search.results.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
        searchPlan: search.plan,
      };
    },
  });
}
