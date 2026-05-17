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
 * e suficiente pra deduplicação de abuso. `INCR` + `EXPIRE` apenas no primeiro
 * hit da janela.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redis = getRedisPublisher();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }
  const ttl = count === 1 ? windowSec : await redis.ttl(key);
  return {
    allowed: count <= limit,
    count,
    limit,
    resetIn: ttl > 0 ? ttl : windowSec,
  };
}
