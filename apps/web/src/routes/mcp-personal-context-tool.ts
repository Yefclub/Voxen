import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PersonalAgentContext, PersonalAgentSourceRef } from '../lib/personal-agent-context';
import { loadPersonalAgentContext } from '../lib/personal-agent-context-service';
import { fail, ok, READ_ONLY, toMcpContentUrl } from './mcp-tool-helpers';

export function registerMcpPersonalContextTool(
  server: McpServer,
  userId: string,
  publicOrigin: string,
): void {
  server.registerTool(
    'voxen_personal_context',
    {
      title: 'Contexto pessoal explicável',
      description:
        'Retorna um contexto pessoal determinístico e limitado: preferências declaradas, ' +
        'interesses inferidos, tendências e fontes priorizadas pelo grafo. Use para orientar ' +
        'descoberta e recomendações, nunca como evidência factual. Abra e verifique as fontes ' +
        'antes de afirmar seu conteúdo.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Contexto pessoal explicável' },
    },
    async () => {
      try {
        const context = await loadPersonalAgentContext(userId);
        return ok({ ...withPublicLinks(context, publicOrigin) });
      } catch {
        return fail('O contexto pessoal não está disponível neste momento.');
      }
    },
  );
}

function withPublicLinks(
  context: PersonalAgentContext,
  publicOrigin: string,
): PersonalAgentContext {
  const evidence = (items: PersonalAgentSourceRef[]) =>
    items.map((item) => ({ ...item, href: toMcpContentUrl(publicOrigin, item.href) }));
  return {
    ...context,
    preferences: context.preferences.map((preference) => ({
      ...preference,
      evidence: evidence(preference.evidence),
    })),
    trends: context.trends.map((trend) => ({ ...trend, evidence: evidence(trend.evidence) })),
    recommendations: context.recommendations.map((recommendation) => ({
      ...recommendation,
      href: toMcpContentUrl(publicOrigin, recommendation.href),
      reasons: recommendation.reasons.map((reason) => ({
        ...reason,
        evidence: evidence(reason.evidence),
      })),
    })),
  };
}
