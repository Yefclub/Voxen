// ============================================================================
// /api/admin/ai-health — saúde operacional da configuração global de IA
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import type { CostEvent, CostEventKind, JobType } from '../../prisma-generated/client';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { isModelCompatibleWithPurpose, type ModelPurpose } from '../lib/model-defaults';
import {
  listUserModels,
  OpenrouterError,
  probeOpenRouterCapability,
  type OpenRouterProbePurpose,
  type OrModel,
} from '../lib/openrouter';
import { getSettings } from '../lib/settings';

type Vars = { adminUserId: string };

export const adminAiHealthRoutes = new Hono<{ Variables: Vars }>();

adminAiHealthRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED') return c.json({ error: 'Acesso negado.' }, 403);
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

type AiCapabilityDefinition = {
  id: OpenRouterProbePurpose;
  setting:
    | 'default_chat_model'
    | 'default_transcription_model'
    | 'default_web_search_model'
    | 'default_vision_model'
    | 'default_document_model'
    | 'default_x_analysis_model'
    | 'embedding_model';
  purpose: ModelPurpose | null;
  costKinds: readonly CostEventKind[];
  eventSource?: 'image_upload' | 'document_upload';
  jobTypes: readonly JobType[];
};

const CAPABILITIES: readonly AiCapabilityDefinition[] = [
  {
    id: 'chat',
    setting: 'default_chat_model',
    purpose: 'default_chat_model',
    costKinds: ['CHAT'],
    jobTypes: [],
  },
  {
    id: 'transcription',
    setting: 'default_transcription_model',
    purpose: 'default_transcription_model',
    costKinds: ['TRANSCRIBE'],
    jobTypes: ['DOWNLOAD_AND_TRANSCRIBE', 'UPLOAD_AND_TRANSCRIBE'],
  },
  {
    id: 'webSearch',
    setting: 'default_web_search_model',
    purpose: 'default_web_search_model',
    costKinds: ['WEB_SEARCH'],
    jobTypes: [],
  },
  {
    id: 'vision',
    setting: 'default_vision_model',
    purpose: 'default_vision_model',
    costKinds: ['CHAT'],
    eventSource: 'image_upload',
    jobTypes: ['UPLOAD_AND_ANALYZE_IMAGE'],
  },
  {
    id: 'document',
    setting: 'default_document_model',
    purpose: 'default_document_model',
    costKinds: ['DOCUMENT'],
    eventSource: 'document_upload',
    jobTypes: ['UPLOAD_AND_ANALYZE_DOCUMENT'],
  },
  {
    id: 'xAnalysis',
    setting: 'default_x_analysis_model',
    purpose: 'default_x_analysis_model',
    costKinds: ['X_SEARCH'],
    jobTypes: ['ANALYZE_X'],
  },
  {
    id: 'embeddings',
    setting: 'embedding_model',
    purpose: null,
    costKinds: ['EMBED'],
    jobTypes: [],
  },
];

type Availability = 'ACTIVE' | 'INACTIVE' | 'MISSING' | 'UNAVAILABLE';

const HealthInputKeys = [
  'openrouter_api_key',
  'default_chat_model',
  'default_transcription_model',
  'default_web_search_model',
  'default_vision_model',
  'default_document_model',
  'default_x_analysis_model',
  'embeddings_enabled',
  'embedding_model',
] as const;

function capabilityById(id: string) {
  return CAPABILITIES.find((capability) => capability.id === id);
}

function costEventSource(meta: CostEvent['meta']): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const source = (meta as { source?: unknown }).source;
  return typeof source === 'string' ? source : null;
}

function costEventLatency(meta: CostEvent['meta']): number | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const latencyMs = (meta as { latencyMs?: unknown }).latencyMs;
  return typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0
    ? latencyMs
    : null;
}

function eventMatchesCapability(
  event: Pick<CostEvent, 'model' | 'kind' | 'meta'>,
  capability: (typeof CAPABILITIES)[number],
  modelId: string | null,
): boolean {
  if (!modelId || event.model !== modelId || !capability.costKinds.includes(event.kind)) {
    return false;
  }
  const source = costEventSource(event.meta);
  if (capability.eventSource) return source === capability.eventSource;
  // A análise de imagens é registrada como CHAT; não deve inflar o uso do chat.
  return !(capability.id === 'chat' && source === 'image_upload');
}

function availabilityFor(
  capability: (typeof CAPABILITIES)[number],
  modelId: string | null,
  embeddingsEnabled: boolean,
  catalog: readonly OrModel[] | null,
): { availability: Availability; reason: string | null; model: OrModel | null } {
  if (capability.id === 'embeddings' && !embeddingsEnabled) {
    return { availability: 'INACTIVE', reason: 'Embeddings estão desabilitados.', model: null };
  }
  if (!modelId) {
    return { availability: 'MISSING', reason: 'Nenhum modelo foi configurado.', model: null };
  }
  if (catalog === null) {
    return {
      availability: 'UNAVAILABLE',
      reason: 'Não foi possível consultar o catálogo autorizado agora.',
      model: null,
    };
  }
  const model = catalog.find((candidate) => candidate.id === modelId) ?? null;
  if (!model) {
    return {
      availability: 'UNAVAILABLE',
      reason: 'O modelo não está disponível para a chave atual.',
      model: null,
    };
  }
  if (capability.purpose && !isModelCompatibleWithPurpose(capability.purpose, model)) {
    return {
      availability: 'UNAVAILABLE',
      reason: 'O modelo não atende às modalidades exigidas por esta finalidade.',
      model,
    };
  }
  return { availability: 'ACTIVE', reason: null, model };
}

async function buildHealth(includeOperationalData = true) {
  const settings = await getSettings(HealthInputKeys);
  const apiKey = settings.openrouter_api_key;
  let catalog: OrModel[] | null = [];
  let catalogError: string | null = null;
  if (!apiKey) {
    catalog = null;
    catalogError = 'Configure uma chave da OpenRouter para validar as capacidades.';
  } else {
    try {
      catalog = await listUserModels(apiKey);
    } catch (error) {
      catalog = null;
      catalogError =
        error instanceof OpenrouterError
          ? 'O catálogo da OpenRouter está indisponível agora. Tente novamente em instantes.'
          : 'Não foi possível validar o catálogo da OpenRouter.';
    }
  }

  const embeddingsEnabled = settings.embeddings_enabled?.trim().toLowerCase() === 'true';
  const effectiveModels = CAPABILITIES.map((capability) => {
    const modelId =
      capability.id === 'embeddings'
        ? (settings.embedding_model ?? 'openai/text-embedding-3-small')
        : settings[capability.setting];
    return modelId;
  }).filter((modelId): modelId is string => modelId !== null);
  const metrics = includeOperationalData
    ? await db.costEvent.findMany({
        where: { model: { in: effectiveModels } },
        select: {
          model: true,
          kind: true,
          meta: true,
          costUsd: true,
          tokensIn: true,
          tokensOut: true,
          ts: true,
          jobId: true,
        },
      })
    : [];
  const jobIds = metrics.flatMap((event) => (event.jobId ? [event.jobId] : []));
  const [currentRevision, jobs] = includeOperationalData
    ? await Promise.all([
        db.configRevision.findFirst({
          orderBy: { number: 'desc' },
          select: { id: true, number: true, createdAt: true },
        }),
        jobIds.length > 0
          ? db.job.findMany({
              where: { id: { in: jobIds }, startedAt: { not: null }, finishedAt: { not: null } },
              select: { id: true, startedAt: true, finishedAt: true },
            })
          : [],
      ])
    : [null, [] as Array<{ id: string; startedAt: Date | null; finishedAt: Date | null }>];
  const jobLatencyById = new Map(
    jobs.flatMap((job) =>
      job.startedAt && job.finishedAt
        ? [[job.id, job.finishedAt.getTime() - job.startedAt.getTime()]]
        : [],
    ),
  );

  const capabilities = await Promise.all(
    CAPABILITIES.map(async (capability) => {
      const modelId =
        capability.id === 'embeddings'
          ? (settings.embedding_model ?? 'openai/text-embedding-3-small')
          : settings[capability.setting];
      const state = availabilityFor(capability, modelId, embeddingsEnabled, catalog);
      const rows = metrics.filter((event) => eventMatchesCapability(event, capability, modelId));
      const [jobFailure, checkFailure] = includeOperationalData
        ? await Promise.all([
            capability.jobTypes.length > 0
              ? db.job.findFirst({
                  where: { type: { in: [...capability.jobTypes] }, errorMsg: { not: null } },
                  orderBy: { finishedAt: 'desc' },
                  select: { errorMsg: true, finishedAt: true },
                })
              : null,
            db.aiCapabilityCheck.findFirst({
              where: { capability: capability.id, success: false },
              orderBy: { checkedAt: 'desc' },
              select: { errorMessage: true, checkedAt: true },
            }),
          ])
        : [null, null];
      const lastFailure = [
        jobFailure ? { message: jobFailure.errorMsg, at: jobFailure.finishedAt } : null,
        checkFailure ? { message: checkFailure.errorMessage, at: checkFailure.checkedAt } : null,
      ].reduce<{ message: string | null; at: Date | null } | null>((latest, candidate) => {
        if (!candidate) return latest;
        return !latest || (candidate.at && (!latest.at || candidate.at > latest.at))
          ? candidate
          : latest;
      }, null);
      return {
        id: capability.id,
        modelId,
        modelName: state.model?.name ?? modelId,
        inputModalities: state.model?.architecture?.input_modalities ?? [],
        outputModalities: state.model?.architecture?.output_modalities ?? [],
        availability: state.availability,
        reason: state.reason,
        metrics: {
          events: rows.length,
          costUsd: rows.reduce((sum, row) => sum + Number(row.costUsd), 0),
          tokens: rows.reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0),
          lastUsedAt: rows.reduce<Date | null>((latest, row) => {
            const usedAt = row.ts;
            return !latest || (usedAt && usedAt > latest) ? usedAt : latest;
          }, null),
          latencyMs: (() => {
            const latencies = rows.flatMap((row) => {
              const measured = costEventLatency(row.meta);
              if (measured !== null) return [measured];
              const jobLatency = row.jobId ? jobLatencyById.get(row.jobId) : undefined;
              return typeof jobLatency === 'number' && jobLatency >= 0 ? [jobLatency] : [];
            });
            return latencies.length > 0
              ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
              : null;
          })(),
        },
        lastFailure,
      };
    }),
  );

  return {
    catalog,
    catalogAvailable: catalog !== null,
    catalogError,
    revision: currentRevision,
    capabilities,
  };
}

const PUBLIC_CAPABILITIES_TTL_MS = 60_000;
let publicCapabilitiesCache: {
  expiresAt: number;
  value: { active: OpenRouterProbePurpose[] };
} | null = null;
let publicCapabilitiesInFlight: Promise<{ active: OpenRouterProbePurpose[] }> | null = null;

/** Projeção sem configuração ou métricas para telas de usuários comuns. */
export async function getPublicActiveCapabilities(): Promise<{ active: OpenRouterProbePurpose[] }> {
  if (publicCapabilitiesCache && publicCapabilitiesCache.expiresAt > Date.now()) {
    return publicCapabilitiesCache.value;
  }
  if (publicCapabilitiesInFlight) return publicCapabilitiesInFlight;
  publicCapabilitiesInFlight = buildHealth(false)
    .then((health) => {
      const value = {
        active: health.capabilities
          .filter((capability) => capability.availability === 'ACTIVE')
          .map((capability) => capability.id),
      };
      publicCapabilitiesCache = {
        value,
        expiresAt: Date.now() + PUBLIC_CAPABILITIES_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      publicCapabilitiesInFlight = null;
    });
  return publicCapabilitiesInFlight;
}

adminAiHealthRoutes.get('/', async (c) => {
  const { catalog: _catalog, ...health } = await buildHealth();
  return c.json(health);
});

const CapabilityParams = z.object({ capability: z.string().trim().min(1).max(40) }).strict();

// Verificação remota sem criar conteúdo no Voxen. Nenhuma nota, transcrição,
// job ou CostEvent é escrita por este endpoint.
adminAiHealthRoutes.post('/test', async (c) => {
  const parsed = CapabilityParams.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !capabilityById(parsed.data.capability)) {
    return c.json({ error: 'Capacidade de IA desconhecida.' }, 400);
  }
  const health = await buildHealth();
  const capability = health.capabilities.find((item) => item.id === parsed.data.capability)!;
  if (capability.availability !== 'ACTIVE' || !capability.modelId) {
    return c.json({
      capability: capability.id,
      ok: false,
      reason: capability.reason,
      checkedAt: new Date().toISOString(),
    });
  }
  const startedAt = performance.now();
  try {
    const settings = await getSettings(['openrouter_api_key'] as const);
    if (!settings.openrouter_api_key) throw new OpenrouterError('Chave ausente.');
    await probeOpenRouterCapability(settings.openrouter_api_key, capability.modelId, capability.id);
  } catch (error) {
    await db.aiCapabilityCheck.create({
      data: {
        capability: capability.id,
        model: capability.modelId,
        success: false,
        errorMessage: 'A verificação remota da capacidade falhou.',
        latencyMs: Math.round(performance.now() - startedAt),
      },
    });
    return c.json({
      capability: capability.id,
      ok: false,
      reason:
        error instanceof OpenrouterError
          ? 'A verificação remota falhou. Revise a chave, créditos e disponibilidade do provedor.'
          : 'Não foi possível executar a verificação remota.',
      checkedAt: new Date().toISOString(),
    });
  }
  return c.json({
    capability: capability.id,
    ok: capability.availability === 'ACTIVE',
    reason: capability.reason,
    checkedAt: new Date().toISOString(),
  });
});

const ImpactBody = z
  .object({
    capability: z.string().trim().min(1).max(40),
    modelId: z.string().trim().min(1).max(300),
  })
  .strict();

adminAiHealthRoutes.post('/impact', async (c) => {
  const parsed = ImpactBody.safeParse(await c.req.json().catch(() => null));
  const capability = parsed.success ? capabilityById(parsed.data.capability) : undefined;
  if (!capability || !parsed.success) return c.json({ error: 'Simulação inválida.' }, 400);

  const health = await buildHealth();
  if (!health.catalogAvailable) {
    return c.json({ error: health.catalogError ?? 'Catálogo indisponível.' }, 502);
  }
  const candidate = health.catalog?.find((model) => model.id === parsed.data.modelId) ?? null;
  const compatible =
    candidate !== null &&
    (!capability.purpose || isModelCompatibleWithPurpose(capability.purpose, candidate));
  return c.json({
    capability: capability.id,
    modelId: parsed.data.modelId,
    compatible,
    affectedCapabilities: compatible ? [] : [capability.id],
    reason: compatible ? null : 'O modelo não está disponível ou não atende à modalidade exigida.',
  });
});
