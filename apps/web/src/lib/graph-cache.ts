import { getRedisPublisher } from './redis';

export function graphCacheKey(userId: string): string {
  return `voxen:graph:v4:${userId}`;
}

export function graphCachePattern(userId: string): string {
  return `${graphCacheKey(userId)}:*`;
}

export function graphInvalidationChannel(userId: string): string {
  return `voxen:graph:v4:events:${userId}`;
}

export async function invalidateGraphCache(userId: string): Promise<void> {
  try {
    const redis = getRedisPublisher();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        graphCachePattern(userId),
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
    await redis.publish(
      graphInvalidationChannel(userId),
      JSON.stringify({ type: 'invalidated', at: new Date().toISOString() }),
    );
  } catch {
    // Graph cache is an optimization; mutations must not fail because Redis is unavailable.
  }
}
