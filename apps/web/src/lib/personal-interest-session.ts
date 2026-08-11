import { z } from 'zod';
import { getRedisPublisher } from './redis';
import type { InterestProjectionDimension } from './personal-interest-projections';

export const SESSION_INTENT_TTL_SEC = 2 * 60 * 60;
export const SESSION_INTENT_MAX_ITEMS = 12;

export interface SessionIntentItem {
  dimension: InterestProjectionDimension;
  key: string;
  label: string;
  weight: number;
  brainNodeId: string | null;
}

export interface SessionIntentState {
  sessionId: string;
  items: SessionIntentItem[];
  savedAt: string;
  expiresAt: string;
}

export interface SessionIntentStore {
  set(key: string, value: string, expiryMode: 'EX', ttlSec: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

const SessionIntentStateSchema = z.object({
  sessionId: z.string(),
  items: z
    .array(
      z.object({
        dimension: z.enum(['TOPIC', 'ENTITY', 'TAG', 'FOLDER', 'AUTHOR', 'CHANNEL', 'SOURCE']),
        key: z.string(),
        label: z.string(),
        weight: z.number().min(-1).max(1),
        brainNodeId: z.string().nullable(),
      }),
    )
    .max(SESSION_INTENT_MAX_ITEMS),
  savedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export function sessionIntentKey(userId: string, sessionId: string): string {
  return `voxen:interest-intent:v1:${encodeURIComponent(userId)}:${sessionId}`;
}

export async function recordSessionIntent(input: {
  userId: string;
  sessionId: string;
  items: SessionIntentItem[];
  now?: Date;
  store?: SessionIntentStore;
}): Promise<SessionIntentState> {
  const now = input.now ?? new Date();
  const state: SessionIntentState = {
    sessionId: input.sessionId,
    items: input.items.slice(0, SESSION_INTENT_MAX_ITEMS),
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_INTENT_TTL_SEC * 1_000).toISOString(),
  };
  const store = input.store ?? getRedisPublisher();
  await store.set(
    sessionIntentKey(input.userId, input.sessionId),
    JSON.stringify(state),
    'EX',
    SESSION_INTENT_TTL_SEC,
  );
  return state;
}

export async function readSessionIntent(input: {
  userId: string;
  sessionId: string;
  store?: SessionIntentStore;
}): Promise<SessionIntentState | null> {
  const store = input.store ?? getRedisPublisher();
  const value = await store.get(sessionIntentKey(input.userId, input.sessionId));
  if (!value) return null;
  try {
    const parsed = SessionIntentStateSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearSessionIntent(input: {
  userId: string;
  sessionId: string;
  store?: SessionIntentStore;
}): Promise<void> {
  const store = input.store ?? getRedisPublisher();
  await store.del(sessionIntentKey(input.userId, input.sessionId));
}
