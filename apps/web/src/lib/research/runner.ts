import { db } from '../db';
import { AiError } from '../ai/errors';
import { CaptureError } from '../capture/errors';
import {
  prepareResearch,
  savedResearchExecution,
  ResearchExecutionSchema,
  type ResearchContext,
  type ResearchExecution,
} from './context';
import {
  generateResearch,
  RESEARCH_SEARCH_LIMIT,
  RESEARCH_FETCH_LIMIT,
  type ResearchUsage,
} from './generate';
import {
  claimResearch,
  renewResearchLease,
  RESEARCH_MAX_ATTEMPTS,
  withResearchLease,
} from './lease';
import { ResearchError, ResearchSettingsSchema } from './queue';

export const RESEARCH_DEADLINE_MS = 10 * 60_000;
export type ResearchRunnerDependencies = {
  prepare: (userId: string, saved: ResearchExecution | null) => Promise<ResearchContext>;
};
let executing = false;
let draining = false;

function failure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof AiError || error instanceof CaptureError)
    return { code: error.code, retryable: error.retryable };
  if (error instanceof ResearchError)
    return { code: error.code, retryable: ['TIMEOUT', 'FETCH_FAILED'].includes(error.code) };
  if (error instanceof Error && error.message === 'WEB_SEARCH_FAILED')
    return { code: 'WEB_SEARCH_FAILED', retryable: true };
  if (error instanceof Error && error.message === 'WEB_RESULT_TOO_LARGE')
    return { code: 'WEB_RESULT_TOO_LARGE', retryable: false };
  return { code: 'RESEARCH_FAILED', retryable: false };
}

export async function executeResearch(
  userId: string,
  id: string,
  dependencies: ResearchRunnerDependencies = { prepare: prepareResearch },
): Promise<boolean> {
  if (executing) return false;
  executing = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  try {
    const run = await claimResearch(userId, id);
    if (!run) return false;
    const settings = ResearchSettingsSchema.parse(run.generationSettings);
    const previous = run.generationSettings as Record<string, unknown>;
    let execution = savedResearchExecution(previous);
    const usage: ResearchUsage = {
      costUsd: run.attempt === 1 ? 0 : run.costUsd === null ? null : Number(run.costUsd),
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      searchCalls: run.searchCallCount,
      searchResults: run.searchResultCount,
      fetchCalls: typeof previous.fetchCalls === 'number' ? previous.fetchCalls : 0,
      models: new Set(run.model ? run.model.split(', ') : []),
      warnings: new Set(
        Array.isArray(previous.warnings)
          ? previous.warnings.filter((value): value is string => typeof value === 'string')
          : [],
      ),
    };
    const started = run.startedAt?.getTime() ?? Date.now();
    const deadline = started + RESEARCH_DEADLINE_MS;
    const usageData = () => ({
      costUsd: usage.costUsd,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      searchCallCount: usage.searchCalls,
      searchResultCount: usage.searchResults,
      model: [...usage.models].join(', ') || null,
      generationSettings: {
        ...settings,
        ...(execution ? { execution } : {}),
        fetchCalls: usage.fetchCalls,
        warnings: [...usage.warnings],
      },
    });
    const checkpoint = async () => {
      controller.signal.throwIfAborted();
      if (Date.now() >= deadline) throw new ResearchError('TIMEOUT');
      await withResearchLease(run, async (tx) => {
        await tx.transcriptEnrichment.update({
          where: { id },
          data: { ...usageData(), revision: { increment: 1 } },
        });
      });
    };
    let heartbeatBusy = false;
    try {
      if (Date.now() >= deadline) throw new ResearchError('TIMEOUT');
      timer = setTimeout(
        () => controller.abort(new ResearchError('TIMEOUT')),
        deadline - Date.now(),
      );
      timer.unref();
      heartbeat = setInterval(() => {
        if (heartbeatBusy || controller.signal.aborted) return;
        heartbeatBusy = true;
        void renewResearchLease(run)
          .catch((error: unknown) => controller.abort(error))
          .finally(() => {
            heartbeatBusy = false;
          });
      }, 20_000);
      heartbeat.unref();
      await checkpoint();
      const prepared = await dependencies.prepare(userId, execution);
      execution = ResearchExecutionSchema.parse(prepared.execution);
      await checkpoint();
      const source = await withResearchLease(run, async (_tx, current) => current);
      const result = await generateResearch({
        userId,
        source,
        language: execution.language,
        signal: controller.signal,
        usage,
        checkpoint,
        dependencies: prepared.dependencies,
      });
      await checkpoint();
      await withResearchLease(run, async (tx) => {
        await tx.transcriptEnrichment.update({
          where: { id },
          data: {
            ...usageData(),
            status: result.status,
            reviewState: 'SUGGESTED',
            title: result.title || source.title,
            content: result.content,
            citations: result.citations,
            queries: result.queries,
            rationale: result.rationale,
            noResearchReason: result.noResearchReason,
            generatedAt: new Date(),
            checkedAt: new Date(),
            expiresAt:
              result.status === 'READY' ? new Date(Date.now() + 30 * 24 * 60 * 60_000) : null,
            lastError: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            revision: { increment: 1 },
          },
        });
      });
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      if (reason instanceof ResearchError && reason.code === 'LEASE_LOST') return true;
      const problem = failure(reason);
      const retry =
        problem.retryable &&
        usage.searchCalls < RESEARCH_SEARCH_LIMIT &&
        usage.fetchCalls < RESEARCH_FETCH_LIMIT &&
        run.attempt < RESEARCH_MAX_ATTEMPTS &&
        Date.now() + 15_000 < deadline;
      try {
        await withResearchLease(run, async (tx) => {
          await tx.transcriptEnrichment.update({
            where: { id },
            data: {
              ...usageData(),
              status: retry ? 'RETRY' : 'FAILED',
              lastError: problem.code,
              nextAttemptAt: retry ? new Date(Date.now() + run.attempt * 15_000) : null,
              checkedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              revision: { increment: 1 },
            },
          });
        });
      } catch (writeError) {
        if (!(writeError instanceof ResearchError && writeError.code === 'LEASE_LOST'))
          throw writeError;
      }
    }
    return true;
  } finally {
    if (timer) clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    controller.abort();
    executing = false;
  }
}

export async function drainResearch(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await db.transcriptEnrichment.updateMany({
      where: {
        status: { in: ['PENDING', 'RETRY', 'RUNNING'] },
        generationSettings: { path: ['executorVersion'], equals: 1 },
        OR: [
          { user: { status: { not: 'APPROVED' } } },
          { transcript: { status: { not: 'ACTIVE' } } },
        ],
      },
      data: {
        status: 'CANCELLED',
        cancelRequestedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: 'PARENT_INACTIVE',
        revision: { increment: 1 },
      },
    });
    const rows = await db.transcriptEnrichment.findMany({
      where: {
        generationSettings: { path: ['executorVersion'], equals: 1 },
        cancelRequestedAt: null,
        staleReason: null,
        user: { status: 'APPROVED' },
        transcript: { status: 'ACTIVE' },
        OR: [
          {
            status: { in: ['PENDING', 'RETRY'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
          },
          { status: 'RUNNING', leaseExpiresAt: { lt: new Date() } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: { createdAt: 'asc' },
      take: 3,
    });
    for (const row of rows) await executeResearch(row.userId, row.id);
  } finally {
    draining = false;
  }
}
