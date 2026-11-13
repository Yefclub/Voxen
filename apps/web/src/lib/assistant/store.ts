import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, AssistantRun } from '../../../prisma-generated/client';
import { db } from '../db';

type Tx = Prisma.TransactionClient;
export type ClaimedAssistantRun = AssistantRun & { workerId: string };
export const ASSISTANT_LEASE_MS = 45_000;
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export class AssistantError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Serializes all conversation mutations, including fencing tool effects. */
export async function withConversation<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assistant:${userId}`}, 0))`;
      await tx.assistantConversation.upsert({ where: { userId }, create: { userId }, update: {} });
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}

export async function getConversation(userId: string, before?: number) {
  return withConversation(userId, async (tx) => {
    const conversation = await tx.assistantConversation.findUnique({ where: { userId } });
    const rows = await tx.assistantMessage.findMany({
      where: { userId, ...(before ? { position: { lt: before } } : {}) },
      orderBy: { position: 'desc' },
      take: 41,
      select: { id: true, position: true, role: true, text: true, details: true, createdAt: true },
    });
    const activeRun = conversation?.activeRunId
      ? await tx.assistantRun.findFirst({
          where: { id: conversation.activeRunId, userId, status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true, status: true, model: true, revision: true },
        })
      : null;
    const event = await tx.assistantEvent.findFirst({
      where: { userId, revision: conversation?.revision ?? 0 },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    const proposals = await tx.assistantProposal.findMany({
      where: { userId, run: { userId, outputMessageId: { in: rows.map((row) => row.id) } } },
      take: 120,
      select: {
        id: true,
        name: true,
        input: true,
        status: true,
        revision: true,
        run: { select: { outputMessageId: true } },
      },
    });
    return {
      revision: conversation?.revision ?? 0,
      activeRun,
      eventCursor: event?.id ?? 0,
      hasMore: rows.length > 40,
      messages: rows
        .slice(0, 40)
        .reverse()
        .map((row) => ({
          ...row,
          details: {
            ...(row.details as Prisma.JsonObject),
            proposals: proposals
              .filter((proposal) => proposal.run.outputMessageId === row.id)
              .map(({ id, name, input, status, revision }) => ({
                id,
                name,
                input,
                status,
                revision,
              })),
          } as Prisma.JsonObject,
        })),
    };
  });
}

type SendInput = {
  text: string;
  requestKey: string;
  revision: number;
  approvedProposalId?: string;
};
export async function createTurn(tx: Tx, userId: string, input: SendInput, inputPosition?: number) {
  const conversation = await tx.assistantConversation.findUniqueOrThrow({ where: { userId } });
  if (conversation.revision !== input.revision) throw new AssistantError('REVISION_CONFLICT');
  if (conversation.activeRunId) throw new AssistantError('RUN_ACTIVE');
  const position = inputPosition ?? conversation.nextPosition;
  if (inputPosition === undefined)
    await tx.assistantMessage.create({
      data: {
        userId,
        position,
        role: 'user',
        text: input.text,
      },
    });
  const output = await tx.assistantMessage.create({
    data: { userId, position: position + 1, role: 'assistant' },
  });
  const run = await tx.assistantRun.create({
    data: {
      userId,
      requestKey: input.requestKey,
      revision: input.revision,
      inputPosition: position,
      outputMessageId: output.id,
      approvedProposalId: input.approvedProposalId,
      costUsd: 0,
    },
  });
  await tx.assistantConversation.update({
    where: { userId },
    data: {
      activeRunId: run.id,
      nextPosition: position + 2,
    },
  });
  await tx.assistantEvent.create({
    data: {
      userId,
      runId: run.id,
      revision: run.revision,
      kind: 'queued',
      data: { messageId: output.id },
    },
  });
  return run;
}

export async function sendAssistantMessage(userId: string, input: SendInput) {
  return withConversation(userId, async (tx) => {
    const previous = await tx.assistantRun.findUnique({
      where: { userId_requestKey: { userId, requestKey: input.requestKey } },
    });
    if (previous) {
      const original = await tx.assistantMessage.findUnique({
        where: { userId_position: { userId, position: previous.inputPosition } },
      });
      if (original?.text !== input.text) throw new AssistantError('REQUEST_CONFLICT');
      return previous;
    }
    return createTurn(tx, userId, input);
  });
}

export async function stopAssistantRun(userId: string, runId: string) {
  return withConversation(userId, async (tx) => {
    const run = await tx.assistantRun.findFirst({ where: { id: runId, userId } });
    if (!run) throw new AssistantError('NOT_FOUND');
    if (!['QUEUED', 'RUNNING'].includes(run.status)) return;
    const actions = await tx.assistantAction.findMany({
      where: {
        userId,
        OR: [
          { key: { startsWith: `assistant:${run.id}:` } },
          ...(run.approvedProposalId
            ? [{ key: `assistant-proposal:${run.approvedProposalId}` }]
            : []),
        ],
      },
      select: { name: true, result: true },
    });
    const message = await tx.assistantMessage.findFirst({
      where: { id: run.outputMessageId, userId },
      select: { details: true },
    });
    await tx.assistantMessage.updateMany({
      where: { id: run.outputMessageId, userId },
      data: {
        details: json({
          ...((message?.details as Record<string, unknown>) ?? {}),
          actions,
          stopped: true,
        }),
      },
    });
    await tx.assistantRun.update({
      where: { id: run.id },
      data: { status: 'CANCELLED', workerId: null, leaseExpiresAt: null, finishedAt: new Date() },
    });
    await tx.assistantConversation.updateMany({
      where: { userId, activeRunId: run.id },
      data: { activeRunId: null },
    });
    await tx.assistantEvent.create({
      data: { userId, runId, revision: run.revision, kind: 'cancelled', data: {} },
    });
  });
}

export async function rewindConversation(
  userId: string,
  input: {
    messageId: string;
    revision: number;
    text?: string;
    requestKey?: string;
  },
) {
  return withConversation(userId, async (tx) => {
    const target = await tx.assistantMessage.findFirst({ where: { id: input.messageId, userId } });
    if (!target) throw new AssistantError('NOT_FOUND');
    const conversation = await tx.assistantConversation.findUniqueOrThrow({ where: { userId } });
    if (conversation.revision !== input.revision) throw new AssistantError('REVISION_CONFLICT');
    if (input.text !== undefined && target.role !== 'user')
      throw new AssistantError('INVALID_MESSAGE');
    const revision = conversation.revision + 1;
    await tx.assistantConversation.update({
      where: { userId },
      data: { revision, activeRunId: null, nextPosition: target.position + 1 },
    });
    await tx.assistantRun.deleteMany({
      where: {
        userId,
        OR: [
          { inputPosition: { gte: target.position } },
          { status: { in: ['QUEUED', 'RUNNING'] } },
        ],
      },
    });
    await tx.assistantEvent.deleteMany({ where: { userId } });
    await tx.assistantMessage.deleteMany({ where: { userId, position: { gt: target.position } } });
    await tx.assistantMemory.deleteMany({
      where: { userId, throughPosition: { gte: target.position } },
    });
    let run: AssistantRun | undefined;
    if (input.text !== undefined) {
      await tx.assistantMessage.update({
        where: { id: target.id },
        data: { text: input.text, details: {} },
      });
      run = await createTurn(
        tx,
        userId,
        { text: input.text, requestKey: input.requestKey ?? randomUUID(), revision },
        target.position,
      );
    }
    return { revision, runId: run?.id ?? null };
  });
}

export async function claimAssistantRun(id: string): Promise<ClaimedAssistantRun | null> {
  const candidate = await db.assistantRun.findUnique({ where: { id } });
  if (!candidate) return null;
  return withConversation(candidate.userId, async (tx) => {
    const conversation = await tx.assistantConversation.findUniqueOrThrow({
      where: { userId: candidate.userId },
    });
    if (conversation.activeRunId !== id || conversation.revision !== candidate.revision)
      return null;
    const user = await tx.user.findUnique({
      where: { id: candidate.userId },
      select: { status: true },
    });
    if (user?.status !== 'APPROVED') {
      await tx.assistantRun.updateMany({
        where: { id, userId: candidate.userId, status: 'QUEUED' },
        data: { status: 'FAILED', errorCode: 'FORBIDDEN', finishedAt: new Date() },
      });
      await tx.assistantMessage.updateMany({
        where: { id: candidate.outputMessageId, userId: candidate.userId },
        data: { details: { error: 'FORBIDDEN' } },
      });
      await tx.assistantConversation.update({
        where: { userId: candidate.userId },
        data: { activeRunId: null },
      });
      return null;
    }
    const workerId = randomUUID();
    const count = await tx.assistantRun.updateMany({
      where: { id, status: 'QUEUED', userId: candidate.userId },
      data: {
        status: 'RUNNING',
        workerId,
        leaseExpiresAt: new Date(Date.now() + ASSISTANT_LEASE_MS),
      },
    });
    if (!count.count) return null;
    return { ...candidate, status: 'RUNNING', workerId };
  });
}

export async function assertAssistantLease(tx: Tx, run: ClaimedAssistantRun) {
  const current = await tx.assistantRun.findFirst({
    where: {
      id: run.id,
      userId: run.userId,
      revision: run.revision,
      workerId: run.workerId,
      status: 'RUNNING',
      leaseExpiresAt: { gt: new Date() },
    },
  });
  const conversation = await tx.assistantConversation.findUnique({ where: { userId: run.userId } });
  const user = await tx.user.findUnique({ where: { id: run.userId }, select: { status: true } });
  if (
    !current ||
    conversation?.revision !== run.revision ||
    conversation.activeRunId !== run.id ||
    user?.status !== 'APPROVED'
  )
    throw new AssistantError('LEASE_LOST');
}

export async function withAssistantLease<T>(run: ClaimedAssistantRun, fn: (tx: Tx) => Promise<T>) {
  return withConversation(run.userId, async (tx) => {
    await assertAssistantLease(tx, run);
    return fn(tx);
  });
}

export async function appendAssistantOutput(run: ClaimedAssistantRun, text: string) {
  return withAssistantLease(run, async (tx) => {
    await tx.assistantMessage.updateMany({
      where: { id: run.outputMessageId, userId: run.userId },
      data: { text },
    });
    await tx.assistantEvent.create({
      data: {
        userId: run.userId,
        runId: run.id,
        revision: run.revision,
        kind: 'text',
        data: { messageId: run.outputMessageId, text },
      },
    });
  });
}

export function sourceDigest(messages: readonly { id: string; text: string }[]) {
  return createHash('sha256')
    .update(JSON.stringify(messages.map(({ id, text }) => [id, text])))
    .digest('hex');
}
