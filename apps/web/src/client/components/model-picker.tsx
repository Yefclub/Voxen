import { useMemo, useState, type ReactElement } from 'react';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import type { OrModel } from '../lib/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

interface ModelPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: OrModel[];
  count?: number;
  hint?: string;
  optional?: boolean;
}

export function ModelPicker({
  label,
  value,
  onChange,
  options,
  count,
  hint,
  optional = false,
}: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((m) => m.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((m) => {
      const provider = providerFromId(m.id);
      return (
        m.id.toLowerCase().includes(q) ||
        (m.name ?? '').toLowerCase().includes(q) ||
        provider.toLowerCase().includes(q)
      );
    });
  }, [options, query]);
  const total = count ?? options.length;

  function selectModel(modelId: string): void {
    onChange(modelId);
    setOpen(false);
    setQuery('');
  }

  function clearModel(): void {
    onChange('');
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] tabular-nums">
          {query.trim() ? `${filtered.length} / ${total}` : `${total} disponíveis`}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/55 px-3.5 py-3 text-left transition-colors',
          'shadow-[inset_0_1px_0_oklch(100%_0_0/0.04)] hover:border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface-hover)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-zinc-950/30 text-emerald-300">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-100">
              {selected?.name || value || 'Não configurado'}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-app-muted)]">
              {selected?.id || value || 'Selecione um modelo'}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-app-muted)] transition-colors group-hover:text-zinc-200" />
        </div>
      </button>
      {hint && <p className="text-[11px] leading-snug text-[var(--color-app-muted)]">{hint}</p>}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <DialogContent className="max-h-[86vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 px-5 py-4">
            <DialogTitle className="font-display text-xl">{label}</DialogTitle>
            <DialogDescription>
              {total} modelos disponíveis{optional ? ' · opcional' : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-[var(--color-app-border)] px-5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar por nome, provedor ou ID"
                spellCheck={false}
                className="h-10 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:border-violet-400/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-[56vh] overflow-y-auto overscroll-contain px-2 py-2">
            {optional && (
              <button
                type="button"
                onClick={clearModel}
                className={cn(
                  'mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                  !value
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-transparent text-zinc-300 hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)]',
                )}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-app-border)]">
                  <X className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Não configurar</span>
                  <span className="block text-xs text-[var(--color-app-muted)]">
                    Recurso fica desabilitado ou usa fallback.
                  </span>
                </span>
                {!value && <Check className="h-4 w-4 shrink-0 text-emerald-300" />}
              </button>
            )}

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--color-app-muted)]">
                Nenhum modelo encontrado.
              </div>
            ) : (
              filtered.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selected={model.id === value}
                  onSelect={() => selectModel(model.id)}
                />
              ))
            )}
          </div>

          <div className="flex justify-end border-t border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/70 px-5 py-3">
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: OrModel;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  const provider = providerFromId(model.id);
  const context = formatContext(model.context_length);
  const inputs = model.architecture?.input_modalities ?? [];
  const price = formatPromptPrice(model.pricing);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
        selected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          : 'border-transparent text-zinc-300 hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)]',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-app-border)] bg-zinc-950/25 text-xs font-semibold uppercase text-zinc-300">
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
