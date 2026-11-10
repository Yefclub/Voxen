// ============================================================================
// Per-user AI provider credentials, model chains and reasoning (spec 220/221)
// ============================================================================
// Storage (Setting, scope USER, encrypted with MASTER_KEY):
//   ai_provider_key:<provider>   the API key — never leaves the server
//   ai_provider_meta:<provider>  { last4, status, validatedAt, error }
//   ai_model_chains              { chains: { fast?, standard?, vision?, stt? } →
//                                  ordered [{provider, model}, …], first = primary,
//                                  reasoning: { fast, standard, vision } →
//                                  'off' | 'low' | 'medium' | 'high' } (spec 221)
//   ai_model_roles               legacy spec 220 { role → {provider, model} }: read
//                                as one-entry chains while ai_model_chains is
//                                absent, never rewritten (a downgrade keeps it)
// Every function takes the userId from the caller, which must derive it from
// the session. Nothing here returns a stored key except `getProviderKey`,
// which only the server-side AI client may use.
// ============================================================================

import { z } from 'zod';
import { db } from '../db';
import {
  deleteUserSettings,
  getUserSetting,
  getUserSettings,
  setUserSetting,
  type UserSettingKey,
} from '../settings';
import {
  AI_PROVIDERS,
  AI_ROLES,
  AI_TEXT_ROLES,
  DEFAULT_REASONING_EFFORT,
  modelServesRole,
  providerDefaults,
  REASONING_EFFORTS,
  type AiProvider,
  type AiRole,
  type AiTextRole,
  type ReasoningEffort,
} from './catalog';
import type { ProbeProviderKey, ProbeStatus } from './probe';

export interface ProviderMeta {
  last4: string;
  status: ProbeStatus;
  validatedAt: string | null;
  error: string | null;
}

export interface ProviderStatus {
  provider: AiProvider;
  configured: boolean;
  last4: string | null;
  status: ProbeStatus | null;
  validatedAt: string | null;
  error: string | null;
}

export interface RoleEntry {
  provider: AiProvider;
  model: string;
}

/** Ordered fallback chain per role; the first entry is the primary. */
export type ModelRoles = Partial<Record<AiRole, RoleEntry[]>>;

/** Longest chain a role may hold. */
export const MAX_CHAIN_LENGTH = 4;

const keySetting = (provider: AiProvider): UserSettingKey => `ai_provider_key:${provider}`;
const metaSetting = (provider: AiProvider): UserSettingKey => `ai_provider_meta:${provider}`;
const CHAINS_SETTING: UserSettingKey = 'ai_model_chains';
const LEGACY_ROLES_SETTING: UserSettingKey = 'ai_model_roles';

const MetaSchema = z.object({
  last4: z.string().max(4),
  status: z.enum(['valid', 'invalid', 'unknown']),
  validatedAt: z.string().nullable(),
  error: z.string().max(100).nullable(),
});

const EntrySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1).max(120),
});

function parseMeta(raw: string | null): ProviderMeta | null {
  if (!raw) return null;
  try {
    const parsed = MetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const sameEntry = (a: RoleEntry, b: RoleEntry) => a.provider === b.provider && a.model === b.model;

export type RoleReasoning = Record<AiTextRole, ReasoningEffort>;

export interface ModelSettings {
  chains: ModelRoles;
  reasoning: RoleReasoning;
}

const defaultReasoning = (): RoleReasoning => ({
  fast: DEFAULT_REASONING_EFFORT,
  standard: DEFAULT_REASONING_EFFORT,
  vision: DEFAULT_REASONING_EFFORT,
});

const EffortSchema = z.enum(REASONING_EFFORTS);

/**
 * Parses stored settings. The spec 221 shape is `{ chains, reasoning }`; a
 * bare role map (the legacy spec 220 `ai_model_roles` value, one entry per
 * role) is read as chains with the default reasoning effort.
 */
export function parseModelSettings(raw: string | null): ModelSettings {
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const hasChains = 'chains' in record;
  const reasoning = defaultReasoning();
  const storedReasoning = hasChains ? record.reasoning : undefined;
  for (const role of AI_TEXT_ROLES) {
    const parsed = EffortSchema.safeParse(
      typeof storedReasoning === 'object' && storedReasoning !== null
        ? (storedReasoning as Record<string, unknown>)[role]
        : undefined,
    );
    if (parsed.success) reasoning[role] = parsed.data;
  }
  return { chains: parseChains(hasChains ? record.chains : record), reasoning };
}

export function parseModelRoles(raw: string | null): ModelRoles {
  return parseModelSettings(raw).chains;
}

/**
 * Parses role chains, dropping entries that no longer match the catalog,
 * duplicates and anything past the chain limit. A single object per role
 * (spec 220) is read as a one-entry chain.
 */
function parseChains(value: unknown): ModelRoles {
  if (typeof value !== 'object' || value === null) return {};
  const roles: ModelRoles = {};
  for (const role of AI_ROLES) {
    const stored = (value as Record<string, unknown>)[role];
    const candidates = Array.isArray(stored) ? stored : stored == null ? [] : [stored];
    const chain: RoleEntry[] = [];
    for (const candidate of candidates) {
      const parsed = EntrySchema.safeParse(candidate);
      if (!parsed.success || !modelServesRole(parsed.data.provider, parsed.data.model, role)) {
        continue;
      }
      const entry = { provider: parsed.data.provider, model: parsed.data.model };
      if (chain.length < MAX_CHAIN_LENGTH && !chain.some((item) => sameEntry(item, entry))) {
        chain.push(entry);
      }
    }
    if (chain.length > 0) roles[role] = chain;
  }
  return roles;
}

export function last4Of(apiKey: string): string {
  return apiKey.slice(-4);
}

/** Providers that currently have a stored key, without decrypting any key. */
export async function listConfiguredProviders(userId: string): Promise<Set<AiProvider>> {
  const rows = await db.setting.findMany({
    where: { scope: 'USER', userId, key: { in: AI_PROVIDERS.map(keySetting) } },
    select: { key: true },
  });
  return new Set(
    AI_PROVIDERS.filter((provider) => rows.some((row) => row.key === keySetting(provider))),
  );
}

export async function listProviderStatuses(userId: string): Promise<ProviderStatus[]> {
  const [configured, metas] = await Promise.all([
    listConfiguredProviders(userId),
    getUserSettings(userId, AI_PROVIDERS.map(metaSetting)),
  ]);
  const metaValues = metas as Record<string, string | null>;
  return AI_PROVIDERS.map((provider) => {
    const isConfigured = configured.has(provider);
    const meta = isConfigured ? parseMeta(metaValues[metaSetting(provider)] ?? null) : null;
    return {
      provider,
      configured: isConfigured,
      last4: meta?.last4 ?? null,
      status: isConfigured ? (meta?.status ?? 'unknown') : null,
      validatedAt: meta?.validatedAt ?? null,
      error: meta?.error ?? null,
    };
  });
}

export async function getProviderStatus(
  userId: string,
  provider: AiProvider,
): Promise<ProviderStatus> {
  const statuses = await listProviderStatuses(userId);
  return statuses.find((status) => status.provider === provider)!;
}

/** Server-only: decrypts the stored key for the AI client. Never serialize it. */
export async function getProviderKey(userId: string, provider: AiProvider): Promise<string | null> {
  return getUserSetting(userId, keySetting(provider));
}

export async function getModelSettings(userId: string): Promise<ModelSettings> {
  const stored = await getUserSetting(userId, CHAINS_SETTING);
  if (stored !== null) return parseModelSettings(stored);
  return parseModelSettings(await getUserSetting(userId, LEGACY_ROLES_SETTING));
}

export async function getModelRoles(userId: string): Promise<ModelRoles> {
  return (await getModelSettings(userId)).chains;
}

export async function getRoleReasoning(userId: string): Promise<RoleReasoning> {
  return (await getModelSettings(userId)).reasoning;
}

/** Always writes `ai_model_chains`, even when empty, so the legacy value stays shadowed. */
async function writeModelSettings(userId: string, settings: ModelSettings): Promise<void> {
  await setUserSetting(userId, CHAINS_SETTING, JSON.stringify(settings));
}

/**
 * Gives every empty chain the provider's catalog default. Non-empty chains
 * are never touched: adding a provider to an existing chain is the user's
 * choice, so captured content never reaches a new provider (such as a free
 * tier) unasked.
 */
async function assignDefaultRoles(userId: string, provider: AiProvider): Promise<void> {
  const settings = await getModelSettings(userId);
  const roles = settings.chains;
  const defaults = providerDefaults(provider);
  let changed = false;
  for (const role of AI_ROLES) {
    const model = defaults[role];
    if (!model || (roles[role]?.length ?? 0) > 0) continue;
    roles[role] = [{ provider, model }];
    changed = true;
  }
  if (changed) await writeModelSettings(userId, settings);
}

async function previousStatus(userId: string, provider: AiProvider): Promise<ProbeStatus | null> {
  return parseMeta(await getUserSetting(userId, metaSetting(provider)))?.status ?? null;
}

async function writeMeta(
  userId: string,
  provider: AiProvider,
  apiKey: string,
  result: { status: ProbeStatus; error: string | null },
): Promise<void> {
  const meta: ProviderMeta = {
    last4: last4Of(apiKey),
    status: result.status,
    validatedAt: new Date().toISOString(),
    error: result.error,
  };
  await setUserSetting(userId, metaSetting(provider), JSON.stringify(meta));
}

export type SaveKeyOutcome = { saved: boolean; result: ProbeStatus; status: ProviderStatus };

/**
 * Probes and stores a key. A key the provider rejects (401/403) is not stored;
 * an inconclusive probe (network, 5xx) stores it with status `unknown`.
 */
export async function saveProviderKey(
  userId: string,
  provider: AiProvider,
  apiKey: string,
  probe: ProbeProviderKey,
): Promise<SaveKeyOutcome> {
  const result = await probe(provider, apiKey);
  const before = await previousStatus(userId, provider);
  if (result.status === 'invalid') {
    return {
      saved: false,
      result: result.status,
      status: await getProviderStatus(userId, provider),
    };
  }
  await setUserSetting(userId, keySetting(provider), apiKey);
  await writeMeta(userId, provider, apiKey, result);
  // Defaults fill empty chains only when the provider first becomes valid, so
  // a re-test or key rotation never re-adds an entry the user removed.
  if (result.status === 'valid' && before !== 'valid') await assignDefaultRoles(userId, provider);
  return { saved: true, result: result.status, status: await getProviderStatus(userId, provider) };
}

/** Re-probes the stored key; null when the provider has no key. */
export async function testProviderKey(
  userId: string,
  provider: AiProvider,
  probe: ProbeProviderKey,
): Promise<ProviderStatus | null> {
  const apiKey = await getProviderKey(userId, provider);
  if (!apiKey) return null;
  const before = await previousStatus(userId, provider);
  const result = await probe(provider, apiKey);
  await writeMeta(userId, provider, apiKey, result);
  if (result.status === 'valid' && before !== 'valid') await assignDefaultRoles(userId, provider);
  return getProviderStatus(userId, provider);
}

/** Deletes the key and its status, and removes the provider from every chain. */
export async function removeProviderKey(userId: string, provider: AiProvider): Promise<void> {
  await deleteUserSettings(userId, [keySetting(provider), metaSetting(provider)]);
  const settings = await getModelSettings(userId);
  const roles = settings.chains;
  let changed = false;
  for (const role of AI_ROLES) {
    const chain = roles[role];
    if (!chain?.some((entry) => entry.provider === provider)) continue;
    const kept = chain.filter((entry) => entry.provider !== provider);
    if (kept.length > 0) roles[role] = kept;
    else delete roles[role];
    changed = true;
  }
  if (changed) await writeModelSettings(userId, settings);
}

export type RoleValidationError = {
  role: AiRole;
  /** Position in the submitted chain; null for chain-level errors. */
  index: number | null;
  reason: 'UNKNOWN_MODEL' | 'PROVIDER_NOT_CONFIGURED' | 'DUPLICATE_ENTRY' | 'CHAIN_TOO_LONG';
};

/**
 * Validates and stores every role chain (absent or empty roles are cleared)
 * and, when given, the reasoning effort of text roles (others keep theirs).
 */
export async function setModelRoles(
  userId: string,
  roles: Partial<Record<AiRole, readonly RoleEntry[]>>,
  reasoning: Partial<RoleReasoning> = {},
): Promise<{ ok: true; settings: ModelSettings } | { ok: false; errors: RoleValidationError[] }> {
  const [configured, current] = await Promise.all([
    listConfiguredProviders(userId),
    getModelSettings(userId),
  ]);
  const errors: RoleValidationError[] = [];
  const next: ModelRoles = {};
  for (const role of AI_ROLES) {
    const chain = roles[role] ?? [];
    if (chain.length > MAX_CHAIN_LENGTH) {
      errors.push({ role, index: null, reason: 'CHAIN_TOO_LONG' });
      continue;
    }
    const accepted: RoleEntry[] = [];
    chain.forEach((entry, index) => {
      if (!modelServesRole(entry.provider, entry.model, role)) {
        errors.push({ role, index, reason: 'UNKNOWN_MODEL' });
      } else if (!configured.has(entry.provider)) {
        errors.push({ role, index, reason: 'PROVIDER_NOT_CONFIGURED' });
      } else if (accepted.some((item) => sameEntry(item, entry))) {
        errors.push({ role, index, reason: 'DUPLICATE_ENTRY' });
      } else {
        accepted.push({ provider: entry.provider, model: entry.model });
      }
    });
    if (accepted.length > 0) next[role] = accepted;
  }
  if (errors.length > 0) return { ok: false, errors };
  const settings: ModelSettings = {
    chains: next,
    reasoning: { ...current.reasoning, ...reasoning },
  };
  await writeModelSettings(userId, settings);
  return { ok: true, settings };
}
