// ============================================================================
// /api/account/ai — per-user AI provider keys and model roles (spec 220)
// ============================================================================
// GET    /ai                          status per provider, roles, catalog
// PUT    /ai/providers/:provider      { apiKey } → probe, save, status
// POST   /ai/providers/:provider/test re-probe the stored key
// DELETE /ai/providers/:provider      remove key, status and roles using it
// PUT    /ai/roles                    { fast?, standard?, vision?, stt? }
// Mounted under accountRoutes, whose middleware sets userId from the session.
// No response ever contains a stored key.
// ============================================================================

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { AI_CATALOG, AI_PROVIDERS, isAiProvider, type AiProvider } from '../lib/ai/catalog';
import {
  getModelRoles,
  listProviderStatuses,
  removeProviderKey,
  saveProviderKey,
  setModelRoles,
  testProviderKey,
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

const Assignment = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().min(1).max(120),
});

const RolesBody = z
  .object({
    fast: Assignment.nullish(),
    standard: Assignment.nullish(),
    vision: Assignment.nullish(),
    stt: Assignment.nullish(),
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
    const [providers, roles] = await Promise.all([
      listProviderStatuses(userId),
      getModelRoles(userId),
    ]);
    return c.json({ providers, roles, catalog: CATALOG });
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
          roles,
        },
        422,
      );
    }
    return c.json({ result: outcome.result, provider: outcome.status, roles });
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
    return c.json({ provider: status, roles: await getModelRoles(userId) });
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
    return c.json({ provider: providers.find((item) => item.provider === provider), roles });
  });

  routes.put('/ai/roles', async (c) => {
    const parsed = RolesBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Dados inválidos.', code: 'INVALID_ROLES' }, 400);
    }
    const limited = await limitWrites(c);
    if (limited) return limited;
    const roles = Object.fromEntries(
      Object.entries(parsed.data).filter(([, assignment]) => assignment != null),
    );
    const result = await setModelRoles(c.get('userId'), roles);
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
    return c.json({ roles: result.roles });
  });
}
