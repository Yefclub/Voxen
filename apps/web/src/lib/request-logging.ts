import type { Context, Next } from 'hono';
import { structuredLog, validCorrelationId } from './structured-log';

export async function requestLogging(c: Context, next: Next): Promise<void> {
  const requestId = validCorrelationId(c.req.header('x-request-id')) ?? crypto.randomUUID();
  const startedAt = performance.now();
  c.header('x-request-id', requestId);
  try {
    await next();
  } finally {
    const status = c.res.status;
    structuredLog(
      status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
      'http-request-finished',
      {
        request_id: requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status_code: status,
        duration_ms: Math.round(performance.now() - startedAt),
      },
    );
  }
}
