// ============================================================================
// ModelPickerDialog — diálogo de busca sobre o catálogo OpenRouter
// ============================================================================
// Reintroduz, de forma adaptada, o comportamento do antigo `ModelPicker`
// (removido no commit bd26187, quando a spec 118 unificou o onboarding para
// só pedir a chave). A spec 123 reintroduz a escolha manual, mas como uma
// ação posterior por finalidade na página de integrações admin — este
// componente é só a parte de busca/seleção do catálogo, controlada
// externamente (open/onOpenChange) e reaproveitada por cada finalidade.
// ============================================================================

import { useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, Check, Search } from '@/components/ui/icons';
import type { OrModel } from '../lib/types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

interface ModelPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  models: OrModel[];
  loading: boolean;
  error: string | null;
  value: string;
  onSelect: (modelId: string) => void;
  saving?: boolean;
}

export function ModelPickerDialog({
  open,
  onOpenChange,
  title,
  models,
  loading,
  error,
  value,
  onSelect,
  saving = false,
}: ModelPickerDialogProps): ReactElement {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const provider = providerFromId(m.id);
      return (
        m.id.toLowerCase().includes(q) ||
        (m.name ?? '').toLowerCase().includes(q) ||
        provider.toLowerCase().includes(q)
      );
    });
  }, [models, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 px-5 py-4">
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          <DialogDescription>
            {loading ? t('modelPicker.loading') : t('modelPicker.total', { count: models.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-[var(--color-app-border)] px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('modelPicker.filter')}
              spellCheck={false}
              disabled={loading || Boolean(error)}
              className="h-10 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] pl-10 pr-3 text-sm text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:border-violet-400/60 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>

        <div className="max-h-[56vh] overflow-y-auto overscroll-contain px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-[var(--color-app-muted)]">
              <Spinner />
              {t('modelPicker.loading')}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-amber-300/90">
              <AlertTriangle className="h-5 w-5" />
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-app-muted)]">
              {t('modelPicker.empty')}
            </div>
          ) : (
            filtered.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={model.id === value}
                disabled={saving}
                onSelect={() => onSelect(model.id)}
              />
            ))
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/70 px-5 py-3">
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelRow({
  model,
  selected,
  disabled,
  onSelect,
}: {
  model: OrModel;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): ReactElement {
  const provider = providerFromId(model.id);
  const context = formatContext(model.context_length);
  const inputs = model.architecture?.input_modalities ?? [];
  const price = formatPromptPrice(model.pricing);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          : 'border-transparent text-[var(--color-app-subtle)] hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)]',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg)] text-xs font-semibold uppercase text-[var(--color-app-subtle)]">
        {provider.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{model.name || model.id}</span>
        <span className="block truncate font-mono text-[11px] text-[var(--color-app-muted)]">
          {model.id}
        </span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          <ModelPill>{provider}</ModelPill>
          {context && <ModelPill>{context}</ModelPill>}
          {inputs.slice(0, 3).map((input) => (
            <ModelPill key={input}>{input}</ModelPill>
          ))}
          {price && <ModelPill>{price}</ModelPill>}
        </span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-emerald-300" />}
    </button>
  );
}

function ModelPill({ children }: { children: string }): ReactElement {
  return (
    <span className="max-w-full truncate rounded-md border border-[var(--color-app-border)] bg-black/20 px-1.5 py-0.5 text-[10px] text-[var(--color-app-muted)]">
      {children}
    </span>
  );
}

function providerFromId(id: string): string {
  return id.split('/')[0] || 'modelo';
}

function formatContext(value: number | undefined): string | null {
  if (!value || value <= 0) return null;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M ctx`;
  if (value >= 1000) return `${Math.round(value / 1000)}k ctx`;
  return `${value} ctx`;
}

function formatPromptPrice(pricing: Record<string, string> | undefined): string | null {
  const prompt = Number(pricing?.prompt);
  if (!Number.isFinite(prompt) || prompt <= 0) return null;
  return `$${(prompt * 1_000_000).toFixed(2)}/1M in`;
}
