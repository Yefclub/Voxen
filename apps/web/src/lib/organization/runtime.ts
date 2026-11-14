import { db } from '../db';
import { structuredDiagnostic } from '../structured-log';
import { executeOrganization } from './runner';
import { scheduleCapturedOrganization, type OrganizationScheduleCursor } from './schedule';

let draining = false;
export async function drainOrganization(execute = executeOrganization): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const now = new Date();
    const rows = await db.organizationRun.findMany({
      where: {
        generationSettings: { path: ['executorVersion'], equals: 1 },
        cancelRequestedAt: null,
        user: { status: 'APPROVED' },
        transcript: { status: 'ACTIVE' },
        OR: [
          {
            status: { in: ['PENDING', 'RETRY'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: 'RUNNING', leaseExpiresAt: { lt: now } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });
    for (const row of rows) await execute(row.userId, row.id);
  } finally {
    draining = false;
  }
}

export function startOrganizationRuntime(): void {
  let busy = false,
    cursor: OrganizationScheduleCursor | null = null;
  const tick = () => {
    if (busy) return;
    busy = true;
    void (async () => {
      ({ cursor } = await scheduleCapturedOrganization(cursor));
      await drainOrganization();
    })()
      .catch((error) => {
        structuredDiagnostic(
          'warning',
          'organization-drain-failed',
          'ORGANIZATION_DRAIN_FAILED',
          error,
        );
      })
      .finally(() => {
        busy = false;
      });
  };
  tick();
  setInterval(tick, 15_000).unref();
}
