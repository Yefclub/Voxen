import { Hono } from 'hono';
import { db } from '../lib/db';
import { getSetting, setSettings } from '../lib/settings';
import type { AdminVariables } from './admin-guard';

export const adminResearchPolicyRoutes = new Hono<{ Variables: AdminVariables }>();

adminResearchPolicyRoutes.get('/', async (c) => {
  const stored = (await getSetting('summary_research_mode').catch(() => null))?.toUpperCase();
  const mode = stored === 'MANUAL' || stored === 'AUTO' ? stored : 'OFF';
  return c.json({ mode });
});

adminResearchPolicyRoutes.patch('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = typeof body.mode === 'string' ? body.mode.trim().toUpperCase() : '';
  if (mode !== 'OFF' && mode !== 'MANUAL' && mode !== 'AUTO') {
    return c.json({ error: 'Envie mode como OFF, MANUAL ou AUTO.' }, 400);
  }
  await setSettings(
    { summary_research_mode: mode },
    { actorUserId: c.get('adminUserId'), reason: 'Update transcript research policy' },
  );
  if (mode !== 'AUTO') await cancelExcludedResearch(mode);
  return c.json({ mode });
});

async function cancelExcludedResearch(mode: 'OFF' | 'MANUAL'): Promise<void> {
  const triggerFilter = mode === 'MANUAL' ? { trigger: 'AUTO' as const } : {};
  const now = new Date();
  await db.transcriptEnrichment.updateMany({
    where: { ...triggerFilter, status: { in: ['PENDING', 'RETRY', 'RUNNING'] } },
    data: { cancelRequestedAt: now },
  });
}
