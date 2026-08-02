// ============================================================================
// Voxen — configuração unificada da OpenRouter
// ============================================================================
// A superfície administrativa recebe somente a chave. Depois de validar a
// chave e os recursos canônicos, chave + seis defaults são persistidos em uma
// única transação cifrada.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { isValidIanaTimezone, normalizeAppTimezone } from '../lib/app-timezone';
import { db } from '../lib/db';
import {
  DEFAULT_OPENROUTER_MODELS,
  getModelCompatibilityFailures,
  isModelCompatibleWithPurpose,
  isModelPurpose,
  MODEL_PURPOSES,
  type ModelPurpose,
} from '../lib/model-defaults';
import { inspectOpenRouterAccount, OpenrouterError } from '../lib/openrouter';
import {
  getAppLanguage,
  getAppTimezone,
  getSetting,
  getSettings,
  setSettings,
} from '../lib/settings';

export const setupRoutes = new Hono<{ Variables: { adminUserId: string } }>();

setupRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Não autenticado.' }, 401);
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

setupRoutes.get('/', async (c) => {
  const [apiKey, language, timezone] = await Promise.all([
    getSetting('openrouter_api_key'),
    getAppLanguage(),
    getAppTimezone(),
  ]);
  const complete = Boolean(apiKey);
  return c.json({
    complete,
    hasApiKey: complete,
    language,
    timezone,
  });
});

const SaveBody = z
  .object({
    openrouter_api_key: z.string().trim().min(20).max(512).optional(),
    // O onboarding coleta estes valores em etapas próprias. Eles continuam no
    // mesmo POST para que a primeira configuração seja atômica.
    app_language: z.enum(['pt-BR', 'en']).optional(),
    app_timezone: z.string().trim().min(1).max(64).optional(),
    model_replacements: z.record(z.string(), z.string().trim().min(1).max(200)).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    ({ openrouter_api_key, app_language, app_timezone }) =>
      openrouter_api_key !== undefined || app_language !== undefined || app_timezone !== undefined,
  );

setupRoutes.post('/', async (c) => {
  const parsed = SaveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }

  const { openrouter_api_key, app_language, app_timezone, model_replacements, reason } =
    parsed.data;
  const metadata = { actorUserId: c.get('adminUserId'), reason };
  if (app_timezone !== undefined && !isValidIanaTimezone(app_timezone)) {
    return c.json({ error: 'Timezone IANA inválido.' }, 400);
  }

  const preferences = {
    ...(app_language !== undefined ? { app_language } : {}),
    ...(app_timezone !== undefined ? { app_timezone: normalizeAppTimezone(app_timezone) } : {}),
  };
  if (openrouter_api_key === undefined) {
    if (model_replacements !== undefined) {
      return c.json({ error: 'Substituições de modelo exigem uma nova chave da OpenRouter.' }, 400);
    }
    if (!(await getSetting('openrouter_api_key'))) {
      return c.json(
        { error: 'Informe uma chave da OpenRouter para concluir a configuração.' },
        400,
      );
    }
    await setSettings(preferences, metadata);
    return c.json({ complete: true });
  }

  if (
    model_replacements !== undefined &&
    Object.keys(model_replacements).some((purpose) => !isModelPurpose(purpose))
  ) {
    return c.json({ error: 'Finalidade de modelo inválida.' }, 400);
  }

  const inspection = await inspectOpenRouterAccount(openrouter_api_key).catch((err) => {
    if (err instanceof OpenrouterError) return null;
    throw err;
  });
  if (inspection === null) {
    return c.json({ error: 'Falha ao contatar a OpenRouter. Tente novamente.' }, 502);
  }
  if (!inspection.valid) {
    return c.json({ error: 'Chave da OpenRouter inválida — verifique e tente novamente.' }, 400);
  }
  // Uma finalidade ganha o canônico no primeiro setup e preserva o valor
  // efetivo nas trocas seguintes. A chave candidata só pode ser persistida se
  // os seis valores (ou substituições explícitas) estiverem no catálogo dela.
  const existingModels = await getSettings(MODEL_PURPOSES);
  const effectiveModels = Object.fromEntries(
    MODEL_PURPOSES.map((purpose) => [
      purpose,
      model_replacements?.[purpose] ??
        existingModels[purpose] ??
        DEFAULT_OPENROUTER_MODELS[purpose],
    ]),
  ) as Record<ModelPurpose, string>;
  const failures = getModelCompatibilityFailures(effectiveModels, inspection.models);
  if (failures.length > 0) {
    return c.json(
      {
        error:
          'Alguns modelos configurados não estão disponíveis ou não são compatíveis com a nova chave. Selecione substituições autorizadas antes de salvar.',
        incompatible: failures.map((failure) => ({
          ...failure,
          compatibleModels: inspection.models
            .filter((model) => isModelCompatibleWithPurpose(failure.purpose, model))
            .map((model) => ({ id: model.id, name: model.name ?? model.id })),
        })),
      },
      422,
    );
  }

  await setSettings(
    {
      openrouter_api_key,
      ...effectiveModels,
      ...preferences,
    },
    metadata,
  );

  return c.json({ complete: true });
});
