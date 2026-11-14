import type { Prisma } from '../../../prisma-generated/client';

/** A reserved call without a durable result may have been billed. */
export async function unconfirmedOrganizationUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  runId: string,
) {
  const pending = await tx.organizationSection.count({
    where: { runId, run: { userId }, callPending: true },
  });
  if (!pending) return {};
  const row = await tx.organizationRun.findFirst({
    where: { id: runId, userId },
    select: { warnings: true },
  });
  const warnings = Array.isArray(row?.warnings)
    ? row.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  return { costUsd: null, warnings: [...new Set([...warnings, 'UNCONFIRMED_USAGE'])] };
}
