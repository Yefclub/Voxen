// ============================================================================
// Provider-agnostic AI client (spec 220, fallback chains by spec 221)
// ============================================================================
// Resolves the user's ordered chain of models for a role, then calls each
// entry through an explicit AI SDK provider object with a fixed base URL until
// one answers. Never pass a plain string model id to AI SDK functions: that
// routes through the AI gateway. No tools are ever attached; captured content
// is wrapped as untrusted data.
// ============================================================================

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type ModelMessage,
  type TranscriptionModel,
} from 'ai';
import type { ZodType } from 'zod';
import {
  callOptions,
  effectiveMaxOutputTokens,
  UNTRUSTED_CONTENT_NOTICE,
  untrustedContent,
} from './call-options';
import type { UntrustedPart } from './call-options';
import {
  estimateSttCostUsd,
  estimateTextCostUsd,
  findCatalogModel,
  type AiProvider,
  type AiRole,
  type CatalogModel,
  type LocalProvider,
  type ReasoningEffort,
} from './catalog';
import {
  getModelRoles,
  getProviderKey,
  getRoleReasoning,
  type ModelRoles,
  type RoleReasoning,
} from './credentials';
import { AiError, AiNotConfiguredError } from './errors';
import { toAiError } from './error-mapping';
import { isWavChunk, transcribeWithLocal } from './local-stt';
import { localSttEndpoint } from './local-stt-availability';
import {
  providerTranscriptionModel,
  roundSec,
  transcribeWithOpenRouter,
  transcribeWithSdk,
  type ChunkTranscript,
} from './transcription';

export {
  callOptions,
  effectiveMaxOutputTokens,
  escapeUntrustedText,
  untrustedContent,
  UNTRUSTED_CONTENT_NOTICE,
  type ProviderCallOptions,
  type UntrustedPart,
} from './call-options';
export { toAiError } from './error-mapping';
export { openRouterAudioFormat, sentenceSegments } from './transcription';

export const PROVIDER_BASE_URLS: Readonly<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

/** Per-entry time budgets: a model call 3 min, one entry's whole audio 20 min (spec 221). */
export const MODEL_CALL_TIMEOUT_MS = 3 * 60_000;
export const STT_TIMEOUT_MS = 20 * 60_000;

export interface KeyedResolvedRole {
  provider: AiProvider;
  model: string;
  apiKey: string;
  catalog: CatalogModel;
}

/** Keyless `local` entry (spec 221): resolved only while the sidecar is available. */
export interface LocalResolvedRole {
  provider: LocalProvider;
  model: string;
  apiKey: '';
  /** Sidecar base URL from STT_LOCAL_URL. Server-only: never serialize or log it. */
  baseUrl: string;
  catalog: CatalogModel;
}

export type ResolvedRole = KeyedResolvedRole | LocalResolvedRole;

export interface GenerateStructuredInput<T> {
  userId: string;
  role: Exclude<AiRole, 'stt'>;
  instructions: string;
  untrusted: readonly UntrustedPart[];
  schema: ZodType<T>;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

export interface GenerateStructuredResult<T> {
  output: T;
  /** `provider:model` of the chain entry that answered. */
  modelRef: string;
  /** Tokens of the answering entry (including its schema retry). */
  usage: TokenUsage;
  /** Summed over every attempt of every entry tried; null when unknown. */
  costUsd: number | null;
}

export interface AudioChunk {
  data: Uint8Array;
  mime: string;
  /** Offset of this chunk inside the full audio, in seconds. */
  startSec: number;
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscribeAudioInput {
  userId: string;
  chunks: readonly AudioChunk[];
  language?: string;
  signal?: AbortSignal;
}

export interface TranscribeAudioResult {
  text: string;
  segments: TranscriptSegment[];
  language: string | null;
  /** `provider:model` of the chain entry that answered. */
  model: string;
  /** Summed over every entry tried; null when unknown. */
  costUsd: number | null;
}

export interface AiClientDependencies {
  /** Injected into every provider object and the OpenRouter STT call. */
  fetch?: typeof fetch;
  getRoles?: (userId: string) => Promise<ModelRoles>;
  /** Reasoning effort per text role; defaults to the user's stored setting. */
  getReasoning?: (userId: string) => Promise<RoleReasoning>;
  getKey?: (userId: string, provider: AiProvider) => Promise<string | null>;
  /** Base URL of the `stt-local` sidecar while it is available, else null. */
  localSttEndpoint?: () => Promise<string | null>;
  /** Test seam: replaces the provider-backed language model. */
  languageModel?: (resolved: KeyedResolvedRole) => LanguageModel;
  /** Test seam: replaces the SDK-backed transcription model. */
  transcriptionModel?: (resolved: KeyedResolvedRole) => TranscriptionModel;
}

/** One entry's outcome; `costUsd` counts even when the entry failed. */
type Attempt<T> = { ok: true; value: T; costUsd: number | null } | AttemptFailure;
type AttemptFailure = { ok: false; error: AiError; costUsd: number | null };

const ROLE_FALLBACK: Partial<Record<AiRole, AiRole>> = { standard: 'fast', fast: 'standard' };

export function createAiClient(dependencies: AiClientDependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const getRoles = dependencies.getRoles ?? getModelRoles;
  const getReasoning = dependencies.getReasoning ?? getRoleReasoning;
  const getKey = dependencies.getKey ?? getProviderKey;
  const getLocalEndpoint = dependencies.localSttEndpoint ?? localSttEndpoint;
  const languageModel = dependencies.languageModel ?? providerLanguageModel;
  const transcriptionModel =
    dependencies.transcriptionModel ??
    ((resolved: KeyedResolvedRole) => providerTranscriptionModel(resolved, fetchImpl));

  /**
   * Usable entries of the role's chain, in order. Entries whose key is gone,
   * and `local` entries while the sidecar is unavailable, are skipped (never
   * deleted). `standard` and `fast` borrow each other's chain only when their
   * own has no usable entry; vision and STT never borrow.
   */
  async function resolveRoleChain(userId: string, role: AiRole): Promise<ResolvedRole[]> {
    const roles = await getRoles(userId);
    const keys = new Map<AiProvider, string | null>();
    let localBaseUrl: Promise<string | null> | undefined;
    const candidates = [role, ROLE_FALLBACK[role]].filter(
      (candidate): candidate is AiRole => candidate !== undefined,
    );
    for (const candidate of candidates) {
      const chain: ResolvedRole[] = [];
      for (const entry of roles[candidate] ?? []) {
        const catalog = findCatalogModel(entry.provider, entry.model);
        if (!catalog || !catalog.roles.includes(candidate)) continue;
        if (entry.provider === 'local') {
          localBaseUrl ??= getLocalEndpoint();
          const baseUrl = await localBaseUrl;
          if (baseUrl)
            chain.push({ provider: 'local', model: entry.model, apiKey: '', baseUrl, catalog });
          continue;
        }
        if (!keys.has(entry.provider))
          keys.set(entry.provider, await getKey(userId, entry.provider));
        const apiKey = keys.get(entry.provider);
        if (!apiKey) continue;
        chain.push({ provider: entry.provider, model: entry.model, apiKey, catalog });
      }
      if (chain.length > 0) return chain;
    }
    throw new AiNotConfiguredError(role === 'stt' ? 'STT_NOT_CONFIGURED' : 'AI_NOT_CONFIGURED');
  }

  async function resolveRole(userId: string, role: AiRole): Promise<ResolvedRole> {
    return (await resolveRoleChain(userId, role))[0]!;
  }

  /**
   * Tries each entry in order. Any failure moves to the next entry; only the
   * caller's own abort (cancel, lease loss, step budget) stops the chain.
   * The last entry's error is thrown when every entry fails.
   */
  async function runChain<T>(
    chain: readonly ResolvedRole[],
    signal: AbortSignal | undefined,
    attempt: (resolved: ResolvedRole) => Promise<Attempt<T>>,
  ): Promise<{ value: T; costUsd: number | null; modelRef: string }> {
    let costUsd: number | null = 0;
    let lastError: AiError | null = null;
    for (const resolved of chain) {
      const outcome = await attempt(resolved);
      costUsd = addCost(costUsd, outcome.costUsd);
      if (outcome.ok) {
        return {
          value: outcome.value,
          costUsd,
          modelRef: `${resolved.provider}:${resolved.model}`,
        };
      }
      lastError = outcome.error;
      if (signal?.aborted) break;
    }
    const failure = lastError ?? new AiError('LLM_FAILED', 'The model call failed.');
    // Failed attempts are billed too; the caller adds them to the job cost.
    failure.costUsd = costUsd;
    throw failure;
  }

  function providerLanguageModel(resolved: KeyedResolvedRole): LanguageModel {
    const { provider, model, apiKey } = resolved;
    const baseURL = PROVIDER_BASE_URLS[provider];
    switch (provider) {
      case 'openai':
        return createOpenAI({ apiKey, baseURL, fetch: fetchImpl })(model);
      case 'anthropic':
        return createAnthropic({ apiKey, baseURL, fetch: fetchImpl })(model);
      case 'xai':
        return createXai({ apiKey, baseURL, fetch: fetchImpl })(model);
      case 'google':
        return createGoogleGenerativeAI({ apiKey, baseURL, fetch: fetchImpl })(model);
      case 'openrouter':
        return createOpenRouter({
          apiKey,
          baseURL,
          fetch: fetchImpl,
          compatibility: 'strict',
        }).chat(model);
    }
  }

  async function generateWithEntry<T>(
    resolved: ResolvedRole,
    input: GenerateStructuredInput<T>,
    effort: ReasoningEffort,
  ): Promise<Attempt<{ output: T; usage: TokenUsage }>> {
    // `local` serves speech-to-text only, so it never answers a text call.
    if (resolved.provider === 'local') {
      const error = new AiError('LLM_FAILED', 'The local provider has no text model.', {
        provider: 'local',
      });
      return { ok: false, error, costUsd: 0 };
    }
    const provider = resolved.provider;
    if (!resolved.catalog.vision && input.untrusted.some((part) => 'image' in part)) {
      const error = new AiError('LLM_FAILED', 'The selected model does not accept images.', {
        provider,
      });
      return { ok: false, error, costUsd: 0 };
    }
    const model = languageModel(resolved);
    const messages: ModelMessage[] = [{ role: 'user', content: untrustedContent(input.untrusted) }];
    const usage = { inputTokens: 0, outputTokens: 0, known: true, costUsd: 0 as number | null };
    // Long-context price tiers apply per request, so each attempt is priced
    // on its own before the costs are summed.
    const addUsage = (value: TokenUsage | undefined) => {
      if (value?.inputTokens === undefined || value.outputTokens === undefined) {
        usage.known = false;
        return;
      }
      usage.inputTokens += value.inputTokens;
      usage.outputTokens += value.outputTokens;
      usage.costUsd = addCost(usage.costUsd, estimateTextCostUsd(resolved.catalog, value));
    };
    const spent = () => (usage.known ? usage.costUsd : null);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // Each entry gets its own budget; the caller's signal still wins.
      const signal = withTimeout(input.signal, MODEL_CALL_TIMEOUT_MS);
      try {
        const result = await generateText({
          model,
          instructions: `${input.instructions}\n\n${UNTRUSTED_CONTENT_NOTICE}`,
          messages,
          output: Output.object({ schema: input.schema }),
          // Reasoning tokens count as output (and are billed as output, which
          // `usage.outputTokens` already includes), so they get an allowance.
          maxOutputTokens: effectiveMaxOutputTokens(
            resolved.catalog,
            input.maxOutputTokens,
            effort,
            resolved.provider,
          ),
          maxRetries: 1,
          abortSignal: signal,
          ...callOptions(provider, resolved.catalog, effort),
        });
        addUsage(result.usage);
        const totals = usage.known
          ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
          : { inputTokens: undefined, outputTokens: undefined };
        return {
          ok: true,
          value: { output: result.output as T, usage: totals },
          costUsd: spent(),
        };
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
          if (NoObjectGeneratedError.isInstance(error)) addUsage(error.usage);
          else usage.known = false;
          if (attempt < 2) continue;
          const failure = new AiError(
            'LLM_FAILED',
            'The model output did not match the schema twice.',
            { provider },
          );
          return { ok: false, error: failure, costUsd: spent() };
        }
        // A rejected request reports no usage and is not billed.
        return { ok: false, error: toAiError(error, resolved), costUsd: spent() };
      }
    }
    return {
      ok: false,
      error: new AiError('LLM_FAILED', 'The model call failed.', { provider }),
      costUsd: spent(),
    };
  }

  async function generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const [chain, reasoning] = await Promise.all([
      resolveRoleChain(input.userId, input.role),
      getReasoning(input.userId),
    ]);
    // The effort of the role asked for, even when it borrows another role's chain.
    const effort = reasoning[input.role];
    const { value, costUsd, modelRef } = await runChain(chain, input.signal, (resolved) =>
      generateWithEntry(resolved, input, effort),
    );
    return { output: value.output, modelRef, usage: value.usage, costUsd };
  }

  /** STT transport switch. */
  function transcribeChunk(
    resolved: ResolvedRole,
    chunk: AudioChunk,
    language: string | undefined,
    signal: AbortSignal,
  ): Promise<ChunkTranscript> {
    switch (resolved.provider) {
      case 'local':
        return transcribeWithLocal(resolved.baseUrl, chunk, language, signal, fetchImpl);
      case 'openrouter':
        return transcribeWithOpenRouter(resolved, chunk, language, signal, fetchImpl);
      default:
        return transcribeWithSdk(transcriptionModel(resolved), resolved, chunk, language, signal);
    }
  }

  /** Transcribes the whole audio with one entry, so transcripts never mix models. */
  async function transcribeWithEntry(
    resolved: ResolvedRole,
    input: TranscribeAudioInput,
  ): Promise<Attempt<Omit<TranscribeAudioResult, 'costUsd' | 'model'>>> {
    const segments: TranscriptSegment[] = [];
    const texts: string[] = [];
    let language: string | null = input.language ?? null;
    let costUsd: number | null = 0;

    // One budget for the whole audio of this entry; the caller's signal still wins.
    const signal = withTimeout(input.signal, STT_TIMEOUT_MS);
    const ordered = [...input.chunks].sort((a, b) => a.startSec - b.startSec);
    for (const chunk of ordered) {
      let piece: ChunkTranscript;
      try {
        piece = await transcribeChunk(resolved, chunk, input.language, signal);
      } catch (error) {
        // Chunks already transcribed by this entry were billed.
        return { ok: false, error: toAiError(error, resolved), costUsd };
      }
      const text = piece.text.trim();
      if (text) texts.push(text);
      language ??= piece.language;
      for (const segment of piece.segments) {
        segments.push({
          startSec: roundSec(chunk.startSec + segment.startSec),
          endSec: roundSec(chunk.startSec + segment.endSec),
          text: segment.text,
        });
      }
      costUsd = addCost(
        costUsd,
        estimateSttCostUsd(resolved.catalog, piece.durationSec, piece.usage),
      );
    }
    return { ok: true, value: { text: texts.join('\n'), segments, language }, costUsd };
  }

  async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    // The sidecar decodes WAV only: with any other audio its entries are
    // skipped, and a chain left empty counts as no STT chain (spec 221).
    const wav = input.chunks.every(isWavChunk);
    const chain = (await resolveRoleChain(input.userId, 'stt')).filter(
      (entry) => wav || entry.provider !== 'local',
    );
    if (chain.length === 0) throw new AiNotConfiguredError('STT_NOT_CONFIGURED');
    const { value, costUsd, modelRef } = await runChain(chain, input.signal, (resolved) =>
      transcribeWithEntry(resolved, input),
    );
    return { ...value, model: modelRef, costUsd };
  }

  /**
   * Request WAV when any available STT entry is local, so cloud-first
   * chains retain their local fallback (spec 223).
   */
  async function sttPrefersWav(userId: string): Promise<boolean> {
    try {
      return (await resolveRoleChain(userId, 'stt')).some((entry) => entry.provider === 'local');
    } catch (error) {
      if (error instanceof AiNotConfiguredError) return false;
      throw error;
    }
  }

  return { resolveRole, resolveRoleChain, generateStructured, transcribeAudio, sttPrefersWav };
}

const defaultClient = createAiClient();
export const resolveRole = defaultClient.resolveRole;
export const resolveRoleChain = defaultClient.resolveRoleChain;
export const generateStructured = defaultClient.generateStructured;
export const transcribeAudio = defaultClient.transcribeAudio;
export const sttPrefersWav = defaultClient.sttPrefersWav;

/** Null-propagating USD sum: an unknown attempt makes the total unknown. */
function addCost(total: number | null, next: number | null): number | null {
  return total === null || next === null ? null : Math.round((total + next) * 1e8) / 1e8;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
