import { ChevronDown, ChevronUp, Plus, X } from '@/components/ui/icons';
import type { TranslateFn } from '../../lib/i18n';
import { IconButton } from '../ui/icon-button';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export type AiProviderId = 'openai' | 'anthropic' | 'openrouter' | 'xai' | 'google';
export type AiRoleId = 'fast' | 'standard' | 'vision' | 'stt';

export interface AiCatalogModel {
  id: string;
  label: string;
  roles: AiRoleId[];
  vision: boolean;
  contextWindow: number | null;
  pricing:
    | { kind: 'tokens'; inputPerMTok: number; outputPerMTok: number }
    | { kind: 'minutes'; perMinute: number };
}

export interface AiProviderCatalog {
  provider: AiProviderId;
  label: string;
  models: AiCatalogModel[];
}

export type ChainEntry = { provider: AiProviderId; model: string };
export type Chains = Partial<Record<AiRoleId, ChainEntry[]>>;
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';
/** Speech-to-text has no reasoning, so only text roles carry an effort. */
export type Reasoning = Record<Exclude<AiRoleId, 'stt'>, ReasoningEffort>;

const EFFORTS: readonly ReasoningEffort[] = ['off', 'low', 'medium', 'high'];

export const AI_ROLE_IDS: readonly AiRoleId[] = ['fast', 'standard', 'vision', 'stt'];
export const MAX_CHAIN_LENGTH = 4;

const entryKey = (entry: ChainEntry) => `${entry.provider}::${entry.model}`;

export function chainsEqual(a: Chains, b: Chains): boolean {
  return AI_ROLE_IDS.every(
    (role) => (a[role] ?? []).map(entryKey).join('|') === (b[role] ?? []).map(entryKey).join('|'),
  );
}

export function reasoningEqual(a: Reasoning, b: Reasoning): boolean {
  return a.fast === b.fast && a.standard === b.standard && a.vision === b.vision;
}

function formatUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumSignificantDigits: 3,
  }).format(value);
}

function priceHint(model: AiCatalogModel, t: TranslateFn, locale: string): string {
  return model.pricing.kind === 'tokens'
    ? t('account.ai.priceTokens', {
        input: formatUsd(model.pricing.inputPerMTok, locale),
        output: formatUsd(model.pricing.outputPerMTok, locale),
      })
    : t('account.ai.priceMinute', { price: formatUsd(model.pricing.perMinute, locale) });
}

interface RoleChainsEditorProps {
  catalog: AiProviderCatalog[];
  configured: ReadonlySet<AiProviderId>;
  chains: Chains;
  onChange: (next: Chains) => void;
  reasoning: Reasoning;
  onReasoningChange: (next: Reasoning) => void;
  disabled: boolean;
  t: TranslateFn;
  locale: string;
}

/** Ordered model list per role: the first entry is the primary, the rest are fallbacks. */
export function RoleChainsEditor({
  catalog,
  configured,
  chains,
  onChange,
  reasoning,
  onReasoningChange,
  disabled,
  t,
  locale,
}: RoleChainsEditorProps): React.ReactElement {
  function lookup(entry: ChainEntry) {
    const provider = catalog.find((item) => item.provider === entry.provider);
    const model = provider?.models.find((item) => item.id === entry.model);
    return provider && model ? { provider, model } : null;
  }

  function update(role: AiRoleId, next: ChainEntry[]): void {
    onChange({ ...chains, [role]: next });
  }

  function move(role: AiRoleId, index: number, delta: -1 | 1): void {
    const next = [...(chains[role] ?? [])];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    update(role, next);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {AI_ROLE_IDS.map((role) => {
        const chain = chains[role] ?? [];
        const used = new Set(chain.map(entryKey));
        const options = catalog
          .filter((provider) => configured.has(provider.provider))
          .flatMap((provider) =>
            provider.models
              .filter((model) => model.roles.includes(role))
              .map((model) => ({ provider, model })),
          )
          .filter(({ provider, model }) => !used.has(`${provider.provider}::${model.id}`));
        const full = chain.length >= MAX_CHAIN_LENGTH;
        const addId = `ai-chain-add-${role}`;
        return (
          <div
            key={role}
            className="space-y-2 rounded-lg border border-[var(--color-app-border)] p-3"
          >
            <div className="space-y-0.5">
              <Label htmlFor={addId}>{t(`account.ai.role.${role}`)}</Label>
              <p className="text-[11px] text-[var(--color-app-muted)]">
                {t(`account.ai.role.${role}Hint`)}
              </p>
            </div>
            {chain.length === 0 ? (
              <p className="text-xs text-[var(--color-app-muted)]">{t('account.ai.chainEmpty')}</p>
            ) : (
              <ol className="space-y-1.5">
                {chain.map((entry, index) => {
                  const found = lookup(entry);
                  return (
                    <li
                      key={entryKey(entry)}
                      className="flex items-center gap-1 rounded-md bg-[var(--color-app-surface)] py-1.5 pl-2.5 pr-1"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-app-muted)]">
                          {index === 0
                            ? t('account.ai.chainPrimary')
                            : t('account.ai.chainFallback', { n: index })}
                        </p>
                        <p className="break-words text-sm text-[var(--color-app-fg)]">
                          {found
                            ? `${found.model.label} · ${found.provider.label}`
                            : `${entry.provider}:${entry.model}`}
                        </p>
                        {found && (
                          <p className="text-[11px] text-[var(--color-app-muted)]">
                            {priceHint(found.model, t, locale)}
                          </p>
                        )}
                      </div>
                      <IconButton
                        label={t('account.ai.moveUp')}
                        className="h-7 w-7"
                        disabled={disabled || index === 0}
                        onClick={() => move(role, index, -1)}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('account.ai.moveDown')}
                        className="h-7 w-7"
                        disabled={disabled || index === chain.length - 1}
                        onClick={() => move(role, index, 1)}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('account.ai.removeEntry')}
                        className="h-7 w-7"
                        disabled={disabled}
                        onClick={() =>
                          update(
                            role,
                            chain.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconButton>
                    </li>
                  );
                })}
              </ol>
            )}
            <Select
              value=""
              disabled={disabled || full || options.length === 0}
              onValueChange={(value) => {
                const [provider, model] = value.split('::');
                if (provider && model) {
                  update(role, [...chain, { provider: provider as AiProviderId, model }]);
                }
              }}
            >
              <SelectTrigger id={addId} className="h-9 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <SelectValue
                    placeholder={full ? t('account.ai.chainFull') : t('account.ai.chainAdd')}
                  />
                </span>
              </SelectTrigger>
              <SelectContent>
                {options.map(({ provider, model }) => (
                  <SelectItem
                    key={`${provider.provider}::${model.id}`}
                    value={`${provider.provider}::${model.id}`}
                  >
                    {model.label} · {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role !== 'stt' && (
              <div className="space-y-1 pt-1">
                <Label htmlFor={`ai-reasoning-${role}`} className="text-xs">
                  {t('account.ai.reasoningLabel')}
                </Label>
                <Select
                  value={reasoning[role]}
                  disabled={disabled}
                  onValueChange={(value) =>
                    onReasoningChange({ ...reasoning, [role]: value as ReasoningEffort })
                  }
                >
                  <SelectTrigger id={`ai-reasoning-${role}`} className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EFFORTS.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {t(`account.ai.reasoning.${effort}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-[var(--color-app-muted)]">
                  {t('account.ai.reasoningHint')}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
