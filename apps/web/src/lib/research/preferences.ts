import { z } from 'zod';
import { db } from '../db';
import { decrypt } from '../crypto';
import { getMasterKey } from '../master-key';
import { getUserSetting, setUserSetting } from '../settings';
import type { Prisma } from '../../../prisma-generated/client';

export const ResearchModeSchema = z.enum(['OFF', 'MANUAL', 'AUTO']);
export const ResearchPreferencesSchema = z.object({
  mode: ResearchModeSchema.default('OFF'),
  automaticSince: z.string().datetime().nullable().default(null),
});
export type ResearchPreferences = z.infer<typeof ResearchPreferencesSchema>;
const KEY = 'library_research_preferences' as const;
export const ACTIVE_RESEARCH_STATUSES = ['PENDING', 'RUNNING', 'RETRY'] as const;

function parse(value: string | null): ResearchPreferences {
  try {
    return ResearchPreferencesSchema.parse(value ? JSON.parse(value) : {});
  } catch {
    return ResearchPreferencesSchema.parse({});
  }
}
export async function getResearchPreferences(userId: string) {
  return parse(await getUserSetting(userId, KEY));
}
export async function lockResearchUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voxen:research:${userId}`}))`;
}
export async function readResearchPreferences(tx: Prisma.TransactionClient, userId: string) {
  const row = await tx.setting.findFirst({
    where: { userId, scope: 'USER', key: KEY },
    select: { valueEnc: true },
  });
  return parse(row ? decrypt(row.valueEnc, getMasterKey()) : null);
}
export async function saveResearchPreferences(
  userId: string,
  mode: z.infer<typeof ResearchModeSchema>,
) {
  ResearchModeSchema.parse(mode);
  return db.$transaction(async (tx) => {
    await lockResearchUser(tx, userId);
    const previous = await readResearchPreferences(tx, userId);
    if (previous.mode === mode) return previous;
    const next: ResearchPreferences = {
      mode,
      automaticSince: mode === 'AUTO' ? new Date().toISOString() : null,
    };
    await setUserSetting(userId, KEY, JSON.stringify(next), tx);
    await tx.transcriptEnrichment.updateMany({
      where: { userId, status: { in: [...ACTIVE_RESEARCH_STATUSES] } },
      data: {
        status: 'CANCELLED',
        cancelRequestedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: 'POLICY_CHANGED',
        revision: { increment: 1 },
      },
    });
    return next;
  });
}
