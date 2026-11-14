import { z } from 'zod';
import { createAiClient, resolveRoleChain } from '../ai/client';
import { AI_PROVIDERS, REASONING_EFFORTS } from '../ai/catalog';
import { getRoleReasoning } from '../ai/credentials';
import { getSetting } from '../settings';

export const OrganizationExecutionSchema = z.object({
  language: z.enum(['pt-BR', 'en']),
  reasoning: z.enum(REASONING_EFFORTS),
  chain: z
    .array(z.object({ provider: z.enum(AI_PROVIDERS), model: z.string().min(1).max(120) }))
    .min(1)
    .max(4),
});
export type OrganizationExecution = z.infer<typeof OrganizationExecutionSchema>;
export type OrganizationContext = Awaited<ReturnType<typeof prepareOrganization>>;
export function savedOrganizationExecution(settings: unknown): OrganizationExecution | null {
  if (!settings || typeof settings !== 'object' || !('execution' in settings)) return null;
  return OrganizationExecutionSchema.parse(settings.execution);
}
export async function prepareOrganization(userId: string, saved: OrganizationExecution | null) {
  const execution =
    saved ??
    OrganizationExecutionSchema.parse({
      language: (await getSetting('app_language')) === 'en' ? 'en' : 'pt-BR',
      reasoning: (await getRoleReasoning(userId)).standard,
      chain: (await resolveRoleChain(userId, 'standard')).map(({ provider, model }) => ({
        provider,
        model,
      })),
    });
  const client = createAiClient({
    getRoles: async () => ({ standard: execution.chain }),
    getReasoning: async () => ({
      fast: execution.reasoning,
      standard: execution.reasoning,
      vision: execution.reasoning,
    }),
  });
  await client.resolveRole(userId, 'standard');
  return { execution, generate: client.generateStructured };
}
