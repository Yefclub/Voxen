import { COMMON_TIMEZONES } from '../../lib/app-timezone';
import { cn } from '../lib/utils';

export function detectBrowserTimezone(fallback = 'America/Sao_Paulo'): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : fallback;
  } catch {
    return fallback;
  }
}

/** Options for the select: common list + current value if missing. */
export function timezoneSelectOptions(current: string): string[] {
  const set = new Set<string>(COMMON_TIMEZONES);
  if (current) set.add(current);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function TimezoneSelect({
  value,
  onChange,
  disabled,
  id,
  className,
  label,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  label?: string;
  hint?: string;
}): React.ReactElement {
  const options = timezoneSelectOptions(value);
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-[var(--color-app-fg)]"
        >
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2.5 text-sm text-[var(--color-app-fg)] focus:border-emerald-500/50 focus:outline-none disabled:opacity-50"
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-[var(--color-app-muted)] leading-relaxed">{hint}</p>}
    </div>
  );
}
