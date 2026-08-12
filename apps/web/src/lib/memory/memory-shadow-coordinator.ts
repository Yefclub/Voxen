const inFlightWrites = new Map<string, Set<Promise<void>>>();
const deletionFences = new Map<string, number>();

function releaseDeletionFence(userId: string): void {
  const remaining = (deletionFences.get(userId) ?? 1) - 1;
  if (remaining > 0) deletionFences.set(userId, remaining);
  else deletionFences.delete(userId);
}

/**
 * Registers the whole asynchronous write path before it can start. Account
 * deletion can therefore fence the user and wait for every earlier write.
 */
export function scheduleUserMemoryShadowWrite(
  userId: string,
  operation: () => Promise<void>,
): boolean {
  if ((deletionFences.get(userId) ?? 0) > 0) return false;
  const userWrites = inFlightWrites.get(userId) ?? new Set<Promise<void>>();
  inFlightWrites.set(userId, userWrites);
  const tracked = Promise.resolve()
    .then(operation)
    .catch(() => {
      console.warn('[memory-shadow] scheduled write failed');
    })
    .finally(() => {
      userWrites.delete(tracked);
      if (userWrites.size === 0) inFlightWrites.delete(userId);
    });
  userWrites.add(tracked);
  return true;
}

/**
 * Prevents new writes, drains earlier writes, then deletes the remote subject.
 * The returned release function must stay held until canonical deletion ends.
 */
export async function acquireUserMemoryShadowDeletionFence(
  userId: string,
  deleteRemote: () => Promise<void>,
): Promise<() => void> {
  deletionFences.set(userId, (deletionFences.get(userId) ?? 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseDeletionFence(userId);
  };
  try {
    await Promise.all([...(inFlightWrites.get(userId) ?? [])]);
    await deleteRemote();
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
