import { createHmac } from 'node:crypto';
import { db } from '../db';
import { acquireUserMemoryShadowDeletionFence } from './memory-shadow-coordinator';

export const MEMORY_SHADOW_ALGORITHM_VERSION = 'voxen-mem0-oss-shadow-v1';

const MAX_MESSAGE_CHARS = 8_000;
const MAX_QUERY_CHARS = 2_000;
const MAX_RESULTS = 20;
const DEFAULT_TIMEOUT_MS = 5_000;

type MemoryEnvironment = Readonly<Record<string, string | undefined>>;

export interface CompletedMemoryTurn {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  userContent: string;
  assistantContent: string;
  completedAt: Date;
}

export interface MemorySearchInput {
  userId: string;
  query: string;
  limit: number;
}

export interface MemoryCandidate {
  id: string;
  content: string;
  score: number | null;
  trust: 'unverified';
  provenance: {
    conversationId: string | null;
    userMessageId: string | null;
    assistantMessageId: string | null;
    algorithmVersion: string | null;
  };
  scoreDetails: unknown;
}

export interface MemoryProvider {
  readonly kind: 'disabled' | 'mem0-shadow';
  addCompletedTurn(turn: CompletedMemoryTurn): Promise<void>;
  search(input: MemorySearchInput): Promise<MemoryCandidate[]>;
  deleteUser(userId: string): Promise<void>;
}

export type MemoryProviderConfig =
  | { kind: 'disabled' }
  | {
      kind: 'mem0-shadow';
      baseUrl: string;
      apiKey: string;
      scopeSecret: string;
      deploymentVersion: string;
      extractionModel: string;
      retentionDays: number;
      timeoutMs: number;
    };

export interface MemoryScopeStore {
  pin(fingerprint: string): Promise<void>;
}

interface MemoryProviderDependencies {
  env?: MemoryEnvironment;
  fetchImpl?: typeof fetch;
  scopeStore?: MemoryScopeStore;
}

const SCOPE_CONFIG_ID = 'mem0-shadow-v1';

const prismaMemoryScopeStore: MemoryScopeStore = {
  async pin(fingerprint) {
    await db.memoryShadowConfig.createMany({
      data: [{ id: SCOPE_CONFIG_ID, scopeFingerprint: fingerprint }],
      skipDuplicates: true,
    });
    const pinned = await db.memoryShadowConfig.findUnique({ where: { id: SCOPE_CONFIG_ID } });
    if (!pinned || pinned.scopeFingerprint !== fingerprint) {
      throw new Error(
        'MEM0_SCOPE_SECRET does not match the immutable namespace fingerprint; restore the original secret',
      );
    }
  },
};

function required(env: MemoryEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for mem0-shadow`);
  return value;
}

function parseTimeout(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 250 || value > 30_000) {
    throw new Error('MEM0_REQUEST_TIMEOUT_MS must be an integer between 250 and 30000');
  }
  return value;
}

function parseRetentionDays(raw: string | undefined): number {
  const value = raw?.trim() ? Number(raw) : 30;
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    throw new Error('MEM0_RETENTION_DAYS must be an integer between 1 and 365');
  }
  return value;
}

function normalizeBaseUrl(raw: string, allowInsecureHttp: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MEM0_BASE_URL must be a valid URL');
  }
  if (url.username || url.password) throw new Error('MEM0_BASE_URL must not contain credentials');
  if (url.search || url.hash) throw new Error('MEM0_BASE_URL must not contain query or fragment');
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('MEM0_BASE_URL must be an origin without a path');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowInsecureHttp)) {
    throw new Error(
      'MEM0_BASE_URL must use HTTPS; set MEM0_ALLOW_INSECURE_HTTP=true only on a private network',
    );
  }
  return url.origin;
}

export function resolveMemoryProviderConfig(
  env: MemoryEnvironment = process.env,
): MemoryProviderConfig {
  const provider = env.VOXEN_MEMORY_PROVIDER?.trim().toLowerCase() || 'disabled';
  if (provider === 'disabled') return { kind: 'disabled' };
  if (provider !== 'mem0-shadow') {
    throw new Error('VOXEN_MEMORY_PROVIDER must be disabled or mem0-shadow');
  }
  const scopeSecret = required(env, 'MEM0_SCOPE_SECRET');
  if (scopeSecret.length < 32)
    throw new Error('MEM0_SCOPE_SECRET must contain at least 32 characters');
  return {
    kind: 'mem0-shadow',
    baseUrl: normalizeBaseUrl(
      required(env, 'MEM0_BASE_URL'),
      env.MEM0_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === 'true',
    ),
    apiKey: required(env, 'MEM0_API_KEY'),
    scopeSecret,
    deploymentVersion: required(env, 'MEM0_DEPLOYMENT_VERSION'),
    extractionModel: required(env, 'MEM0_EXTRACTION_MODEL'),
    retentionDays: parseRetentionDays(env.MEM0_RETENTION_DAYS),
    timeoutMs: parseTimeout(env.MEM0_REQUEST_TIMEOUT_MS),
  };
}

export function memoryShadowWriteEnabled(env: MemoryEnvironment = process.env): boolean {
  return env.VOXEN_MEMORY_PROVIDER?.trim().toLowerCase() === 'mem0-shadow';
}

export function opaqueMemorySubject(userId: string, scopeSecret: string): string {
  if (!userId) throw new Error('Authenticated Voxen userId is required');
  return `voxen_${createHmac('sha256', scopeSecret).update(userId, 'utf8').digest('hex')}`;
}

class DisabledMemoryProvider implements MemoryProvider {
  readonly kind = 'disabled' as const;

  async addCompletedTurn(_turn: CompletedMemoryTurn): Promise<void> {}

  async search(_input: MemorySearchInput): Promise<MemoryCandidate[]> {
    return [];
  }

  async deleteUser(_userId: string): Promise<void> {}
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function parseCandidates(payload: unknown): MemoryCandidate[] {
  const root = asRecord(payload);
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.results)
      ? root.results
      : Array.isArray(root?.memories)
        ? root.memories
        : [];
  return raw.slice(0, MAX_RESULTS).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const content =
      typeof record.memory === 'string'
        ? record.memory
        : typeof record.content === 'string'
          ? record.content
          : null;
    if (!content) return [];
    // Current server serializers return `metadata`; some vector-store search
    // adapters flatten custom payload keys. Support both without trusting them
    // as scope (scope is always imposed in the request).
    const metadata = asRecord(record.metadata) ?? record;
    return [
      {
        id: typeof record.id === 'string' ? record.id : '',
        content: content.slice(0, MAX_MESSAGE_CHARS),
        score:
          typeof record.score === 'number' && Number.isFinite(record.score) ? record.score : null,
        trust: 'unverified' as const,
        provenance: {
          conversationId: optionalString(metadata, 'conversationId'),
          userMessageId: optionalString(metadata, 'userMessageId'),
          assistantMessageId: optionalString(metadata, 'assistantMessageId'),
          algorithmVersion: optionalString(metadata, 'algorithmVersion'),
        },
        scoreDetails: record.score_details ?? null,
      },
    ];
  });
}

class Mem0ShadowProvider implements MemoryProvider {
  readonly kind = 'mem0-shadow' as const;

  constructor(
    private readonly config: Extract<MemoryProviderConfig, { kind: 'mem0-shadow' }>,
    private readonly fetchImpl: typeof fetch,
    private readonly scopeStore: MemoryScopeStore,
  ) {}

  private async assertScopeIdentity(): Promise<void> {
    const fingerprint = createHmac('sha256', this.config.scopeSecret)
      .update('voxen-memory-scope-v1', 'utf8')
      .digest('hex');
    await this.scopeStore.pin(fingerprint);
  }

  private subject(userId: string): string {
    return opaqueMemorySubject(userId, this.config.scopeSecret);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Voxen-Mem0-shadow-evaluation',
        'X-API-Key': this.config.apiKey,
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) throw new Error(`Mem0 OSS request failed with status ${response.status}`);
    return response;
  }

  async addCompletedTurn(turn: CompletedMemoryTurn): Promise<void> {
    await this.assertScopeIdentity();
    const expiresAt = new Date(turn.completedAt);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + this.config.retentionDays);
    const metadata = {
      conversationId: turn.conversationId,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      algorithmVersion: MEMORY_SHADOW_ALGORITHM_VERSION,
      mem0DeploymentVersion: this.config.deploymentVersion,
      extractionModel: this.config.extractionModel,
      completedAt: turn.completedAt.toISOString(),
      trust: 'unverified-conversational-memory',
    };
    await this.request('/memories', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: turn.userContent.slice(0, MAX_MESSAGE_CHARS) },
          { role: 'assistant', content: turn.assistantContent.slice(0, MAX_MESSAGE_CHARS) },
        ],
        user_id: this.subject(turn.userId),
        metadata,
        expiration_date: expiresAt.toISOString().slice(0, 10),
      }),
    });
  }

  async search(input: MemorySearchInput): Promise<MemoryCandidate[]> {
    await this.assertScopeIdentity();
    const query = input.query.trim().slice(0, MAX_QUERY_CHARS);
    if (!query) return [];
    const response = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        filters: { user_id: this.subject(input.userId) },
        explain: true,
        top_k: Math.max(1, Math.min(MAX_RESULTS, Math.trunc(input.limit) || 1)),
      }),
    });
    return parseCandidates(await response.json());
  }

  async deleteUser(userId: string): Promise<void> {
    await this.assertScopeIdentity();
    const subject = encodeURIComponent(this.subject(userId));
    await this.request(`/memories?user_id=${subject}`, { method: 'DELETE' });
  }
}

export function createMemoryProvider(
  dependencies: MemoryProviderDependencies = {},
): MemoryProvider {
  const config = resolveMemoryProviderConfig(dependencies.env ?? process.env);
  if (config.kind === 'disabled') return new DisabledMemoryProvider();
  return new Mem0ShadowProvider(
    config,
    dependencies.fetchImpl ?? fetch,
    dependencies.scopeStore ?? prismaMemoryScopeStore,
  );
}

function diagnosticReason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error) {
    const status = error.message.match(/status (\d{3})/)?.[1];
    if (status) return `http-${status}`;
    if (error.message.includes('required') || error.message.includes('must'))
      return 'configuration';
  }
  return 'unavailable';
}

export async function recordCompletedTurnInMemoryShadow(
  turn: CompletedMemoryTurn,
  dependencies: MemoryProviderDependencies = {},
): Promise<{ status: 'disabled' | 'written' | 'failed' }> {
  try {
    const provider = createMemoryProvider(dependencies);
    if (provider.kind === 'disabled') return { status: 'disabled' };
    await provider.addCompletedTurn(turn);
    return { status: 'written' };
  } catch (error) {
    console.warn('[memory-shadow] completed-turn write failed', {
      reason: diagnosticReason(error),
    });
    return { status: 'failed' };
  }
}

export async function deleteUserMemoryShadow(
  userId: string,
  dependencies: MemoryProviderDependencies = {},
): Promise<void> {
  const provider = createMemoryProvider(dependencies);
  await provider.deleteUser(userId);
}

export async function beginUserMemoryShadowDeletion(
  userId: string,
  dependencies: MemoryProviderDependencies = {},
): Promise<(canonicalDeleted: boolean) => Promise<void>> {
  const config = resolveMemoryProviderConfig(dependencies.env ?? process.env);
  if (config.kind === 'disabled') return async () => {};
  return acquireUserMemoryShadowDeletionFence(userId, () =>
    deleteUserMemoryShadow(userId, dependencies),
  );
}
