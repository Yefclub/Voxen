// ============================================================================
// Web Share Target (PWA)
// ============================================================================
// Android entrega compartilhamentos instalados como POST multipart nesta rota.
// Quando há sessão aprovada, criamos jobs pelo mesmo pipeline de /api/jobs.
// Sem sessão, links sobrevivem ao login via query string; arquivos precisam que
// o usuário já esteja autenticado porque o navegador não reenvia o File depois.
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { MAX_MEDIA_UPLOAD_REQUEST_BYTES } from '../lib/media-upload';
import { createAutoJobForUser, createUploadJobForUser } from './jobs';

export const shareTargetRoutes = new Hono();

type ApprovedSession =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' };

shareTargetRoutes.post('/', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > MAX_MEDIA_UPLOAD_REQUEST_BYTES) {
    return c.redirect(jobsRedirect({ share_error: 'too_large' }), 303);
  }

  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.redirect(jobsRedirect({ share_error: 'invalid_payload' }), 303);
  }

  const sharedUrl = extractSharedUrl([
    formText(form, 'url'),
    formText(form, 'text'),
    formText(form, 'title'),
  ]);
  const files = form
    .getAll('files')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  const session = await approvedSession(c.req.raw.headers);
  if (!session.ok) {
    if (session.reason === 'forbidden') return c.redirect('/pendente', 303);
    if (sharedUrl) return c.redirect(jobsRedirect({ shared: '1', url: sharedUrl }), 303);
    return c.redirect(jobsRedirect({ shared: '1', share_error: 'auth_required_file' }), 303);
  }

  if (files.length > 0) {
    const created: Array<{ jobId: string }> = [];
    let lastError: string | null = null;
    for (const file of files.slice(0, 4)) {
      const result = await createUploadJobForUser(session.userId, file);
      if (result.outcome === 'created') {
        created.push({ jobId: result.jobId });
      } else {
        lastError = result.error;
      }
    }
    if (created.length > 0) {
      return c.redirect(
        jobsRedirect({
          shared: '1',
          jobId: created[0]?.jobId ?? '',
          queued: String(created.length),
          kind: 'file',
        }),
        303,
      );
    }
    return c.redirect(
      jobsRedirect({ shared: '1', share_error: 'upload_failed', detail: lastError }),
      303,
    );
  }

  if (sharedUrl) {
    const result = await createAutoJobForUser(session.userId, sharedUrl);
    if (result.outcome === 'created') {
      return c.redirect(
        jobsRedirect({ shared: '1', jobId: result.jobId, queued: '1', kind: result.kind }),
        303,
      );
    }
    if (result.outcome === 'existing_transcript') {
      return c.redirect(`/transcricoes/${encodeURIComponent(result.transcriptId)}`, 303);
    }
    if (result.outcome === 'inflight' && result.jobId) {
      return c.redirect(`/jobs/${encodeURIComponent(result.jobId)}`, 303);
    }
    return c.redirect(jobsRedirect({ shared: '1', share_error: result.outcome }), 303);
  }

  return c.redirect(jobsRedirect({ shared: '1', share_error: 'missing_content' }), 303);
});

async function approvedSession(headers: Headers): Promise<ApprovedSession> {
  const session = await auth.api.getSession({ headers });
  if (!session) return { ok: false, reason: 'unauthenticated' };
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') return { ok: false, reason: 'forbidden' };
  return { ok: true, userId: session.user.id };
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function extractSharedUrl(values: string[]): string | null {
  for (const value of values) {
    if (!value) continue;
    const direct = normalizeHttpUrl(value);
    if (direct) return direct;
    const match = value.match(/https?:\/\/[^\s<>"']+/i);
    const extracted = match?.[0]?.replace(/[)\].,;!?]+$/g, '') ?? '';
    const normalized = normalizeHttpUrl(extracted);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function jobsRedirect(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/jobs?${query}` : '/jobs';
}
