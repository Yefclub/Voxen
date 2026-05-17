// Rate limit por chave Redis com janela fixa (TTL).
// Uso pragmático em self-hosted single-tenant: protege contra abuso acidental
// (loop de UI bugado, script malicioso) e contra exfil de custos da OR.

import { getRedisPublisher } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  /** Quantos hits no período atual (incluindo o atual se allowed). */
  count: number;
  /** Limite configurado. */
  limit: number;
  /** Segundos até o reset da janela. */
  resetIn: number;
}

/**
 * Conta o hit e retorna se pode prosseguir. Janela fixa (não sliding) — barata
 * e suficiente pra deduplicação de abuso.
 *
 * Atomicidade: `INCR` + `EXPIRE` rodam num único `MULTI` pra evitar TTL drift
 * — se EXPIRE falhar isoladamente (network blip, processo crash entre os 2
 * comandos), a chave fica sem TTL e o user vira refém permanente. Com MULTI,
 * ou os 2 commits passam ou nenhum.
 *
 * `EXPIRE NX` (Redis 7+) só seta TTL se não existir — idempotente quando count > 1.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redis = getRedisPublisher();
  const results = await redis.multi().incr(key).expire(key, windowSec, 'NX').ttl(key).exec();
  if (!results) {
    // MULTI/EXEC abortado (raro — connection drop). Falha aberta: permite,
    // mas não conta — alternativa seria 503, mas single-tenant não compensa.
    return { allowed: true, count: 0, limit, resetIn: windowSec };
  }
  const count = (results[0]?.[1] as number) ?? 0;
  const ttl = (results[2]?.[1] as number) ?? windowSec;
  return {
    allowed: count <= limit,
    count,
    limit,
    resetIn: ttl > 0 ? ttl : windowSec,
  };
}
