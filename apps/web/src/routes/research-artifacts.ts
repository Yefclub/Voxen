import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { buildResearchArtifact, resolveArtifactSources } from '../lib/research-artifacts';

type Vars = { userId: string };
export const researchArtifactsRoutes = new Hono<{ Variables: Vars }>();
researchArtifactsRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') return c.json({ error: 'Acesso negado.' }, 403);
  c.set('userId', session.user.id);
  return next();
});
const Body = z
  .object({
    type: z.enum(['BRIEFING', 'FAQ', 'STUDY_GUIDE', 'TIMELINE', 'MIND_MAP']),
    transcriptIds: z.array(z.string()).max(40).optional(),
    folderId: z.string().optional(),
    tagIds: z.array(z.string()).max(20).optional(),
    query: z.string().max(300).optional(),
  })
  .refine(
    (value) =>
      (value.transcriptIds?.length ?? 0) > 0 ||
      Boolean(value.folderId) ||
      (value.tagIds?.length ?? 0) > 0 ||
      Boolean(value.query?.trim()),
    'Selecione ao menos uma fonte, pasta, tag ou busca.',
  );
researchArtifactsRoutes.get('/', async (c) =>
  c.json({
    artifacts: await db.researchArtifact.findMany({
      where: { userId: c.get('userId') },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, title: true, createdAt: true, unavailableSources: true },
    }),
  }),
);
researchArtifactsRoutes.get('/:id', async (c) => {
  const artifact = await db.researchArtifact.findFirst({
    where: { id: c.req.param('id'), userId: c.get('userId') },
  });
  return artifact ? c.json({ artifact }) : c.json({ error: 'Artefato não encontrado.' }, 404);
});
researchArtifactsRoutes.post('/', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Payload inválido.' }, 400);
  const userId = c.get('userId');
  const sources = await resolveArtifactSources(userId, parsed.data);
  if (!sources.length) return c.json({ error: 'Nenhuma fonte acessível foi selecionada.' }, 400);
  const generated = await buildResearchArtifact(userId, parsed.data.type, sources);
  const revision = await db.configRevision.findFirst({
    orderBy: { number: 'desc' },
    select: { id: true },
  });
  const artifact = await db.researchArtifact.create({
    data: {
      userId,
      type: parsed.data.type,
      title: generated.title,
      content: generated.content,
      citations: generated.citations,
      unavailableSources: generated.unavailableSources,
      scope: { ...parsed.data, resolvedTranscriptIds: sources.map((source) => source.id) },
      configRevisionId: revision?.id,
    },
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      citations: true,
      unavailableSources: true,
      createdAt: true,
    },
  });
  return c.json({ artifact }, 201);
});
