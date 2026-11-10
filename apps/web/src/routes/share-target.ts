// ============================================================================
// PWA Web Share Target (spec 220) — POST /share-target
// ============================================================================
// The installed PWA receives OS shares here as multipart (`title`, `text`,
// `url`, `files[]`, see the manifest in vite.config.ts). It only creates
// capture jobs through the same submit/upload services as /api/captures and
// always answers with a 303 to the capture page. Nothing from the payload is
// ever rendered as HTML: only a validated job/transcript id or a fixed error
// code travels in the redirect, plus the shared URL (query-encoded) when it
// must survive the login round trip.
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { MAX_MEDIA_UPLOAD_REQUEST_BYTES } from '../lib/media-upload';
import {
  submitCaptureUpload,
  submitCaptureUrl,
  submitRateLimited,
  type SubmitOutcome,
} from './captures';

export const shareTargetRoutes = new Hono();

/** Share-only outcomes the capture page knows how to explain. */
export type ShareErrorCode =
  | 'SHARE_EMPTY'
  | 'SHARE_REJECTED'
  | 'SHARE_TOO_LARGE'
  | 'SHARE_LOGIN_FILES'
  | 'SHARE_RATE_LIMITED';

const MAX_SHARED_FILES = 4;
const MAX_SHARED_URL_CHARS = 4096;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION = /[)\]}>.,;:!?'"»”’]+$/u;

/**
 * First http(s) URL of a share payload: the `url` field, then a link inside
 * `text`, then inside `title`. Android apps (YouTube, TikTok, Instagram, X)
 * usually put the link in `text` next to a caption. Canonicalization and the
 * address checks stay in the submit service.
 */
export function extractSharedUrl(fields: {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}): string | null {
  for (const raw of [fields.url, fields.text, fields.title]) {
    if (!raw) continue;
    const match = raw.slice(0, MAX_SHARED_URL_CHARS * 4).match(URL_IN_TEXT);
    if (!match) continue;
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '');
    if (candidate.length > MAX_SHARED_URL_CHARS) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return candidate;
    } catch {
      // not a URL; try the next field
    }
  }
  return null;
}

export function captureRedirect(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `/capturar?${query}` : '/capturar';
}

function loginRedirect(next: string): string {
  return `/entrar?next=${encodeURIComponent(next)}`;
}

function outcomeRedirect(outcome: SubmitOutcome): string {
  if (outcome.kind === 'job') return captureRedirect({ job: outcome.jobId });
  if (outcome.kind === 'existing') return captureRedirect({ existing: outcome.transcriptId });
  return captureRedirect({ error: outcome.code });
}

/** A share comes from the OS (`none`) or the app itself; never from another site. */
function trustedFetchSite(value: string | undefined): boolean {
  return value === undefined || value === 'none' || value === 'same-origin';
}

const ANONYMOUS_SHARE_MAX_BYTES = 64 * 1024;

/**
 * Parses a multipart body only if it fits in `maxBytes` (chunked bodies have
 * no declared length). Returns undefined when the body is larger.
 */
async function readCappedForm(
  request: Request,
  maxBytes: number,
): Promise<FormData | null | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    parts.push(value);
  }
  const headers = { 'content-type': request.headers.get('content-type') ?? '' };
  return new Response(Buffer.concat(parts), { headers }).formData().catch(() => null);
}

function formText(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === 'string' ? value : null;
}

shareTargetRoutes.post('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!trustedFetchSite(c.req.header('sec-fetch-site'))) {
    return c.redirect(captureRedirect({ error: 'SHARE_REJECTED' }), 303);
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > MAX_MEDIA_UPLOAD_REQUEST_BYTES) {
    return c.redirect(captureRedirect({ error: 'SHARE_TOO_LARGE' }), 303);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  // Anonymous shares only carry a link across login, so never buffer a large
  // multipart body for someone who is not signed in.
  if (!session && contentLength > ANONYMOUS_SHARE_MAX_BYTES) {
    await c.req.raw.body?.cancel().catch(() => undefined);
    return c.redirect(loginRedirect(captureRedirect({ error: 'SHARE_LOGIN_FILES' })), 303);
  }
  const form = session
    ? await c.req.formData().catch(() => null)
    : await readCappedForm(c.req.raw, ANONYMOUS_SHARE_MAX_BYTES);
  if (!session && form === undefined) {
    return c.redirect(loginRedirect(captureRedirect({ error: 'SHARE_LOGIN_FILES' })), 303);
  }
  const sharedUrl = form
    ? extractSharedUrl({
        url: formText(form, 'url'),
        text: formText(form, 'text'),
        title: formText(form, 'title'),
      })
    : null;
  const files = (form?.getAll('files') ?? []).filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );

  if (!session) {
    // Store nothing. Only a URL can be carried across login; files need the
    // user to share again once signed in.
    if (files.length > 0)
      return c.redirect(loginRedirect(captureRedirect({ error: 'SHARE_LOGIN_FILES' })), 303);
    if (sharedUrl) return c.redirect(loginRedirect(captureRedirect({ shared: sharedUrl })), 303);
    return c.redirect(loginRedirect('/capturar'), 303);
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') return c.redirect('/pendente', 303);
  const userId = session.user.id;

  if (files.length === 0 && !sharedUrl) {
    return c.redirect(captureRedirect({ error: 'SHARE_EMPTY' }), 303);
  }
  if (await submitRateLimited(userId)) {
    return c.redirect(captureRedirect({ error: 'SHARE_RATE_LIMITED' }), 303);
  }

  if (files.length > 0) {
    let first: SubmitOutcome | null = null;
    let lastFailure: SubmitOutcome | null = null;
    for (const file of files.slice(0, MAX_SHARED_FILES)) {
      const outcome = await submitCaptureUpload(userId, file);
      if (outcome.kind === 'job') first ??= outcome;
      else lastFailure = outcome;
      // Without a text role every file fails the same way; stop early.
      if (outcome.kind === 'error' && outcome.code === 'AI_NOT_CONFIGURED') break;
    }
    const outcome = first ?? lastFailure;
    if (outcome) return c.redirect(outcomeRedirect(outcome), 303);
  }

  return c.redirect(outcomeRedirect(await submitCaptureUrl(userId, sharedUrl)), 303);
});
