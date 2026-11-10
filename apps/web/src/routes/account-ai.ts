// ============================================================================
// /api/account/ai — per-user AI provider keys and model chains (spec 220/221)
// ============================================================================
// GET    /ai                          status per provider, chains, catalog
// PUT    /ai/providers/:provider      { apiKey } → probe, save, status
// POST   /ai/providers/:provider/test re-probe the stored key
// DELETE /ai/providers/:provider      remove key, status and its chain entries
// PUT    /ai/roles                    { fast?, standard?, vision?, stt?, reasoning? }:
//                                     each role an ordered chain [{provider, model}, …]
//                                     (max 4) or, as in spec 220, a single entry;
//                                     reasoning { fast?, standard?, vision? } →
//                                     'off' | 'low' | 'medium' | 'high'
// Mounted under accountRoutes, whose middleware sets userId from the session.
// No response ever contains a stored key.
// ============================================================================

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  AI_CATALOG,
  AI_PROVIDERS,
  AI_ROLES,
  isAiProvider,
  REASONING_EFFORTS,
  type AiProvider,
  type AiRole,
} from '../lib/ai/catalog';
import {
  getModelRoles,
  getModelSettings,
  MAX_CHAIN_LENGTH,
  listProviderStatuses,
  removeProviderKey,
  saveProviderKey,
  setModelRoles,
  testProviderKey,
  type RoleEntry,
} from '../lib/ai/credentials';
import { probeProviderKey, type ProbeProviderKey } from '../lib/ai/probe';
import { rateLimit } from '../lib/rate-limit';

type Vars = { userId: string };

const ApiKeyBody = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(300)
    // Printable ASCII without spaces: keys are sent as HTTP header values.
    .regex(/^[\x21-\x7E]+$/),
});

const Entry = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1).max(120),
  })
  .strict();

// A chain, or the spec 220 single entry (read as a one-entry chain).
const Chain = z
  .union([z.array(Entry).max(16), Entry])
  .nullish()
  .transform((value): RoleEntry[] => (value == null ? [] : Array.isArray(value) ? value : [value]));

const Effort = z.enum(REASONING_EFFORTS).optional();

const RolesBody = z
  .object({
    fast: Chain,
    standard: Chain,
    vision: Chain,
    stt: Chain,
    // Speech-to-text has no reasoning, so `stt` is not accepted here.
    reasoning: z.object({ fast: Effort, standard: Effort, vision: Effort }).strict().optional(),
  })
  .strict();

const CATALOG = AI_PROVIDERS.map((provider) => AI_CATALOG[provider]);

export interface AccountAiRouteDependencies {
  probe?: ProbeProviderKey;
}

export function registerAccountAiRoutes(
  routes: Hono<{ Variables: Vars }>,
  dependencies: AccountAiRouteDependencies = {},
): void {
  const probe = dependencies.probe ?? probeProviderKey;

  async function limitWrites(c: Context<{ Variables: Vars }>): Promise<Response | null> {
    const rl = await rateLimit(`voxen:rl:ai-providers:${c.get('userId')}`, 20, 60);
    if (rl.allowed) return null;
    return c.json(
      {
        error: 'Muitas tentativas. Aguarde alguns segundos.',
        code: 'RATE_LIMITED',
        retryInSec: rl.resetIn,
      },
      429,
    );
  }

  function providerParam(c: Context<{ Variables: Vars }>): AiProvider | null {
    const value = c.req.param('provider') ?? '';
    return isAiProvider(value) ? value : null;
  }

  const invalidProvider = (c: Context<{ Variables: Vars }>) =>
    c.json({ error: 'Provedor desconhecido.', code: 'INVALID_PROVIDER' }, 400);

  routes.get('/ai', async (c) => {
    const userId = c.get('userId');
    const [providers, settings] = await Promise.all([
      listProviderStatuses(userId),
      getModelSettings(userId),
    ]);
    return c.json({
      providers,
      chains: settings.chains,
      reasoning: settings.reasoning,
      catalog: CATALOG,
    });
  });

  routes.put('/ai/providers/:provider', async (c) => {
    const provider = providerParam(c);
    if (!provider) return invalidProvider(c);
    const parsed = ApiKeyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Chave inválida (20 a 300 caracteres).', code: 'INVALID_KEY' }, 400);
    }
    const limited = await limitWrites(c);
    if (limited) return limited;
    const userId = c.get('userId');
    const outcome = await saveProviderKey(userId, provider, parsed.data.apiKey, probe);
    const roles = await getModelRoles(userId);
    if (!outcome.saved) {
      return c.json(
        {
          error: 'O provedor recusou a chave.',
          code: 'LLM_AUTH',
          result: outcome.result,
          provider: outcome.status,
          chains: roles,
        },
        422,
      );
    }
    return c.json({ result: outcome.result, provider: outcome.status, chains: roles });
  });

  routes.post('/ai/providers/:provider/test', async (c) => {
    const provider = providerParam(c);
    if (!provider) return invalidProvider(c);
    const limited = await limitWrites(c);
    if (limited) return limited;
    const userId = c.get('userId');
    const status = await testProviderKey(userId, provider, probe);
    if (!status) {
      return c.json({ error: 'Nenhuma chave salva para este provedor.', code: 'NOT_FOUND' }, 404);
    }
    return c.json({ provider: status, chains: await getModelRoles(userId) });
  });

  routes.delete('/ai/providers/:provider', async (c) => {
    const provider = providerParam(c);
    if (!provider) return invalidProvider(c);
    const limited = await limitWrites(c);
    if (limited) return limited;
    const userId = c.get('userId');
    await removeProviderKey(userId, provider);
    const [providers, roles] = await Promise.all([
      listProviderStatuses(userId),
      getModelRoles(userId),
    ]);
    return c.json({
      provider: providers.find((item) => item.provider === provider),
      chains: roles,
    });
  });

  routes.put('/ai/roles', async (c) => {
    const parsed = RolesBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Dados inválidos.', code: 'INVALID_ROLES' }, 400);
    }
    const limited = await limitWrites(c);
    if (limited) return limited;
    const chains: Partial<Record<AiRole, RoleEntry[]>> = {};
    for (const role of AI_ROLES) chains[role] = parsed.data[role];
    const reasoning = Object.fromEntries(
      Object.entries(parsed.data.reasoning ?? {}).filter(([, effort]) => effort !== undefined),
    );
    const result = await setModelRoles(c.get('userId'), chains, reasoning);
    if (!result.ok) {
      return c.json(
        {
          error: 'Modelo ou provedor inválido para o papel.',
          code: 'INVALID_ROLES',
          details: result.errors,
        },
        400,
      );
    }
    return c.json({ chains: result.settings.chains, reasoning: result.settings.reasoning });
  });
}
