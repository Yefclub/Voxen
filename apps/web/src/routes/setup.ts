// ============================================================================
// Voxen — Setup routes
// ============================================================================
// Endpoints exclusivos para o admin durante o setup inicial:
//   - GET  /api/setup        → { complete: bool, hasKey: bool }
//   - POST /api/setup/models → lista modelos da OpenRouter (preview pré-save)
//   - POST /api/setup        → valida key + persiste settings cifradas
//
// Spec 000:
//   - Unauthenticated → 401
//   - Authenticated but não-admin → 403
//   - Key inválida → 400 + msg PT-BR, não persiste nada
//   - Key válida → settings cifradas em Setting (GLOBAL), 200
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { isValidIanaTimezone, normalizeAppTimezone } from '../lib/app-timezone';
import {
  getAppLanguage,
  getAppTimezone,
  getDefaultXAnalysisModel,
  getSetting,
  isSetupComplete,
  setDefaultXAnalysisModel,
  setSetting,
  setSettings,
} from '../lib/settings';
import {
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from '../lib/model-defaults';
import {
  validateApiKey,
  listModels,
  listUserModels,
  listVisionModels,
  listDocumentModels,
  listXAnalysisModels,
  OpenrouterError,
} from '../lib/openrouter';

type SetupVariables = {
  adminUserId: string;
};

export const setupRoutes = new Hono<{ Variables: SetupVariables }>();

// Guard: session + role=ADMIN + status=APPROVED.
// (PENDING admin é impossível pela spec — primeiro user vira APPROVED auto.)
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
  const complete = await isSetupComplete();
  const [language, timezone] = await Promise.all([getAppLanguage(), getAppTimezone()]);
  if (!complete) {
    return c.json({
      complete,
      language,
      timezone,
      chatModel: null,
      transcriptionModel: null,
      webSearchModel: null,
      visionModel: null,
      documentModel: null,
      xAnalysisModel: null,
      hasApiKey: false,
    });
  }
  // Modelos não são segredo (são identificadores públicos da OR).
  // A api_key continua cifrada e nunca é exposta — só dizemos que existe.
  const [
    chatModel,
    transcriptionModel,
    webSearchModel,
    visionModel,
    documentModel,
    xAnalysisModel,
    apiKey,
  ] = await Promise.all([
    getSetting('default_chat_model'),
    getSetting('default_transcription_model'),
    getSetting('default_web_search_model'),
    getSetting('default_vision_model'),
    getSetting('default_document_model'),
    getDefaultXAnalysisModel(),
    getSetting('openrouter_api_key'),
  ]);
  return c.json({
    complete,
    language,
    timezone,
    chatModel,
    transcriptionModel,
    webSearchModel,
    visionModel,
    documentModel,
    xAnalysisModel,
    hasApiKey: !!apiKey,
  });
});

const ModelsBody = z.object({
  // opcional: se vier, usa a key nova; senão, usa a já cifrada no DB
  openrouter_api_key: z.string().min(20).optional(),
});

setupRoutes.post('/models', async (c) => {
  const parsed = ModelsBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }
  // Se admin não enviou key nova, usamos a já configurada (re-listar modelos
  // sem precisar redigitar a chave — caso comum quando quer trocar modelo).
  let key = parsed.data.openrouter_api_key;
  if (!key) {
    const existing = await getSetting('openrouter_api_key');
    if (!existing) {
      return c.json({ error: 'Nenhuma chave configurada. Envie openrouter_api_key.' }, 400);
    }
    key = existing;
  } else {
    // key nova → valida antes de listar
    const valid = await validateApiKey(key).catch((err) => {
      if (err instanceof OpenrouterError) return null;
      throw err;
    });
    if (valid === false) {
      return c.json({ error: 'Chave da OpenRouter inválida — verifique e tente novamente.' }, 400);
    }
    if (valid === null) {
      return c.json({ error: 'Falha ao contatar a OpenRouter. Tente novamente.' }, 502);
    }
  }
  try {
    const [chat, transcription, vision, document, xAnalysis] = await Promise.all([
      listModels(key, 'text'),
      listModels(key, 'transcription'),
      listVisionModels(key),
      listDocumentModels(key),
      listXAnalysisModels(key),
    ]);
    // Web search: a server tool `openrouter:web_search` é model-agnostic.
    // Devolvemos a lista de chat repetida para o admin escolher um modelo
    // dedicado, sem depender do sufixo deprecated `:online`.
    return c.json({ chat, transcription, vision, document, xAnalysis, web: chat });
  } catch (err) {
    if (err instanceof OpenrouterError) {
      return c.json({ error: 'Falha ao listar modelos da OpenRouter.' }, 502);
    }
    throw err;
  }
});

const SaveBody = z.object({
  app_language: z.enum(['pt-BR', 'en']).optional(),
  app_timezone: z.string().min(1).max(64).optional(),
  // opcional pra permitir trocar só os modelos sem reenviar a key
  openrouter_api_key: z.string().min(20).optional(),
  default_chat_model: z.string().min(1).optional(),
  default_transcription_model: z.string().min(1).optional(),
  // Opcional: modelo dedicado a pesquisa web. String vazia restaura o padrão.
  default_web_search_model: z.string().optional(),
  // Opcional: modelo multimodal pra entender imagens. Vazio restaura o padrão.
  default_vision_model: z.string().optional(),
  // Opcional: modelo que aceita PDF/arquivo nativamente. Vazio restaura o padrão.
  default_document_model: z.string().optional(),
  // Opcional: modelo Grok/xAI para analisar posts/threads do X via busca nativa.
  default_x_analysis_model: z.string().optional(),
});

setupRoutes.post('/', async (c) => {
  const parsed = SaveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }
  const {
    openrouter_api_key,
    default_chat_model,
    default_transcription_model,
    default_web_search_model,
    default_vision_model,
    default_document_model,
    default_x_analysis_model,
    app_language,
    app_timezone,
  } = parsed.data;
  const isAutomaticSetup =
    openrouter_api_key !== undefined &&
    default_chat_model === undefined &&
    default_transcription_model === undefined;

  if ((default_chat_model === undefined) !== (default_transcription_model === undefined)) {
    return c.json({ error: 'Informe os modelos de texto e transcrição juntos.' }, 400);
  }

  if (app_timezone !== undefined && !isValidIanaTimezone(app_timezone)) {
    return c.json({ error: 'Timezone IANA inválido.' }, 400);
  }

  // Se a key veio no payload, valida + persiste. Senão, usa a já cifrada
  // (admin está só atualizando os modelos default).
  if (openrouter_api_key) {
    const valid = await validateApiKey(openrouter_api_key).catch((err) => {
      if (err instanceof OpenrouterError) return null;
      throw err;
    });
    if (valid === false) {
      return c.json({ error: 'Chave da OpenRouter inválida — verifique e tente novamente.' }, 400);
    }
    if (valid === null) {
      return c.json({ error: 'Falha ao contatar a OpenRouter. Tente novamente.' }, 502);
    }
    if (isAutomaticSetup) {
      let availableModels: Awaited<ReturnType<typeof listUserModels>>;
      try {
        availableModels = await listUserModels(openrouter_api_key);
      } catch (err) {
        if (err instanceof OpenrouterError) {
          return c.json({ error: 'Falha ao validar os modelos padrão na OpenRouter.' }, 502);
        }
        throw err;
      }
      const textDefault = availableModels.find((model) => model.id === DEFAULT_TEXT_MODEL);
      const transcriptionDefault = availableModels.find(
        (model) => model.id === DEFAULT_TRANSCRIPTION_MODEL,
      );
      const textInputs = textDefault?.architecture?.input_modalities ?? [];
      const textOutputs = textDefault?.architecture?.output_modalities ?? [];
      const transcriptionOutputs = transcriptionDefault?.architecture?.output_modalities ?? [];
      const textCapabilitiesValid =
        textInputs.includes('text') &&
        textInputs.includes('image') &&
        textInputs.includes('file') &&
        textOutputs.includes('text');
      const transcriptionCapabilitiesValid = transcriptionOutputs.includes('transcription');
      if (
        !textDefault ||
        !transcriptionDefault ||
        !textCapabilitiesValid ||
        !transcriptionCapabilitiesValid
      ) {
        return c.json(
          {
            error:
              'Os modelos padrão da Voxen não estão disponíveis para esta chave. Tente novamente ou configure-os na área administrativa.',
          },
          422,
        );
      }
      await setSettings({
        openrouter_api_key,
        ...DEFAULT_OPENROUTER_MODELS,
        ...(app_language !== undefined ? { app_language } : {}),
        ...(app_timezone !== undefined ? { app_timezone: normalizeAppTimezone(app_timezone) } : {}),
      });
      return c.json({ complete: true, automaticModels: DEFAULT_OPENROUTER_MODELS });
    }
  } else {
    // Sem key no payload — precisa existir uma cifrada de antes
    const existing = await getSetting('openrouter_api_key');
    if (!existing) {
      return c.json(
        { error: 'Nenhuma chave configurada. Envie openrouter_api_key na primeira vez.' },
        400,
      );
    }
  }

  if (!default_chat_model || !default_transcription_model) {
    return c.json({ error: 'Informe os modelos de texto e transcrição.' }, 400);
  }
  await setSettings({
    ...(openrouter_api_key ? { openrouter_api_key } : {}),
    default_chat_model,
    default_transcription_model,
  });
  // Modelos opcionais: string vazia restaura o padrão; undefined preserva o atual.
  if (default_web_search_model !== undefined) {
    if (default_web_search_model.trim() === '') {
      await setSetting('default_web_search_model', DEFAULT_TEXT_MODEL);
    } else {
      await setSetting('default_web_search_model', default_web_search_model);
    }
  }
  if (default_vision_model !== undefined) {
    if (default_vision_model.trim() === '') {
      await setSetting('default_vision_model', DEFAULT_TEXT_MODEL);
    } else {
      await setSetting('default_vision_model', default_vision_model);
    }
  }
  if (default_document_model !== undefined) {
    if (default_document_model.trim() === '') {
      await setSetting('default_document_model', DEFAULT_TEXT_MODEL);
    } else {
      await setSetting('default_document_model', default_document_model);
    }
  }
  if (default_x_analysis_model !== undefined) {
    if (default_x_analysis_model.trim() === '') {
      await setDefaultXAnalysisModel(DEFAULT_TEXT_MODEL);
    } else {
      await setDefaultXAnalysisModel(default_x_analysis_model);
    }
  }
  if (app_language !== undefined) {
    await setSetting('app_language', app_language);
  }
  if (app_timezone !== undefined) {
    await setSetting('app_timezone', normalizeAppTimezone(app_timezone));
  }

  return c.json({ complete: true });
});
