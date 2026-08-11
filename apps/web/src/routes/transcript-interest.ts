import type { Hono } from 'hono';
import { z } from 'zod';
import {
  readTranscriptInterest,
  recordTranscriptView,
  setTranscriptPreference,
} from '../lib/personal-interest-signals';
import { rateLimit } from '../lib/rate-limit';

type Vars = { userId: string };

const TranscriptPreferenceSchema = z.object({
  preference: z.enum(['MORE', 'LESS', 'NONE']),
});

export function registerTranscriptInterestRoutes(routes: Hono<{ Variables: Vars }>): void {
  routes.get('/:id/interest', async (c) => {
    const state = await readTranscriptInterest({
      userId: c.get('userId'),
      transcriptId: c.req.param('id'),
    });
    if (!state) return c.json({ error: 'Transcrição não encontrada.' }, 404);
    return c.json(state);
  });

  routes.post('/:id/interest/view', async (c) => {
    const result = await recordTranscriptView({
      userId: c.get('userId'),
      transcriptId: c.req.param('id'),
    });
    if (!result) return c.json({ error: 'Transcrição não encontrada.' }, 404);
    return c.json(result);
  });

  routes.put('/:id/interest', async (c) => {
    const userId = c.get('userId');
    const transcriptId = c.req.param('id');
    const parsed = TranscriptPreferenceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Preferência inválida.' }, 400);

    const rl = await rateLimit(`voxen:rl:interest:${userId}:${transcriptId}`, 30, 60);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.resetIn));
      return c.json({ error: 'Muitas alterações. Tente novamente em instantes.' }, 429);
    }

    const state = await setTranscriptPreference({
      userId,
      transcriptId,
      preference: parsed.data.preference,
    });
    if (!state) return c.json({ error: 'Transcrição não encontrada.' }, 404);
    return c.json(state);
  });
}
