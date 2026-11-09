// ============================================================================
// Per-user AI provider credentials and model roles (spec 220)
// ============================================================================
// Storage (Setting, scope USER, encrypted with MASTER_KEY):
//   ai_provider_key:<provider>   the API key — never leaves the server
//   ai_provider_meta:<provider>  { last4, status, validatedAt, error }
//   ai_model_roles               { fast?, standard?, vision?, stt? } → {provider, model}
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
  modelServesRole,
  providerDefaults,
  type AiProvider,
  type AiRole,
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

export interface RoleAssignment {
  provider: AiProvider;
  model: string;
}

export type ModelRoles = Partial<Record<AiRole, RoleAssignment>>;

const keySetting = (provider: AiProvider): UserSettingKey => `ai_provider_key:${provider}`;
const metaSetting = (provider: AiProvider): UserSettingKey => `ai_provider_meta:${provider}`;
const ROLES_SETTING: UserSettingKey = 'ai_model_roles';

const MetaSchema = z.object({
  last4: z.string().max(4),
  status: z.enum(['valid', 'invalid', 'unknown']),
  validatedAt: z.string().nullable(),
  error: z.string().max(100).nullable(),
});

const AssignmentSchema = z.object({
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

/** Parses stored roles, dropping entries that no longer match the catalog. */
export function parseModelRoles(raw: string | null): ModelRoles {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null) return {};
  const roles: ModelRoles = {};
  for (const role of AI_ROLES) {
    const parsed = AssignmentSchema.safeParse((value as Record<string, unknown>)[role]);
    if (parsed.success && modelServesRole(parsed.data.provider, parsed.data.model, role)) {
      roles[role] = parsed.data;
    }
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

export async function getModelRoles(userId: string): Promise<ModelRoles> {
  return parseModelRoles(await getUserSetting(userId, ROLES_SETTING));
}

async function writeModelRoles(userId: string, roles: ModelRoles): Promise<void> {
  if (Object.keys(roles).length === 0) {
    await deleteUserSettings(userId, [ROLES_SETTING]);
    return;
  }
  await setUserSetting(userId, ROLES_SETTING, JSON.stringify(roles));
}

/** Fills roles that have no assignment with the provider's catalog defaults. */
async function assignDefaultRoles(userId: string, provider: AiProvider): Promise<void> {
  const roles = await getModelRoles(userId);
  const defaults = providerDefaults(provider);
  let changed = false;
  for (const role of AI_ROLES) {
    const model = defaults[role];
    if (!roles[role] && model) {
      roles[role] = { provider, model };
      changed = true;
    }
  }
  if (changed) await writeModelRoles(userId, roles);
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
  if (result.status === 'invalid') {
    return {
      saved: false,
      result: result.status,
      status: await getProviderStatus(userId, provider),
    };
  }
  await setUserSetting(userId, keySetting(provider), apiKey);
  await writeMeta(userId, provider, apiKey, result);
  if (result.status === 'valid') await assignDefaultRoles(userId, provider);
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
  const result = await probe(provider, apiKey);
  await writeMeta(userId, provider, apiKey, result);
  if (result.status === 'valid') await assignDefaultRoles(userId, provider);
  return getProviderStatus(userId, provider);
}

/** Deletes the key and its status, and clears every role that used it. */
export async function removeProviderKey(userId: string, provider: AiProvider): Promise<void> {
  await deleteUserSettings(userId, [keySetting(provider), metaSetting(provider)]);
  const roles = await getModelRoles(userId);
  let changed = false;
  for (const role of AI_ROLES) {
    if (roles[role]?.provider === provider) {
      delete roles[role];
      changed = true;
    }
  }
  if (changed) await writeModelRoles(userId, roles);
}

export type RoleValidationError = {
  role: AiRole;
  reason: 'UNKNOWN_MODEL' | 'PROVIDER_NOT_CONFIGURED';
};

/** Validates and stores a complete role assignment (absent roles are cleared). */
export async function setModelRoles(
  userId: string,
  roles: ModelRoles,
): Promise<{ ok: true; roles: ModelRoles } | { ok: false; errors: RoleValidationError[] }> {
  const configured = await listConfiguredProviders(userId);
  const errors: RoleValidationError[] = [];
  const next: ModelRoles = {};
  for (const role of AI_ROLES) {
    const assignment = roles[role];
    if (!assignment) continue;
    if (!modelServesRole(assignment.provider, assignment.model, role)) {
      errors.push({ role, reason: 'UNKNOWN_MODEL' });
    } else if (!configured.has(assignment.provider)) {
      errors.push({ role, reason: 'PROVIDER_NOT_CONFIGURED' });
    } else {
      next[role] = { provider: assignment.provider, model: assignment.model };
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  await writeModelRoles(userId, next);
  return { ok: true, roles: next };
}
