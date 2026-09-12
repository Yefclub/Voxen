// ============================================================================
// API client — fetch wrapper tipado para /api/*
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const ctype = res.headers.get('content-type') ?? '';
  const isJson = ctype.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  if (!res.ok) {
    const msg =
      (isJson && typeof body === 'object' && body !== null && 'error' in body
        ? String((body as Record<string, unknown>).error)
        : null) ??
      (isJson && typeof body === 'object' && body !== null && 'message' in body
        ? String((body as Record<string, unknown>).message)
        : null) ??
      res.statusText ??
      'Erro inesperado.';
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const apiGet = <T = unknown>(path: string): Promise<T> => api<T>(path);

export const apiPost = <T = unknown>(path: string, data?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined });

export const apiPatch = <T = unknown>(path: string, data?: unknown): Promise<T> =>
  api<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined });

export const apiPut = <T = unknown>(path: string, data?: unknown): Promise<T> =>
  api<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined });

export const apiDelete = <T = unknown>(path: string): Promise<T> =>
  api<T>(path, { method: 'DELETE' });
