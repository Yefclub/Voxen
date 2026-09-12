import {
  GRAPH_INDEX_HEARTBEAT_MS,
  GRAPH_INDEX_LEASE_TTL_MS,
  acquireGraphIndexLease,
  releaseGraphIndexLease,
  renewGraphIndexLease,
} from './graph-index-coordinator';

export type BrainReindexGuard = () => Promise<void>;

class BrainIndexLeaseLostError extends Error {
  constructor() {
    super('Brain index lease lost');
  }
}

export async function runWithBrainIndexLease(
  userId: string,
  operation: (assertLeaseOwnership: BrainReindexGuard) => Promise<void>,
): Promise<boolean> {
  const owner = `web-direct:${crypto.randomUUID()}`;
  try {
    if (!(await acquireGraphIndexLease(userId, owner))) return false;
  } catch {
    return false;
  }

  let leaseLost = false;
  let leaseExpiresAt = Date.now() + GRAPH_INDEX_LEASE_TTL_MS;
  const renewLease = async (): Promise<void> => {
    if (leaseLost) throw new BrainIndexLeaseLostError();
    try {
      if (!(await renewGraphIndexLease(userId, owner))) {
        leaseLost = true;
        throw new BrainIndexLeaseLostError();
      }
      leaseExpiresAt = Date.now() + GRAPH_INDEX_LEASE_TTL_MS;
    } catch (error) {
      if (error instanceof BrainIndexLeaseLostError) throw error;
      if (Date.now() >= leaseExpiresAt) {
        leaseLost = true;
        throw new BrainIndexLeaseLostError();
      }
    }
  };
  const assertLeaseOwnership = async (): Promise<void> => {
    if (leaseLost || Date.now() >= leaseExpiresAt) {
      leaseLost = true;
      throw new BrainIndexLeaseLostError();
    }
    if (Date.now() >= leaseExpiresAt - GRAPH_INDEX_HEARTBEAT_MS) await renewLease();
  };
  const heartbeat = setInterval(() => {
    void renewLease().catch(() => {
      // A guard between phases interrupts materialization and leaves the marker absent.
    });
  }, GRAPH_INDEX_HEARTBEAT_MS);
  try {
    await assertLeaseOwnership();
    await operation(assertLeaseOwnership);
    return true;
  } catch (error) {
    if (error instanceof BrainIndexLeaseLostError) return false;
    throw error;
  } finally {
    clearInterval(heartbeat);
    await releaseGraphIndexLease(userId, owner).catch(() => false);
  }
}
