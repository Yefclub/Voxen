import { describe, expect, test } from 'bun:test';
import {
  acquireChatTurnLease,
  CHAT_TURN_LEASE_TTL_MS,
  chatTurnLeaseKey,
  releaseChatTurnLease,
  renewChatTurnLease,
  type ChatTurnRedis,
} from '../src/lib/chat/turn-coordinator';

class FakeRedis implements ChatTurnRedis {
  private readonly values = new Map<string, string>();
  private readonly expiries = new Map<string, number>();

  constructor(private now = 1_000) {}

  advance(ms: number): void {
    this.now += ms;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    this.expire(key);
    if (args.includes('NX') && this.values.has(key)) return null;
    this.values.set(key, value);
    const px = args.indexOf('PX');
    if (px >= 0) this.expiries.set(key, this.now + Number(args[px + 1]));
    return 'OK';
  }

  async eval(
    script: string,
    _numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<number> {
    const [keyValue, ownerValue, ttlValue] = args;
    const key = String(keyValue);
    const owner = String(ownerValue);
    this.expire(key);
    if (this.values.get(key) !== owner) return 0;
    if (script.includes('pexpire')) {
      this.expiries.set(key, this.now + Number(ttlValue));
    } else {
      this.values.delete(key);
      this.expiries.delete(key);
    }
    return 1;
  }

  private expire(key: string): void {
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && expiry <= this.now) {
      this.values.delete(key);
      this.expiries.delete(key);
    }
  }
}

describe('chat turn Redis coordinator', () => {
  test('serializes a turn and only lets the owner renew or release', async () => {
    const redis = new FakeRedis();
    expect(chatTurnLeaseKey('turn-1')).toBe('voxen:chat:turn:v1:lease:turn-1');
    expect(await acquireChatTurnLease('turn-1', 'owner-a', redis)).toBe(true);
    expect(await acquireChatTurnLease('turn-1', 'owner-b', redis)).toBe(false);
    expect(await renewChatTurnLease('turn-1', 'owner-b', redis)).toBe(false);
    expect(await renewChatTurnLease('turn-1', 'owner-a', redis)).toBe(true);
    expect(await releaseChatTurnLease('turn-1', 'owner-b', redis)).toBe(false);
    expect(await releaseChatTurnLease('turn-1', 'owner-a', redis)).toBe(true);
  });

  test('allows recovery after an abandoned lease expires', async () => {
    const redis = new FakeRedis();
    await acquireChatTurnLease('turn-1', 'owner-a', redis);
    redis.advance(CHAT_TURN_LEASE_TTL_MS + 1);
    expect(await acquireChatTurnLease('turn-1', 'owner-b', redis)).toBe(true);
  });
});
