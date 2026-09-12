import type { Hono } from 'hono';
import { z } from 'zod';
import {
  detectUploadKind,
  maxBytesForKind,
  sanitizeUploadFilename,
  tooLargeMessageForKind,
  uploadObjectKey,
} from '../lib/media-upload';
import { safeErrorDiagnostic } from '../lib/safe-diagnostics';
import { storageDelete, storagePut } from '../lib/storage';

type DirectUploadRoutes = Hono<{ Variables: { userId: string } }>;

export function registerDirectUploadRoute(routes: DirectUploadRoutes): void {
  routes.put('/upload/direct/:uploadId', async (c) => {
    const userId = c.get('userId');
    const uploadId = c.req.param('uploadId');
    if (!z.string().uuid().safeParse(uploadId).success) {
      return c.json({ error: 'Upload inválido.' }, 400);
    }
    const filename = sanitizeUploadFilename(c.req.query('filename') ?? '');
    const contentType = c.req.header('content-type') || 'application/octet-stream';
    const kind = detectUploadKind(filename, contentType);
    if (!kind) return c.json({ error: 'Formato não suportado.' }, 400);
    const declaredLength = Number(c.req.header('content-length') ?? '0');
    const limit = maxBytesForKind(kind);
    if (declaredLength > limit) return c.json({ error: tooLargeMessageForKind(kind) }, 413);
    if (!c.req.raw.body) return c.json({ error: 'Arquivo vazio.' }, 400);

    const key = uploadObjectKey(userId, uploadId, filename);
    try {
      const storedBytes = await storagePut({
        key,
        body: c.req.raw.body,
        contentType,
        maxBytes: limit,
        signal: c.req.raw.signal,
      });
      if (storedBytes <= 0) {
        await storageDelete(key).catch(() => undefined);
        return c.json({ error: 'Arquivo vazio.' }, 400);
      }
      return c.json({ ok: true, storedBytes });
    } catch (error) {
      await storageDelete(key).catch(() => undefined);
      if ((error as { code?: string }).code === 'ETOOBIG') {
        return c.json({ error: tooLargeMessageForKind(kind) }, 413);
      }
      console.error('[jobs] application upload failed', {
        upload_id: uploadId,
        content_kind: kind,
        ...safeErrorDiagnostic('UPLOAD_STREAM_FAILED', error),
      });
      return c.json({ error: 'Falha ao armazenar upload.' }, 502);
    }
  });
}
