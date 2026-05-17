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
import { getSetting, isSetupComplete, setSetting } from '../lib/settings';
import { validateApiKey, listModels, OpenrouterError } from '../lib/openrouter';

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
  if (!complete) {
    return c.json({ complete, chatModel: null, transcriptionModel: null, hasApiKey: false });
  }
  // Modelos não são segredo (são identificadores públicos da OR).
  // A api_key continua cifrada e nunca é exposta — só dizemos que existe.
  const [chatModel, transcriptionModel, apiKey] = await Promise.all([
    getSetting('default_chat_model'),
    getSetting('default_transcription_model'),
    getSetting('openrouter_api_key'),
  ]);
  return c.json({
    complete,
    chatModel,
    transcriptionModel,
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
    const [chat, transcription] = await Promise.all([
      listModels(key, 'text'),
      listModels(key, 'transcription'),
    ]);
    return c.json({ chat, transcription });
  } catch (err) {
    if (err instanceof OpenrouterError) {
      return c.json({ error: 'Falha ao listar modelos da OpenRouter.' }, 502);
    }
    throw err;
  }
});

const SaveBody = z.object({
  // opcional pra permitir trocar só os modelos sem reenviar a key
  openrouter_api_key: z.string().min(20).optional(),
  default_chat_model: z.string().min(1),
  default_transcription_model: z.string().min(1),
});

setupRoutes.post('/', async (c) => {
  const parsed = SaveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }
  const { openrouter_api_key, default_chat_model, default_transcription_model } = parsed.data;

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

  return c.json({ complete: true });
});
