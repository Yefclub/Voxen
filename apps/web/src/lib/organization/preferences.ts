import { z } from 'zod';
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { decrypt } from '../crypto';
import { getMasterKey } from '../master-key';
import { getUserSetting, setUserSetting } from '../settings';

export const OrganizationModeSchema = z.enum(['OFF', 'MANUAL', 'AUTO']);
export const OrganizationPreferencesSchema = z.object({
  mode: OrganizationModeSchema.default('OFF'),
  automaticSince: z.string().datetime().nullable().default(null),
});
export type OrganizationPreferences = z.infer<typeof OrganizationPreferencesSchema>;
export const ACTIVE_ORGANIZATION_STATUSES = ['PENDING', 'RUNNING', 'RETRY'] as const;
const KEY = 'library_organization_preferences' as const;

function parse(value: string | null): OrganizationPreferences {
  try {
    return OrganizationPreferencesSchema.parse(value ? JSON.parse(value) : {});
  } catch {
    return OrganizationPreferencesSchema.parse({});
  }
}
export async function getOrganizationPreferences(userId: string) {
  return parse(await getUserSetting(userId, KEY));
}
export function lockOrganizationUser(tx: Prisma.TransactionClient, userId: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voxen:organization:${userId}`}))`;
}
export async function readOrganizationPreferences(tx: Prisma.TransactionClient, userId: string) {
  const setting = await tx.setting.findFirst({
    where: { userId, scope: 'USER', key: KEY },
    select: { valueEnc: true },
  });
  return parse(setting ? decrypt(setting.valueEnc, getMasterKey()) : null);
}
export async function saveOrganizationPreferences(
  userId: string,
  mode: z.infer<typeof OrganizationModeSchema>,
) {
  OrganizationModeSchema.parse(mode);
  return db.$transaction(async (tx) => {
    await lockOrganizationUser(tx, userId);
    const previous = await readOrganizationPreferences(tx, userId);
    if (previous.mode === mode) return previous;
    const next: OrganizationPreferences = {
      mode,
      automaticSince: mode === 'AUTO' ? new Date().toISOString() : null,
    };
    await setUserSetting(userId, KEY, JSON.stringify(next), tx);
    await tx.organizationRun.updateMany({
      where: { userId, status: { in: [...ACTIVE_ORGANIZATION_STATUSES] } },
      data: {
        status: 'CANCELLED',
        cancelRequestedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
        lastError: 'POLICY_CHANGED',
        revision: { increment: 1 },
      },
    });
    return next;
  });
}
