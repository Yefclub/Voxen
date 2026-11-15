import { Check, ChevronDown, Moon, Sun } from '../ui/icons';
import { Popover } from '@astryxdesign/core/Popover';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { IconButton } from '../ui/icon-button';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-provider';
import { APP_THEMES, type AppTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';

const chromeControlClass =
  'inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)] md:h-8 md:w-8';

const THEME_LABEL_KEY: Record<AppTheme, 'theme.switchToDark' | 'theme.switchToLight'> = {
  dark: 'theme.switchToDark',
  light: 'theme.switchToLight',
};

export function AppearanceMenu({ compact = false }: { compact?: boolean }): React.ReactElement {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const light = theme === 'light';

  return (
    <div
      role="group"
      aria-label={t('theme.appearance')}
      className={cn(
        'flex items-center transition-[gap] duration-200 motion-reduce:transition-none',
        compact ? 'gap-0' : 'gap-1',
      )}
    >
      <SegmentedControl
        label={t('theme.label')}
        value={theme}
        onChange={(mode) => {
          if (mode === 'light' || mode === 'dark') void setTheme(mode);
        }}
        aria-hidden={compact || undefined}
        inert={compact ? true : undefined}
        className={cn(
          'voxen-appearance-segments hidden min-w-0 max-w-[72px] overflow-hidden transition-[max-width,opacity,padding] duration-200 motion-reduce:transition-none md:flex',
          compact && 'max-w-0 px-0 opacity-0',
        )}
      >
        <SegmentedControlItem
          value="light"
          label={t('theme.switchToLight')}
          isLabelHidden
          icon={<Sun isAnimated={false} className="h-4 w-4" />}
        />
        <SegmentedControlItem
          value="dark"
          label={t('theme.switchToDark')}
          isLabelHidden
          icon={<Moon isAnimated={false} className="h-4 w-4" />}
        />
      </SegmentedControl>
      <Popover
        presentation="popover"
        alignment="end"
        label={t('theme.appearance')}
        width={224}
        padding={2}
        className="voxen-appearance-popover"
        content={
          <fieldset>
            <legend className="px-2 py-2 text-xs font-medium text-[var(--color-app-muted)]">
              {t('theme.label')}
            </legend>
            <div className="space-y-0.5">
              {APP_THEMES.map((id) => (
                <label
                  key={id}
                  className="relative flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-[13px] text-[var(--color-app-subtle)] transition-colors hover:bg-[var(--color-app-surface)] has-[:checked]:bg-[var(--color-app-surface)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--theme-focus)]"
                >
                  <input
                    type="radio"
                    name="voxen-theme"
                    value={id}
                    checked={theme === id}
                    onChange={() => void setTheme(id)}
                    className="sr-only"
                  />
                  <span
                    data-theme={id}
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 overflow-hidden rounded border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)]"
                  >
                    <span className="h-full w-1.5 border-r border-[var(--color-app-border)] bg-[var(--color-app-bg)]" />
                  </span>
                  <span className="flex-1">{t(THEME_LABEL_KEY[id])}</span>
                  {theme === id && (
                    <Check
                      aria-hidden
                      isAnimated={false}
                      className="h-3.5 w-3.5 text-[var(--color-app-fg)]"
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        }
      >
        {(triggerProps) => (
          <IconButton
            type="button"
            {...triggerProps}
            label={t('theme.appearance')}
            className={cn(
              chromeControlClass,
              'transition-[width,height,background-color,color] duration-200 motion-reduce:transition-none',
              compact && 'md:h-11 md:w-11',
            )}
          >
            <span aria-hidden className={compact ? 'inline-flex' : 'md:hidden'}>
              {light ? (
                <Sun isAnimated={false} className="h-4 w-4" />
              ) : (
                <Moon isAnimated={false} className="h-4 w-4" />
              )}
            </span>
            <span aria-hidden className={compact ? 'hidden' : 'hidden md:inline-flex'}>
              <ChevronDown isAnimated={false} className="h-3.5 w-3.5" />
            </span>
          </IconButton>
        )}
      </Popover>
    </div>
  );
}
