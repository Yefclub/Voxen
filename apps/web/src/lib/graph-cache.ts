import { getRedisPublisher } from './redis';

export function graphCacheKey(userId: string): string {
  return `voxen:graph:v4:${userId}`;
}

export async function invalidateGraphCache(userId: string): Promise<void> {
  try {
    await getRedisPublisher().del(graphCacheKey(userId));
  } catch {
    // Graph cache is an optimization; mutations must not fail because Redis is unavailable.
  }
}
