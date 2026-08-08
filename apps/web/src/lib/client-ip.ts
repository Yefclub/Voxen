// Resolve o IP real do cliente, considerando que o Voxen pode rodar atrás do
// proxy do Cloudflare. Ordem de preferência:
//   1. CF-Connecting-IP  — IP canônico do cliente quando atrás do Cloudflare
//   2. X-Forwarded-For    — primeiro IP da lista (comportamento sem CF)
//   3. X-Real-IP          — fallback de outros reverse proxies (ex.: nginx)
//   4. 'unknown'          — nenhum header disponível
//
// Usado para chavear rate-limit por IP. Sem o CF-Connecting-IP, o XFF atrás do
// Cloudflare pode trazer IPs intermediários e bagunçar o scoping.

import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

export function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip')?.trim();
  if (cf) return cf;

  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;

  const real = c.req.header('x-real-ip')?.trim();
  if (real) return real;

  return 'unknown';
}

/**
 * Returns the TCP peer observed by Bun without trusting caller-controlled
 * forwarding headers. Use this for unauthenticated endpoints that create
 * durable state. Tests and non-Bun adapters intentionally collapse to one
 * bounded `unknown` bucket.
 */
export function connectionPeerIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
