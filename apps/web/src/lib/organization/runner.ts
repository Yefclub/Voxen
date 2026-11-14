import { AiError } from '../ai/errors';
import { CaptureError } from '../capture/errors';
import { invalidateGraphCache } from '../graph-cache';
import { structuredDiagnostic } from '../structured-log';
import {
  prepareOrganization,
  savedOrganizationExecution,
  type OrganizationExecution,
} from './context';
import {
  generateOrganization,
  OrganizationAnalysisSchema,
  type OrganizationAnalysis,
  type OrganizationUsage,
} from './generate';
import {
  assertOrganizationLease,
  claimOrganization,
  organizationFence,
  ORGANIZATION_DEADLINE_MS,
  ORGANIZATION_EXECUTION_ATTEMPTS,
  ORGANIZATION_SECTION_ATTEMPTS,
  renewOrganizationLease,
  withOrganizationLease,
} from './lease';
import {
  loadOrganizationSource,
  matchesOrganizationRecord,
  OrganizationSettingsSchema,
} from './queue';
import { OrganizationError, organizationSections, organizationSnapshot } from './source';
import { publishOrganizationSection } from './projection';

export type OrganizationRunnerDependencies = {
  prepare: typeof prepareOrganization;
  now?: () => number;
};
let executing = false;

function failure(error: unknown) {
  if (error instanceof AiError || error instanceof CaptureError)
    return { code: error.code, retryable: error.retryable };
  if (error instanceof OrganizationError)
    return { code: error.code, retryable: error.code === 'GRAPH_BUSY' };
  return { code: 'ORGANIZATION_FAILED', retryable: false };
}

/** Paid analysis is persisted before projection; graph effects and receipts commit together. */
export async function executeOrganization(
  userId: string,
  id: string,
  deps: OrganizationRunnerDependencies = { prepare: prepareOrganization },
): Promise<boolean> {
  if (executing) return false;
  executing = true;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const run = await claimOrganization(userId, id);
    if (!run) return false;
    const now = deps.now ?? Date.now;
    const deadline = run.startedAt!.getTime() + ORGANIZATION_DEADLINE_MS;
    const settings = OrganizationSettingsSchema.parse(run.generationSettings);
    let execution: OrganizationExecution | null = null;
    let activeSection: string | null = null;
    let confirmedCall = false;
    const warnings = new Set(
      Array.isArray(run.warnings)
        ? run.warnings.filter((value): value is string => typeof value === 'string')
        : [],
    );
    const usage: OrganizationUsage = {
      costUsd: run.costUsd === null ? null : Number(run.costUsd),
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      models: new Set(run.model ? run.model.split(', ') : []),
    };
    const usageData = () => ({
      costUsd: usage.costUsd,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      model: [...usage.models].join(', ') || null,
      warnings: [...warnings],
      generationSettings: { ...settings, ...(execution ? { execution } : {}) },
    });
    const assertTime = () => {
      controller.signal.throwIfAborted();
      if (now() >= deadline) throw new OrganizationError('TIMEOUT');
    };
    const checkpoint = async () => {
      assertTime();
      await withOrganizationLease(run, async (tx) => {
        await tx.organizationRun.updateMany({
          where: organizationFence(run),
          data: { ...usageData(), revision: { increment: 1 } },
        });
      });
    };
    try {
      execution = savedOrganizationExecution(run.generationSettings);
      assertTime();
      timer = setTimeout(
        () => controller.abort(new OrganizationError('TIMEOUT')),
        deadline - now(),
      );
      timer.unref();
      let heartbeatBusy = false;
      heartbeat = setInterval(() => {
        if (heartbeatBusy || controller.signal.aborted) return;
        heartbeatBusy = true;
        void renewOrganizationLease(run)
          .catch((error: unknown) => controller.abort(error))
          .finally(() => {
            heartbeatBusy = false;
          });
      }, 20_000);
      heartbeat.unref();
      const loaded = await loadOrganizationSource(userId, run.transcriptId);
      if (
        !matchesOrganizationRecord(run.generationSettings, loaded.record) ||
        JSON.stringify(settings.snapshot) !== JSON.stringify(organizationSnapshot(loaded.source))
      )
        throw new OrganizationError('STALE_SOURCE');
      const sections = organizationSections(loaded.source);
      const receipts = await withOrganizationLease(run, (tx) =>
        tx.organizationSection.findMany({
          where: { runId: id, run: { userId } },
          orderBy: { ordinal: 'asc' },
        }),
      );
      if (
        sections.length !== run.totalSections ||
        receipts.length !== sections.length ||
        receipts.some((receipt, ordinal) => receipt.sectionKey !== sections[ordinal]!.key) ||
        receipts.filter((receipt) => receipt.status === 'COMPLETED').length !==
          run.completedSections
      )
        throw new OrganizationError('INVALID_SETTINGS');
      const completed = new Set(
        receipts
          .filter((receipt) => receipt.status === 'COMPLETED')
          .map((receipt) => receipt.sectionKey),
      );
      const publish = async (analysis: OrganizationAnalysis) => {
        assertTime();
        await publishOrganizationSection({
          source: loaded.source,
          analysis,
          assertCurrent: async (tx) => {
            assertTime();
            await assertOrganizationLease(tx, run);
          },
          commit: async (tx, result) => {
            const saved = await tx.organizationSection.updateMany({
              where: {
                runId: id,
                run: { userId },
                sectionKey: analysis.sectionKey,
                status: { in: ['RUNNING', 'RETRY'] },
                callPending: false,
              },
              data: {
                status: 'COMPLETED',
                nodeCount: result.nodes,
                relationshipCount: result.relationships,
                reason: analysis.reason,
                warnings: result.warnings,
              },
            });
            if (saved.count !== 1) throw new OrganizationError('INVALID_RECEIPT');
            result.warnings.forEach((warning) => warnings.add(warning));
            await tx.organizationRun.updateMany({
              where: organizationFence(run),
              data: {
                ...usageData(),
                completedSections: { increment: 1 },
                revision: { increment: 1 },
              },
            });
          },
        });
        completed.add(analysis.sectionKey);
        // Publication is durable even if the presentation cache is unavailable.
        await invalidateGraphCache(userId).catch((error: unknown) =>
          structuredDiagnostic(
            'warning',
            'organization-cache-invalidation-failed',
            'ORGANIZATION_CACHE_FAILED',
            error,
          ),
        );
      };
      // Cached results need no provider credential and still pass the complete
      // current-source/authority validator before any graph publication.
      for (const receipt of receipts) {
        if (completed.has(receipt.sectionKey) || receipt.analysis === null) continue;
        const analysis = OrganizationAnalysisSchema.safeParse(receipt.analysis);
        if (
          !execution ||
          !analysis.success ||
          analysis.data.sectionKey !== receipt.sectionKey ||
          receipt.attempts < 1 ||
          receipt.callPending
        )
          throw new OrganizationError('INVALID_ANALYSIS');
        await publish(analysis.data);
      }
      if (completed.size < sections.length) {
        await checkpoint();
        const prepared = await deps.prepare(userId, execution);
        execution = prepared.execution;
        await checkpoint();
        await generateOrganization({
          source: loaded.source,
          language: execution.language,
          signal: controller.signal,
          usage,
          checkpoint,
          completed,
          onSectionStart: async (sectionKey) => {
            await withOrganizationLease(run, async (tx) => {
              const reserved = await tx.organizationSection.updateMany({
                where: {
                  runId: id,
                  run: { userId },
                  sectionKey,
                  status: { in: ['PENDING', 'RUNNING', 'RETRY'] },
                  attempts: { lt: ORGANIZATION_SECTION_ATTEMPTS },
                },
                data: { attempts: { increment: 1 }, status: 'RUNNING', callPending: true },
              });
              if (reserved.count !== 1) throw new OrganizationError('SECTION_ATTEMPTS_EXHAUSTED');
            });
            activeSection = sectionKey;
            confirmedCall = false;
          },
          generate: async (input) => {
            try {
              const result = await prepared.generate(input);
              confirmedCall = true;
              return result;
            } catch (error) {
              confirmedCall = error instanceof AiError;
              throw error;
            }
          },
          onSection: async (result) => {
            const analysis = OrganizationAnalysisSchema.safeParse(result);
            if (!analysis.success) throw new OrganizationError('INVALID_ANALYSIS');
            await withOrganizationLease(run, async (tx) => {
              assertTime();
              const saved = await tx.organizationSection.updateMany({
                where: {
                  runId: id,
                  run: { userId },
                  sectionKey: result.sectionKey,
                  status: 'RUNNING',
                  callPending: true,
                },
                data: { analysis: analysis.data, callPending: false },
              });
              if (saved.count !== 1) throw new OrganizationError('INVALID_RECEIPT');
              await tx.organizationRun.updateMany({
                where: organizationFence(run),
                data: { ...usageData(), revision: { increment: 1 } },
              });
            });
            await publish(analysis.data);
            activeSection = null;
          },
        });
      }
      await checkpoint();
      await withOrganizationLease(run, async (tx) => {
        assertTime();
        const count = await tx.organizationSection.count({
          where: { runId: id, run: { userId }, status: 'COMPLETED' },
        });
        if (count !== sections.length) throw new OrganizationError('INCOMPLETE_ANALYSIS');
        await tx.organizationRun.updateMany({
          where: organizationFence(run),
          data: {
            ...usageData(),
            status: sections.length ? 'COMPLETED' : 'SKIPPED',
            lastError: sections.length ? null : 'NO_ELIGIBLE_SOURCE',
            finishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            revision: { increment: 1 },
          },
        });
      });
    } catch (error) {
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      if (reason instanceof OrganizationError && reason.code === 'LEASE_LOST') return true;
      const problem = failure(reason);
      structuredDiagnostic(
        'warning',
        'organization-execution-failed',
        'ORGANIZATION_EXECUTION_FAILED',
        reason,
        { run_id: id, cause_code: problem.code },
      );
      const retry =
        problem.retryable &&
        run.attempt < ORGANIZATION_EXECUTION_ATTEMPTS &&
        now() + 15_000 < deadline;
      if (activeSection && !confirmedCall) {
        usage.costUsd = null;
        warnings.add('UNCONFIRMED_USAGE');
      }
      try {
        await withOrganizationLease(run, async (tx) => {
          if (activeSection)
            await tx.organizationSection.updateMany({
              where: { runId: id, run: { userId }, sectionKey: activeSection, status: 'RUNNING' },
              data: {
                status: retry ? 'RETRY' : 'FAILED',
                ...(confirmedCall ? { callPending: false } : {}),
              },
            });
          await tx.organizationRun.updateMany({
            where: organizationFence(run),
            data: {
              ...usageData(),
              status: retry ? 'RETRY' : 'FAILED',
              lastError: problem.code,
              nextAttemptAt: retry ? new Date(Date.now() + run.attempt * 15_000) : null,
              finishedAt: retry ? null : new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              revision: { increment: 1 },
            },
          });
        });
      } catch (writeError) {
        if (!(writeError instanceof OrganizationError && writeError.code === 'LEASE_LOST'))
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
