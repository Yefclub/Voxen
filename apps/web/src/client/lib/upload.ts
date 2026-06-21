// ============================================================================
// Upload de mídia — presigned direto pro S3 com fallback pro upload via app
// ============================================================================
// Fluxo:
//   1. POST /api/jobs/upload/presign → se { enabled: true }, faz PUT direto na
//      URL assinada (com progresso via XHR) e depois POST /api/jobs/upload/confirm.
//   2. Se { enabled: false } ou o presign falhar → fallback POST /api/jobs/upload
//      (corpo passa pelo app; sujeito ao limite do Cloudflare).
// ============================================================================

import { ApiError } from './api';

export type UploadKind = 'media' | 'image' | 'document';

export interface UploadResult {
  jobId: string;
  status: string;
  sourceUrl: string;
  kind: UploadKind;
  /** true se o objeto subiu direto pro S3 via presigned URL. */
  viaPresigned: boolean;
}

interface PresignResponse {
  enabled: boolean;
  uploadId?: string;
  sourceUrl?: string;
  key?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  expiresIn?: number;
}

interface JobResponse {
  jobId?: string;
  status?: string;
  sourceUrl?: string;
  kind?: UploadKind;
  error?: string;
}

/** Faz um PUT com progresso. Resolve no fim, rejeita em erro/timeout/abort. */
function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError('presigned_put_failed', xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('presigned_put_network', 0));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/** Upload via app (fallback) — corpo passa pelo servidor (sujeito a limite do CF). */
async function uploadViaApp(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const body: JobResponse = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs/upload', true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      let parsed: JobResponse = {};
      try {
        parsed = JSON.parse(xhr.responseText) as JobResponse;
      } catch {
        parsed = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.jobId) {
        resolve(parsed);
      } else {
        reject(new ApiError(parsed.error ?? 'upload_failed', xhr.status, parsed));
      }
    };
    xhr.onerror = () => reject(new ApiError('upload_network', 0));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    form.append('media', file);
    xhr.send(form);
  });

  return {
    jobId: body.jobId as string,
    status: body.status ?? 'QUEUED',
    sourceUrl: body.sourceUrl ?? '',
    kind: body.kind ?? 'media',
    viaPresigned: false,
  };
}

/**
 * Decide entre presigned e fallback e executa o upload completo.
 *
 * - Validação de formato/tamanho é feita no backend (presign e confirm).
 * - Erros do presign que NÃO sejam de indisponibilidade (400/412/413) são
 *   propagados — não faz sentido tentar fallback se o backend já recusou.
 * - Indisponibilidade ({ enabled: false }) ou falha de rede/5xx no PUT presigned
 *   caem no fallback.
 */
export async function uploadMedia(
  file: File,
  opts: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  const { onProgress, signal } = opts;

  // 1) Tenta presign.
  let presign: PresignResponse | null = null;
  try {
    const res = await fetch('/api/jobs/upload/presign', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as PresignResponse & { error?: string };
    if (!res.ok) {
      // Validação recusou (formato/tamanho/setup). Propaga — fallback recusaria igual.
      throw new ApiError(body.error ?? 'presign_failed', res.status, body);
    }
    presign = body;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Erro de rede no presign → tenta fallback.
    presign = null;
  }

  // 2) Presigned disponível → PUT direto + confirm.
  if (presign?.enabled && presign.url && presign.uploadId) {
    try {
      await putWithProgress(
        presign.url,
        file,
        presign.headers ?? { 'Content-Type': file.type || 'application/octet-stream' },
        onProgress,
        signal,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // PUT direto falhou (CORS, rede, 5xx do S3) → fallback via app.
      return uploadViaApp(file, onProgress, signal);
    }

    const confirmRes = await fetch('/api/jobs/upload/confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        uploadId: presign.uploadId,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
      }),
    });
    const confirmBody = (await confirmRes.json().catch(() => ({}))) as JobResponse;
    if (!confirmRes.ok || !confirmBody.jobId) {
      throw new ApiError(confirmBody.error ?? 'confirm_failed', confirmRes.status, confirmBody);
    }
    return {
      jobId: confirmBody.jobId,
      status: confirmBody.status ?? 'QUEUED',
      sourceUrl: confirmBody.sourceUrl ?? presign.sourceUrl ?? '',
      kind: confirmBody.kind ?? 'media',
      viaPresigned: true,
    };
  }

  // 3) Presigned indisponível → fallback via app.
  return uploadViaApp(file, onProgress, signal);
}
