// ============================================================================
// /api/admin/models — seleção manual de modelos por finalidade (spec 123)
// ============================================================================
// O onboarding (spec 118) aplica um único modelo canônico por finalidade
// (`DEFAULT_OPENROUTER_MODELS`). Esta rota permite que um ADMIN sobrescreva,
// individualmente, o modelo de cada uma das 6 finalidades — sem alterar o
// fluxo de onboarding.
//
// Modelo de dados: as 6 chaves de Setting (`default_chat_model` etc.) SEMPRE
// guardam o modelo EFETIVO (canônico ou override) depois do primeiro setup —
// nunca ficam ausentes. "Há override?" é decidido comparando o valor
// armazenado com o canônico daquela finalidade (`isOverride`). Reverter para
// o padrão GRAVA o valor canônico de volta (não apaga a chave) — assim os
// consumidores que leem `getSetting(<finalidade>)` (chat, resumo, tags,
// título, busca web, documentos) continuam recebendo sempre um valor.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import {
  canonicalModelForPurpose,
  fallbackSettingForPurpose,
  isFallbackCompatible,
  isModelCompatibleWithPurpose,
  isModelPurpose,
  MODEL_PURPOSES,
  MODEL_FALLBACK_SETTINGS,
  suggestFallbackForPurpose,
  type ModelPurpose,
} from '../lib/model-defaults';
import { listUserModels, OpenrouterError, type OrModel } from '../lib/openrouter';
import { getSetting, getSettings, setSetting, setSettings } from '../lib/settings';

type Vars = { adminUserId: string };

export const adminModelsRoutes = new Hono<{ Variables: Vars }>();

adminModelsRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
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

interface PurposeStatus {
  purpose: ModelPurpose;
  canonical: string;
  override: string | null;
  effective: string;
  fallback: string | null;
}

async function buildPurposeStatuses(): Promise<PurposeStatus[]> {
  const stored = await getSettings([...MODEL_PURPOSES, ...MODEL_FALLBACK_SETTINGS]);
  return MODEL_PURPOSES.map((purpose) => {
    const canonical = canonicalModelForPurpose(purpose);
    const value = stored[purpose];
    const override = value && value !== canonical ? value : null;
    return {
      purpose,
      canonical,
      override,
      effective: value ?? canonical,
      fallback: stored[fallbackSettingForPurpose(purpose)] ?? null,
    };
  });
}

// GET / — status das 6 finalidades (canônico vs override ativo).
adminModelsRoutes.get('/', async (c) => {
  const [purposes, apiKey] = await Promise.all([
    buildPurposeStatuses(),
    getSetting('openrouter_api_key').catch(() => null),
  ]);
  return c.json({ purposes, hasApiKey: Boolean(apiKey) });
});

// GET /catalog/:purpose — catálogo OpenRouter filtrado por compatibilidade
// com a finalidade. Não persiste nada; falha isolada (não mexe em overrides).
adminModelsRoutes.get('/catalog/:purpose', async (c) => {
  const purposeParam = c.req.param('purpose');
  if (!isModelPurpose(purposeParam)) {
    return c.json({ error: 'Finalidade de modelo desconhecida.' }, 400);
  }

  const apiKey = await getSetting('openrouter_api_key').catch(() => null);
  if (!apiKey) {
    return c.json({ error: 'Configure a chave da OpenRouter antes de escolher modelos.' }, 409);
  }

  let models: OrModel[];
  try {
    models = await listUserModels(apiKey);
  } catch (err) {
    if (err instanceof OpenrouterError) {
      return c.json(
        { error: 'Catálogo da OpenRouter indisponível agora. Tente novamente em instantes.' },
        502,
      );
    }
    throw err;
  }

  const compatible = models.filter((model) => isModelCompatibleWithPurpose(purposeParam, model));
  return c.json({ purpose: purposeParam, models: compatible });
});

const PatchBody = z.object({ modelId: z.string().trim().min(1).max(300) }).strict();

// PATCH /:purpose — define um override, validando disponibilidade e
// compatibilidade contra o catálogo atual da chave configurada.
adminModelsRoutes.patch('/:purpose', async (c) => {
  const purposeParam = c.req.param('purpose');
  if (!isModelPurpose(purposeParam)) {
    return c.json({ error: 'Finalidade de modelo desconhecida.' }, 400);
  }

  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Informe "modelId".' }, 400);
  }
  const { modelId } = parsed.data;

  const apiKey = await getSetting('openrouter_api_key').catch(() => null);
  if (!apiKey) {
    return c.json({ error: 'Configure a chave da OpenRouter antes de escolher modelos.' }, 409);
  }

  let models: OrModel[];
  try {
    models = await listUserModels(apiKey);
  } catch (err) {
    if (err instanceof OpenrouterError) {
      return c.json(
        { error: 'Catálogo da OpenRouter indisponível agora. Tente novamente em instantes.' },
        502,
      );
    }
    throw err;
  }

  const model = models.find((m) => m.id === modelId);
  if (!model) {
    return c.json({ error: 'Modelo não encontrado no catálogo disponível para esta chave.' }, 404);
  }
  if (!isModelCompatibleWithPurpose(purposeParam, model)) {
    return c.json({ error: `O modelo "${modelId}" não é compatível com esta finalidade.` }, 422);
  }

  const fallbackSetting = fallbackSettingForPurpose(purposeParam);
  const currentFallback = await getSetting(fallbackSetting);
  const nextFallback = isFallbackCompatible(purposeParam, modelId, currentFallback, models)
    ? currentFallback
    : suggestFallbackForPurpose(purposeParam, modelId, models);
  await setSettings(
    { [purposeParam]: modelId, [fallbackSetting]: nextFallback },
    { actorUserId: c.get('adminUserId') },
  );
  const canonical = canonicalModelForPurpose(purposeParam);
  const override = modelId !== canonical ? modelId : null;
  return c.json({
    purpose: purposeParam,
    canonical,
    override,
    effective: modelId,
    fallback: nextFallback,
  });
});

// DELETE /:purpose — reverte para o modelo canônico (grava o valor canônico
// de volta; nunca deixa a chave ausente — ver nota de topo do arquivo).
adminModelsRoutes.delete('/:purpose', async (c) => {
  const purposeParam = c.req.param('purpose');
  if (!isModelPurpose(purposeParam)) {
    return c.json({ error: 'Finalidade de modelo desconhecida.' }, 400);
  }
  const canonical = canonicalModelForPurpose(purposeParam);
  const fallbackSetting = fallbackSettingForPurpose(purposeParam);
  const currentFallback = await getSetting(fallbackSetting);
  const nextFallback = currentFallback === canonical ? null : currentFallback;
  await setSettings(
    { [purposeParam]: canonical, [fallbackSetting]: nextFallback },
    { actorUserId: c.get('adminUserId') },
  );
  return c.json({
    purpose: purposeParam,
    canonical,
    override: null,
    effective: canonical,
    fallback: nextFallback,
  });
});

// PATCH /:purpose/fallback — configura uma alternativa compatível e distinta.
adminModelsRoutes.patch('/:purpose/fallback', async (c) => {
  const purposeParam = c.req.param('purpose');
  if (!isModelPurpose(purposeParam)) {
    return c.json({ error: 'Finalidade de modelo desconhecida.' }, 400);
  }
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Informe "modelId".' }, 400);
  const { modelId } = parsed.data;
  const [apiKey, primary] = await Promise.all([
    getSetting('openrouter_api_key').catch(() => null),
    getSetting(purposeParam),
  ]);
  if (!apiKey) {
    return c.json({ error: 'Configure a chave da OpenRouter antes de escolher modelos.' }, 409);
  }
  const effectivePrimary = primary ?? canonicalModelForPurpose(purposeParam);
  if (modelId === effectivePrimary) {
    return c.json({ error: 'O fallback deve ser diferente do modelo primário.' }, 422);
  }
  let models: OrModel[];
  try {
    models = await listUserModels(apiKey);
  } catch (err) {
    if (err instanceof OpenrouterError) {
      return c.json(
        { error: 'Catálogo da OpenRouter indisponível agora. Tente novamente em instantes.' },
        502,
      );
    }
    throw err;
  }
  const model = models.find((candidate) => candidate.id === modelId);
  if (!model) {
    return c.json({ error: 'Modelo não encontrado no catálogo disponível para esta chave.' }, 404);
  }
  if (!isModelCompatibleWithPurpose(purposeParam, model)) {
    return c.json({ error: `O modelo "${modelId}" não é compatível com esta finalidade.` }, 422);
  }
  await setSetting(fallbackSettingForPurpose(purposeParam), modelId, {
    actorUserId: c.get('adminUserId'),
  });
  const canonical = canonicalModelForPurpose(purposeParam);
  return c.json({
    purpose: purposeParam,
    canonical,
    override: effectivePrimary === canonical ? null : effectivePrimary,
    effective: effectivePrimary,
    fallback: modelId,
  });
});

// DELETE /:purpose/fallback — desativa apenas a rota alternativa.
adminModelsRoutes.delete('/:purpose/fallback', async (c) => {
  const purposeParam = c.req.param('purpose');
  if (!isModelPurpose(purposeParam)) {
    return c.json({ error: 'Finalidade de modelo desconhecida.' }, 400);
  }
  const effective = (await getSetting(purposeParam)) ?? canonicalModelForPurpose(purposeParam);
  await setSettings(
    { [fallbackSettingForPurpose(purposeParam)]: null },
    { actorUserId: c.get('adminUserId') },
  );
  const canonical = canonicalModelForPurpose(purposeParam);
  return c.json({
    purpose: purposeParam,
    canonical,
    override: effective === canonical ? null : effective,
    effective,
    fallback: null,
  });
});
