// ============================================================================
// GET /api/releases — changelog gerado pelo pipeline (releases.json)
// ============================================================================
// Lê o manifesto versionado no repo (copiado na imagem). Autenticado.
// ============================================================================

import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { parseReleaseFeedQuery, selectReleaseFeedPage } from '../shared/release-feed';

type Vars = { userId: string };

export const releasesRoutes = new Hono<{ Variables: Vars }>();

releasesRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  c.set('userId', session.user.id);
  return next();
});

export type ReleaseEntry = {
  version: string;
  channel: 'dev' | 'prod' | string;
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
  pr?: number | null;
  prUrl?: string;
  author?: string | null;
  date?: string;
  promoted?: Array<{
    type?: string;
    title?: string;
    body?: string;
    summary?: string;
    pr?: number | null;
    prUrl?: string;
  }>;
};

async function loadReleases(): Promise<ReleaseEntry[]> {
  const candidates = [
    process.env.VOXEN_RELEASES_PATH,
    join(process.cwd(), 'releases.json'),
    join(process.cwd(), '..', '..', 'releases.json'),
    join(process.cwd(), '..', 'releases.json'),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) return data as ReleaseEntry[];
    } catch {
      /* try next */
    }
  }
  return [];
}

releasesRoutes.get('/', async (c) => {
  const query = parseReleaseFeedQuery({
    channel: c.req.query('channel'),
    type: c.req.query('type'),
    query: c.req.query('q'),
    version: c.req.query('version'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  return c.json(selectReleaseFeedPage(await loadReleases(), query));
});
