import type { Prisma } from '../../prisma-generated/client';
import { db } from '../lib/db';
/** Bound expensive graph reads in PostgreSQL as well as in the HTTP transport. */
export async function withMcpReadDeadline<T>(
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
      // These bounded reads should not spend their deadline compiling a JIT plan.
      await tx.$executeRaw`SET LOCAL jit = off`;
      return read(tx);
    },
    { maxWait: 2000, timeout: 5000 },
  );
}
