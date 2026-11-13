import { z } from 'zod';
import { createAiClient, resolveRoleChain } from '../ai/client';
import { AI_PROVIDERS, REASONING_EFFORTS } from '../ai/catalog';
import { getRoleReasoning } from '../ai/credentials';
import { getSetting, getUserSetting } from '../settings';
import { searchWeb, fetchWebPage } from '../assistant/web';
import type { ResearchDependencies } from './generate';
import { ResearchError } from './queue';

export const ResearchExecutionSchema = z.object({
  language: z.enum(['pt-BR', 'en']),
  reasoning: z.enum(REASONING_EFFORTS),
  chain: z
    .array(z.object({ provider: z.enum(AI_PROVIDERS), model: z.string().min(1).max(120) }))
    .min(1)
    .max(4),
});
export type ResearchExecution = z.infer<typeof ResearchExecutionSchema>;
export type ResearchContext = { execution: ResearchExecution; dependencies: ResearchDependencies };
export function savedResearchExecution(settings: unknown): ResearchExecution | null {
  if (!settings || typeof settings !== 'object' || !('execution' in settings)) return null;
  return ResearchExecutionSchema.parse(settings.execution);
}

export async function prepareResearch(
  userId: string,
  saved: ResearchExecution | null,
): Promise<ResearchContext> {
  if (!(await getUserSetting(userId, 'assistant_search_key')))
    throw new ResearchError('WEB_NOT_CONFIGURED');
  const execution =
    saved ??
    ResearchExecutionSchema.parse({
      language: (await getSetting('app_language')) === 'en' ? 'en' : 'pt-BR',
      reasoning: (await getRoleReasoning(userId)).standard,
      chain: (await resolveRoleChain(userId, 'standard')).map(({ provider, model }) => ({
        provider,
        model,
      })),
    });
  // Freeze model identifiers and reasoning across retries. Credentials
  // are still resolved for this owner on each call and are never persisted here.
  const client = createAiClient({
    getRoles: async () => ({ standard: execution.chain }),
    getReasoning: async () => ({
      fast: execution.reasoning,
      standard: execution.reasoning,
      vision: execution.reasoning,
    }),
  });
  await client.resolveRole(userId, 'standard');
  return {
    execution,
    dependencies: {
      generate: client.generateStructured,
      search: searchWeb,
      fetchPage: fetchWebPage,
    },
  };
}
