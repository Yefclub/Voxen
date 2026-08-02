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
  // Metadado (NÃO-secret) das capturas de cookie feitas pela extensão:
  // JSON {"<plataforma>": {"capturedAt": "<ISO>"}}. Fica separado do valor
  // porque o formato de `yt_dlp_cookies` é contrato com o yt-dlp — envelope
  // ali quebraria o worker e qualquer cookies.txt colado à mão. Ver spec 121.
  | 'platform_cookies_meta'
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

export type GlobalConfigChangeMetadata = {
  actorUserId?: string;
  reason?: string;
};

export type ConfigRevisionSummary = {
  id: string;
  number: number;
  createdAt: Date;
};

/** A revisão registra a mudança, nunca o conteúdo de uma credencial. */
export function isSecretGlobalSettingKey(key: string): boolean {
  // A URL de proxy pode conter user:password@host e portanto não é segura
  // para um diff administrativo, mesmo que não tenha "token" no nome.
  return /(api[_-]?key|token|cookie|password|secret)|^yt_dlp_proxy_urls$/i.test(key);
}

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

export async function getSettingsByKeys<const Keys extends readonly string[]>(
  keys: Keys,
): Promise<{ [Key in Keys[number]]: string | null }> {
  const uniqueKeys = [...new Set(keys)];
  const rows = await db.setting.findMany({
    where: { scope: 'GLOBAL', userId: null, key: { in: uniqueKeys } },
    select: { key: true, valueEnc: true },
  });
  const values = Object.fromEntries(keys.map((key) => [key, null])) as {
    [Key in Keys[number]]: string | null;
  };
  const mutableValues = values as Record<string, string | null>;
  const masterKey = rows.length > 0 ? getMasterKey() : null;
  for (const row of rows) {
    if (masterKey && uniqueKeys.includes(row.key)) {
      mutableValues[row.key] = decrypt(row.valueEnc, masterKey);
    }
  }
  return values;
}

export async function getSettings<const Keys extends readonly GlobalSettingKey[]>(
  keys: Keys,
): Promise<{ [Key in Keys[number]]: string | null }> {
  return getSettingsByKeys(keys);
}

export async function getAppLanguage(): Promise<AppLanguage> {
  return normalizeAppLanguage(await getSetting('app_language'));
}

export async function getAppTimezone(): Promise<string> {
  const raw = await getSetting('app_timezone').catch(() => null);
  return normalizeAppTimezone(raw ?? DEFAULT_APP_TIMEZONE);
}

export async function getFirstSettingByKey(keys: readonly string[]): Promise<string | null> {
  const values = await getSettingsByKeys(keys);
  for (const key of keys) {
    const value = values[key];
    if (value) return value;
  }
  return null;
}

export async function getDefaultXAnalysisModel(): Promise<string | null> {
  return getFirstSettingByKey(X_ANALYSIS_SETTING_KEYS);
}

export async function setSetting(
  key: GlobalSettingKey,
  value: string,
  metadata?: GlobalConfigChangeMetadata,
): Promise<void> {
  await setSettings({ [key]: value }, metadata);
}

export async function setSettings(
  values: Partial<Record<GlobalSettingKey, string | null>>,
  metadata?: GlobalConfigChangeMetadata,
): Promise<void> {
  await applyGlobalSettings(values, metadata);
}

type GlobalSettingMutation = Record<string, string | null | undefined>;

async function applyGlobalSettings(
  values: GlobalSettingMutation,
  metadata: GlobalConfigChangeMetadata = {},
  auditOnlySecretKeys: readonly string[] = [],
): Promise<ConfigRevisionSummary | null> {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string | null] => typeof entry[1] === 'string' || entry[1] === null,
  );
  if (entries.length === 0 && auditOnlySecretKeys.length === 0) return null;
  const masterKey = getMasterKey();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
    const existingRows =
      entries.length === 0
        ? []
        : await tx.setting.findMany({
            where: { scope: 'GLOBAL', userId: null, key: { in: entries.map(([key]) => key) } },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            select: { id: true, key: true, valueEnc: true },
          });
    const existingByKey = new Map<string, typeof existingRows>();
    for (const row of existingRows) {
      const rows = existingByKey.get(row.key) ?? [];
      rows.push(row);
      existingByKey.set(row.key, rows);
    }
    const changes = entries.flatMap(([key, nextValue]) => {
      const rows = existingByKey.get(key) ?? [];
      const existing = rows[0];
      const previousValue = existing ? decrypt(existing.valueEnc, masterKey) : null;
      if (previousValue === nextValue) return [];
      return [
        {
          key,
          existing,
          duplicateIds: rows.slice(1).map((row) => row.id),
          previousValue,
          nextValue,
          isSecret: isSecretGlobalSettingKey(key),
        },
      ];
    });
    const auditChanges = [
      ...changes,
      ...auditOnlySecretKeys.map((key) => ({
        key,
        existing: undefined,
        previousValue: null,
        nextValue: null,
        isSecret: true,
      })),
    ];
    if (auditChanges.length === 0) return null;

    for (const change of changes) {
      if (change.nextValue === null) {
        if (change.existing) {
          await tx.setting.deleteMany({
            where: { id: { in: [change.existing.id, ...change.duplicateIds] } },
          });
        }
      } else if (change.existing) {
        await tx.setting.update({
          where: { id: change.existing.id },
          data: { valueEnc: encrypt(change.nextValue, masterKey) },
        });
        if (change.duplicateIds.length > 0) {
          await tx.setting.deleteMany({ where: { id: { in: change.duplicateIds } } });
        }
      } else {
        await tx.setting.create({
          data: {
            scope: 'GLOBAL',
            userId: null,
            key: change.key,
            valueEnc: encrypt(change.nextValue, masterKey),
          },
        });
      }
    }

    const previous = await tx.configRevision.findFirst({
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const revision = await tx.configRevision.create({
      data: {
        number: (previous?.number ?? 0) + 1,
        ...(metadata.actorUserId ? { actorUserId: metadata.actorUserId } : {}),
        ...(metadata.reason?.trim() ? { reason: metadata.reason.trim().slice(0, 500) } : {}),
        changes: {
          create: auditChanges.map((change) => ({
            key: change.key,
            isSecret: change.isSecret,
            previousValue: change.isSecret ? null : change.previousValue,
            nextValue: change.isSecret ? null : change.nextValue,
          })),
        },
      },
      select: { id: true, number: true, createdAt: true },
    });
    return revision;
  });
}

export async function getCurrentConfigRevisionId(): Promise<string | null> {
  const revision = await db.configRevision.findFirst({
    orderBy: { number: 'desc' },
    select: { id: true },
  });
  return revision?.id ?? null;
}

export async function rollbackConfigRevision(
  number: number,
  metadata: GlobalConfigChangeMetadata,
): Promise<{ revision: ConfigRevisionSummary | null; skippedSecretKeys: string[] }> {
  const target = await db.configRevision.findUnique({
    where: { number },
    select: {
      isBaseline: true,
      changes: { select: { key: true, previousValue: true, isSecret: true } },
    },
  });
  if (!target) throw new Error('Revisão não encontrada.');
  if (target.isBaseline) throw new Error('A revisão-base não pode ser revertida.');
  const skippedSecretKeys = target.changes
    .filter((change) => change.isSecret)
    .map((change) => change.key);
  const values = Object.fromEntries(
    target.changes
      .filter((change) => !change.isSecret)
      .map((change) => [change.key, change.previousValue]),
  );
  return {
    revision: await applyGlobalSettings(values, metadata, skippedSecretKeys),
    skippedSecretKeys,
  };
}

export async function deleteSetting(
  key: GlobalSettingKey,
  metadata?: GlobalConfigChangeMetadata,
): Promise<void> {
  await deleteSettingByKey(key, metadata);
}

export async function deleteSettingByKey(
  key: string,
  metadata?: GlobalConfigChangeMetadata,
): Promise<void> {
  await applyGlobalSettings({ [key]: null }, metadata);
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

// ---------------------------------------------------------------------------
// Preferências por usuário (SettingScope.USER) — não-secrets de produto.
// ---------------------------------------------------------------------------

export async function getUserSetting(userId: string, key: string): Promise<string | null> {
  const row = await db.setting.findFirst({
    where: { scope: 'USER', userId, key },
    select: { valueEnc: true },
  });
  if (!row) return null;
  return decrypt(row.valueEnc, getMasterKey());
}

export async function setUserSetting(userId: string, key: string, value: string): Promise<void> {
  const valueEnc = encrypt(value, getMasterKey());
  await db.$transaction(async (tx) => {
    const existing = await tx.setting.findFirst({
      where: { scope: 'USER', userId, key },
      select: { id: true },
    });
    if (existing) {
      await tx.setting.update({ where: { id: existing.id }, data: { valueEnc } });
    } else {
      await tx.setting.create({ data: { scope: 'USER', userId, key, valueEnc } });
    }
  });
}
