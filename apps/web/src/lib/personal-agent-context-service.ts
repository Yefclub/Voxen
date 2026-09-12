import { buildPersonalAgentContext, type PersonalAgentContext } from './personal-agent-context';
import { loadPersonalGuideBundle } from './personal-guide-service';

export async function loadPersonalAgentContext(
  userId: string,
  now = new Date(),
): Promise<PersonalAgentContext> {
  const bundle = await loadPersonalGuideBundle(userId, now);
  return buildPersonalAgentContext(bundle);
}
