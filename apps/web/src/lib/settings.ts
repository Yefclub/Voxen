// ============================================================================
// Settings — abstração sobre Setting (cifrado em AES-256-GCM)
// ============================================================================
// API:
//   getSetting('openrouter_api_key')      → string | null (decifrado)
//   setSetting('openrouter_api_key', val) → void          (cifra + upsert)
//   isSetupComplete()                     → boolean
//
// Convenção: chaves GLOBAL não levam userId. Postgres trata múltiplos NULLs
// como distintos em UNIQUE — então usamos `findFirst` + transação em vez de
// `findUnique`/`upsert` que dependem de unique compostos com NULL.
// ============================================================================

import { db } from './db';
import { encrypt, decrypt } from './crypto';
import { getMasterKey } from './master-key';

export type GlobalSettingKey =
  | 'openrouter_api_key'
  | 'default_chat_model'
  | 'default_transcription_model'
  // Modelo dedicado a pesquisa na web — OpenRouter aceita `:online` em
  // qualquer modelo (plugin web da Perplexity) ou modelos nativos com
  // `web_search_options`. Tool `web_search` no agente usa este modelo.
  | 'default_web_search_model'
  // Modelo multimodal pra entender imagens (upload via chat/telegram).
  // Filtrado por modalities=['image'] no /api/openrouter/models.
  | 'default_vision_model'
  // Modelo multimodal/documental pra PDF nativo e análise de documentos.
  // Filtrado por architecture.input_modalities=['file'] na OpenRouter.
  | 'default_document_model'
  // Modelo Grok/xAI dedicado a análise de posts e threads do X via OpenRouter.
  | 'default_x_analysis_model'
  // Configurações opcionais do extrator de mídia para ambientes onde YouTube
  // aplica soft-block anti-bot. Chaves `yt_dlp_*` ficam por compatibilidade.
  | 'yt_dlp_cookies_txt'
  | 'yt_dlp_proxy_urls'
  | 'yt_dlp_user_agent'
  | 'yt_dlp_youtube_clients'
  | 'yt_dlp_youtube_po_tokens'
  | 'yt_dlp_pot_provider_url'
  | 'allow_signups'
  | 'onboarding_done'
  // Opcional: email do admin do deploy. Quando setado, scraper inclui
  // `From: <email>` no User-Agent (boa-prática pra sites identificarem o operador).
  | 'admin_email'
  // Opcional: timeout (segundos) da chamada de summarize-transcript no chat
  // service. Default 90s. Útil pra textos muito longos ou modelos lentos.
  | 'summary_timeout_sec'
  // MCP server token (formato `<userId>:<token>`). Endpoint /mcp aceita
  // Bearer <token> e mapeia pro userId. Apenas 1 token por instância no MVP.
  | 'mcp_api_token'
  // Telegram bot token (cifrado). Quando setado, worker telegram conecta.
  | 'telegram_bot_token';

const X_ANALYSIS_SETTING_KEYS = [
  'default_x_analysis_model',
  'default_grok_model',
  'default_x_model',
  'x_analysis_model',
] as const;

export async function getSetting(key: GlobalSettingKey): Promise<string | null> {
  return getSettingByKey(key);
}

export async function getSettingByKey(key: string): Promise<string | null> {
  const row = await db.setting.findFirst({
    where: { scope: 'GLOBAL', userId: null, key },
    select: { valueEnc: true },
  });
  if (!row) return null;
  return decrypt(row.valueEnc, getMasterKey());
}

export async function getFirstSettingByKey(keys: readonly string[]): Promise<string | null> {
  for (const key of keys) {
    const value = await getSettingByKey(key);
    if (value) return value;
  }
  return null;
}

export async function getDefaultXAnalysisModel(): Promise<string | null> {
  return getFirstSettingByKey(X_ANALYSIS_SETTING_KEYS);
}

export async function setSetting(key: GlobalSettingKey, value: string): Promise<void> {
  const valueEnc = encrypt(value, getMasterKey());
  await db.$transaction(async (tx) => {
    const existing = await tx.setting.findFirst({
      where: { scope: 'GLOBAL', userId: null, key },
      select: { id: true },
    });
    if (existing) {
      await tx.setting.update({ where: { id: existing.id }, data: { valueEnc } });
    } else {
      await tx.setting.create({ data: { scope: 'GLOBAL', userId: null, key, valueEnc } });
    }
  });
}

export async function deleteSetting(key: GlobalSettingKey): Promise<void> {
  await deleteSettingByKey(key);
}

export async function deleteSettingByKey(key: string): Promise<void> {
  await db.setting.deleteMany({ where: { scope: 'GLOBAL', userId: null, key } });
}

export async function setDefaultXAnalysisModel(value: string): Promise<void> {
  for (const key of X_ANALYSIS_SETTING_KEYS) {
    if (key !== 'default_x_analysis_model') await deleteSettingByKey(key);
  }
  await setSetting('default_x_analysis_model', value);
}

export async function deleteDefaultXAnalysisModel(): Promise<void> {
  for (const key of X_ANALYSIS_SETTING_KEYS) {
    await deleteSettingByKey(key);
  }
}

export async function isSetupComplete(): Promise<boolean> {
  const row = await db.setting.findFirst({
    where: { scope: 'GLOBAL', userId: null, key: 'openrouter_api_key' },
    select: { id: true },
  });
  return row !== null;
}
