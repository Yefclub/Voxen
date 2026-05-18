// ============================================================================
// Redis — clientes singleton (publisher e subscriber separados)
// ============================================================================
// ioredis exige conexões dedicadas para SUBSCRIBE/PSUBSCRIBE — uma conexão
// em modo subscribe NÃO pode emitir outros comandos. Por isso 2 singletons:
//   - publisher: comandos comuns (PUBLISH, etc.)
//   - subscriber: factory que cria conexão nova quando precisa
// ============================================================================

import { Redis, type RedisOptions } from 'ioredis';

let pub: Redis | null = null;

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

function commonOpts(): RedisOptions {
  return {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  };
}

export function getRedisPublisher(): Redis {
  if (pub) return pub;
  pub = new Redis(redisUrl(), commonOpts());
  return pub;
}

/**
 * Cria uma conexão Redis nova em modo subscribe. O caller é responsável
 * por chamar `.quit()` quando terminar (ex: ao fechar o stream SSE).
 */
export function createSubscriber(): Redis {
  return new Redis(redisUrl(), commonOpts());
}

export async function closeRedis(): Promise<void> {
  if (pub) {
    await pub.quit().catch(() => undefined);
    pub = null;
  }
}
