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
import { DEFAULT_APP_TIMEZONE, normalizeAppTimezone } from './app-timezone';

export type GlobalSettingKey =
  | 'openrouter_api_key'
  | 'app_language'
  /** IANA timezone da instância (spec 095). Default America/Sao_Paulo. */
  | 'app_timezone'
  | 'default_chat_model'
  | 'default_transcription_model'
  // Modelo dedicado a pesquisa na web. A tool `web_search` usa a server tool
  // OpenRouter `openrouter:web_search`; não depende do sufixo deprecated :online.
  | 'default_web_search_model'
  // Modelo multimodal pra entender imagens (upload de mídia).
  // Filtrado por modalities=['image'] no /api/openrouter/models.
  | 'default_vision_model'
  // Modelo multimodal/documental pra PDF nativo e análise de documentos.
  // Filtrado por architecture.input_modalities=['file'] na OpenRouter.
  | 'default_document_model'
  // Modelo Grok/xAI dedicado a análise de posts e threads do X via OpenRouter.
  | 'default_x_analysis_model'
  // Proxy opcional usado pelo extrator de mídia. Em deploys home-lab (IP
  // residencial) normalmente desnecessário; em VPS pode ajudar quando o
  // YouTube bloqueia downloads de datacenter (proxy residencial controlado
  // pelo operador).
  | 'yt_dlp_proxy_urls'
  // Conteúdo do cookies.txt (formato Netscape) para extração autenticada via
  // yt-dlp (Instagram serve rendition só-vídeo sem login; YouTube anti-bot).
  // Secret cifrado — espelha yt_dlp_proxy_urls. NUNCA retornado em texto por
  // endpoint nem logado; worker materializa em arquivo temp 600. Ver spec 063.
  | 'yt_dlp_cookies'
  | 'allow_signups'
  | 'onboarding_done'
  // Opcional: timeout (segundos) da chamada de resumo via OpenRouter.
  // Default 120s. Útil pra textos muito longos ou modelos lentos.
  | 'summary_timeout_sec'
  // MCP server token (formato `<userId>:<token>`). Endpoint /mcp aceita
  // Bearer <token> e mapeia pro userId. Apenas 1 token por instância no MVP.
  | 'mcp_api_token'
  // Token de conexão do agente de proxy residencial (chisel). Cifrado em DB.
  // O agente residencial usa este token pra autenticar o túnel reverso.
  // Apenas 1 token por instância no MVP. Ver spec 058.
  | 'proxy_agent_token'
  // Switch on/off do Agente de Proxy: 'true'/'false'. Controla se o worker
  // roteia a extração pelo SOCKS do túnel (yt_dlp_proxy_urls). Independente do
  // token — desligar não apaga o token nem exige reinstalar o agente.
  | 'proxy_agent_enabled'
  /** Spec 104: embeddings opt-in ('true'/'false'). Default off — FTS continua default. */
  | 'embeddings_enabled'
  /** Modelo OpenRouter de embedding (ex.: openai/text-embedding-3-small). */
  | 'embedding_model';

const X_ANALYSIS_SETTING_KEYS = [
  'default_x_analysis_model',
  'default_grok_model',
  'default_x_model',
  'x_analysis_model',
] as const;

export type AppLanguage = 'pt-BR' | 'en';

export function normalizeAppLanguage(value: string | null | undefined): AppLanguage {
  return value === 'en' ? 'en' : 'pt-BR';
}

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

export async function getAppLanguage(): Promise<AppLanguage> {
  return normalizeAppLanguage(await getSetting('app_language'));
}

export async function getAppTimezone(): Promise<string> {
  const raw = await getSetting('app_timezone').catch(() => null);
  return normalizeAppTimezone(raw ?? DEFAULT_APP_TIMEZONE);
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
