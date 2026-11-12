import { Globe2, Lock, Users } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';
import { Card, CardContent } from '../ui/card';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';
import { TimezoneSelect } from '../timezone-select';

interface InstanceAccessSettingsProps {
  allowSignups: boolean | null;
  timezone: string | null;
  togglingSignups: boolean;
  savingTimezone: boolean;
  onSignupsChange: (next: boolean) => Promise<void>;
  onTimezoneChange: (next: string) => Promise<void>;
}

export function InstanceAccessSettings({
  allowSignups,
  timezone,
  togglingSignups,
  savingTimezone,
  onSignupsChange,
  onTimezoneChange,
}: InstanceAccessSettingsProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <>
      <Card elevated>
        <CardContent className="pt-5 pb-5 flex items-center gap-4">
          <div
            className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border ${
              allowSignups
                ? 'bg-emerald-500/10 border-emerald-500/30 text-[var(--color-accent-primary)]'
                : 'bg-[var(--color-app-surface-hover)] border-[var(--color-app-border)] text-[var(--color-app-muted)]'
            }`}
          >
            {allowSignups ? <Users className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-app-fg)]">
              {t('admin.users.newSignups')}
            </p>
            <p className="text-xs text-[var(--color-app-muted)] mt-0.5 leading-relaxed">
              {allowSignups === null
                ? t('admin.users.loading')
                : allowSignups
                  ? t('admin.users.signupOpenCopy')
                  : t('admin.users.signupClosedCopy')}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {togglingSignups && <Spinner className="text-[var(--color-app-muted)]" />}
            <Switch
              checked={allowSignups ?? false}
              onCheckedChange={(next) => void onSignupsChange(next)}
              disabled={allowSignups === null || togglingSignups}
              aria-label={t('admin.users.allowSignups')}
            />
          </div>
        </CardContent>
      </Card>

      <Card elevated>
        <CardContent className="pt-5 pb-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border bg-violet-500/10 border-violet-500/30 text-[var(--color-accent-violet)]">
              <Globe2 className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-medium text-[var(--color-app-fg)]">
                {t('admin.users.timezoneTitle')}
              </p>
              <p className="text-xs text-[var(--color-app-muted)] leading-relaxed">
                {t('admin.users.timezoneDescription')}
              </p>
            </div>
            {savingTimezone && <Spinner className="text-[var(--color-app-muted)] shrink-0" />}
          </div>
          {timezone === null ? (
            <p className="text-xs text-[var(--color-app-muted)]">{t('admin.users.loading')}</p>
          ) : (
            <TimezoneSelect
              id="admin-instance-timezone"
              ariaLabel={t('admin.users.timezoneTitle')}
              value={timezone}
              onChange={(next) => void onTimezoneChange(next)}
              disabled={savingTimezone}
              hint={t('admin.users.timezoneHint')}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
