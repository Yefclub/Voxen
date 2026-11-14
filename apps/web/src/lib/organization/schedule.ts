import { db } from '../db';
import { structuredDiagnostic } from '../structured-log';
import { enqueueOrganization } from './queue';
import { OrganizationError } from './source';
export type OrganizationScheduleCursor = { collectedAt: Date; id: string };
export async function scheduleOrganizationAfterCapture(
  userId: string,
  transcriptId: string,
  enqueue = enqueueOrganization,
): Promise<void> {
  try {
    await enqueue(userId, transcriptId, 'AUTO');
  } catch (error) {
    // Capture publication already committed; the bounded sweep can recover a
    // missed enqueue. Inactive or deleted sources are intentionally skipped.
    if (error instanceof OrganizationError && error.code === 'NOT_FOUND') return;
    structuredDiagnostic(
      'warning',
      'organization-schedule-failed',
      'ORGANIZATION_SCHEDULE_FAILED',
      error,
    );
  }
}
export async function scheduleCapturedOrganization(
  cursor: OrganizationScheduleCursor | null = null,
  limit = 20,
): Promise<{ cursor: OrganizationScheduleCursor | null }> {
  const rows = await db.transcript.findMany({
    where: {
      status: 'ACTIVE',
      user: { status: 'APPROVED' },
      sourceMetadata: { path: ['producer'], equals: 'voxen-capture' },
      sourceCollectedAt: { not: null },
      ...(cursor
        ? {
            OR: [
              { sourceCollectedAt: { lt: cursor.collectedAt } },
              { sourceCollectedAt: cursor.collectedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    select: { id: true, userId: true, sourceCollectedAt: true },
    orderBy: [{ sourceCollectedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  for (const row of rows) await scheduleOrganizationAfterCapture(row.userId, row.id);
  const last = rows.at(-1);
  return {
    cursor:
      rows.length === limit && last?.sourceCollectedAt
        ? { collectedAt: last.sourceCollectedAt, id: last.id }
        : null,
  };
}
