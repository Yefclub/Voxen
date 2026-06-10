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
import {
  deleteDefaultXAnalysisModel,
  deleteSetting,
  getAppLanguage,
  getDefaultXAnalysisModel,
  getSetting,
  isSetupComplete,
  setDefaultXAnalysisModel,
  setSetting,
} from '../lib/settings';
import {
  validateApiKey,
  listModels,
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
  const language = await getAppLanguage();
  if (!complete) {
    return c.json({
      complete,
      language,
      chatModel: null,
      transcriptionModel: null,
      webSearchModel: null,
      visionModel: null,
      documentModel: null,
      xAnalysisModel: null,
      adminEmail: null,
      summaryTimeoutSec: null,
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
    adminEmail,
    summaryTimeoutSec,
    apiKey,
  ] = await Promise.all([
    getSetting('default_chat_model'),
    getSetting('default_transcription_model'),
    getSetting('default_web_search_model'),
    getSetting('default_vision_model'),
    getSetting('default_document_model'),
    getDefaultXAnalysisModel(),
    getSetting('admin_email'),
    getSetting('summary_timeout_sec'),
    getSetting('openrouter_api_key'),
  ]);
  return c.json({
    complete,
    language,
    chatModel,
    transcriptionModel,
    webSearchModel,
    visionModel,
    documentModel,
    xAnalysisModel,
    adminEmail,
    summaryTimeoutSec,
    hasApiKey: !!apiKey,
    ytDlp: {
      proxies: !!(await getSetting('yt_dlp_proxy_urls')),
    },
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
  // opcional pra permitir trocar só os modelos sem reenviar a key
  openrouter_api_key: z.string().min(20).optional(),
  default_chat_model: z.string().min(1),
  default_transcription_model: z.string().min(1),
  // Opcional: modelo dedicado a pesquisa web. Fallback é `default_chat_model`
  // com a server tool `openrouter:web_search`. String vazia = limpar setting.
  default_web_search_model: z.string().optional(),
  // Opcional: modelo multimodal pra entender imagens (vision). Vazio = limpar.
  default_vision_model: z.string().optional(),
  // Opcional: modelo que aceita PDF/arquivo nativamente para documentos.
  default_document_model: z.string().optional(),
  // Opcional: modelo Grok/xAI para analisar posts/threads do X via busca nativa.
  default_x_analysis_model: z.string().optional(),
  yt_dlp_proxy_urls: z.string().optional(),
  admin_email: z.string().optional(),
  summary_timeout_sec: z.string().optional(),
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
    yt_dlp_proxy_urls,
    admin_email,
    summary_timeout_sec,
    app_language,
  } = parsed.data;

  const normalizedAdminEmail = admin_email?.trim();
  if (
    normalizedAdminEmail !== undefined &&
    normalizedAdminEmail !== '' &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedAdminEmail)
  ) {
    return c.json({ error: 'Email do operador inválido.' }, 400);
  }

  const normalizedSummaryTimeout = summary_timeout_sec?.trim();
  let summaryTimeoutToSave: string | null | undefined;
  if (normalizedSummaryTimeout !== undefined) {
    if (normalizedSummaryTimeout === '') {
      summaryTimeoutToSave = null;
    } else {
      const parsedTimeout = Number(normalizedSummaryTimeout);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout < 30 || parsedTimeout > 600) {
        return c.json({ error: 'Timeout de resumo deve ficar entre 30 e 600 segundos.' }, 400);
      }
      summaryTimeoutToSave = String(Math.round(parsedTimeout));
    }
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
    await setSetting('openrouter_api_key', openrouter_api_key);
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

  await setSetting('default_chat_model', default_chat_model);
  await setSetting('default_transcription_model', default_transcription_model);
  // Modelos opcionais: string vazia/undefined = limpar (volta pro fallback);
  // qualquer outra = persiste.
  if (default_web_search_model !== undefined) {
    if (default_web_search_model.trim() === '') {
      await deleteSetting('default_web_search_model');
    } else {
      await setSetting('default_web_search_model', default_web_search_model);
    }
  }
  if (default_vision_model !== undefined) {
    if (default_vision_model.trim() === '') {
      await deleteSetting('default_vision_model');
    } else {
      await setSetting('default_vision_model', default_vision_model);
    }
  }
  if (default_document_model !== undefined) {
    if (default_document_model.trim() === '') {
      await deleteSetting('default_document_model');
    } else {
      await setSetting('default_document_model', default_document_model);
    }
  }
  if (default_x_analysis_model !== undefined) {
    if (default_x_analysis_model.trim() === '') {
      await deleteDefaultXAnalysisModel();
    } else {
      await setDefaultXAnalysisModel(default_x_analysis_model);
    }
  }
  if (yt_dlp_proxy_urls !== undefined) {
    if (yt_dlp_proxy_urls.trim() === '') {
      await deleteSetting('yt_dlp_proxy_urls');
    } else {
      await setSetting('yt_dlp_proxy_urls', yt_dlp_proxy_urls);
    }
  }
  if (normalizedAdminEmail !== undefined) {
    if (normalizedAdminEmail === '') {
      await deleteSetting('admin_email');
    } else {
      await setSetting('admin_email', normalizedAdminEmail);
    }
  }
  if (summaryTimeoutToSave !== undefined) {
    if (summaryTimeoutToSave === null) {
      await deleteSetting('summary_timeout_sec');
    } else {
      await setSetting('summary_timeout_sec', summaryTimeoutToSave);
    }
  }
  if (app_language !== undefined) {
    await setSetting('app_language', app_language);
  }

  return c.json({ complete: true });
});
