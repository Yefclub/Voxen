import { getRedisPublisher } from '../redis';

export interface ChatTurnRedis {
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export const CHAT_TURN_LEASE_TTL_MS = 45_000;
export const CHAT_TURN_HEARTBEAT_MS = 15_000;

const RENEW_LEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

function redisClient(): ChatTurnRedis {
  return getRedisPublisher() as unknown as ChatTurnRedis;
}

export function chatTurnLeaseKey(turnId: string): string {
  return `voxen:chat:turn:v1:lease:${turnId}`;
}

export async function acquireChatTurnLease(
  turnId: string,
  ownerId: string,
  redis: ChatTurnRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.set(
    chatTurnLeaseKey(turnId),
    ownerId,
    'PX',
    CHAT_TURN_LEASE_TTL_MS,
    'NX',
  );
  return result === 'OK';
}

export async function renewChatTurnLease(
  turnId: string,
  ownerId: string,
  redis: ChatTurnRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.eval(
    RENEW_LEASE_SCRIPT,
    1,
    chatTurnLeaseKey(turnId),
    ownerId,
    CHAT_TURN_LEASE_TTL_MS,
  );
  return Number(result) === 1;
}

export async function releaseChatTurnLease(
  turnId: string,
  ownerId: string,
  redis: ChatTurnRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.eval(RELEASE_LEASE_SCRIPT, 1, chatTurnLeaseKey(turnId), ownerId);
  return Number(result) === 1;
}
