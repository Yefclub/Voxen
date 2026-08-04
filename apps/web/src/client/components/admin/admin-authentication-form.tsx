import { useI18n } from '../../lib/i18n';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export interface ProviderForm {
  providerId: string;
  issuer: string;
  domains: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export const EMPTY_PROVIDER_FORM: ProviderForm = {
  providerId: '',
  issuer: '',
  domains: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
};

export function providerPayload(form: ProviderForm, editing: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    issuer: form.issuer,
    domains: form.domains,
    pkce: true,
    scopes: form.scopes.split(/[\s,]+/).filter(Boolean),
  };
  if (!editing || form.clientId.trim()) result.clientId = form.clientId;
  if (!editing || form.clientSecret.trim()) result.clientSecret = form.clientSecret;
  if (!editing) result.providerId = form.providerId;
  return result;
}

export function ProviderFields({
  form,
  setField,
  disabled,
  showProviderId,
}: {
  form: ProviderForm;
  setField: <K extends keyof ProviderForm>(field: K, value: ProviderForm[K]) => void;
  disabled: boolean;
  showProviderId: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showProviderId && (
        <Field label={t('admin.auth.providerId')} hint={t('admin.auth.providerIdHint')}>
          <Input
            value={form.providerId}
            onChange={(event) => setField('providerId', event.target.value)}
            disabled={disabled}
            autoComplete="off"
          />
        </Field>
      )}
      <Field label={t('admin.auth.issuer')} hint={t('admin.auth.issuerHint')}>
        <Input
          value={form.issuer}
          onChange={(event) => setField('issuer', event.target.value)}
          disabled={disabled}
          placeholder="https://id.example.com"
        />
      </Field>
      <Field label={t('admin.auth.domains')} hint={t('admin.auth.domainsHint')}>
        <Input
          value={form.domains}
          onChange={(event) => setField('domains', event.target.value)}
          disabled={disabled}
          placeholder="example.com, subsidiary.com"
        />
      </Field>
      <Field
        label={t('admin.auth.clientId')}
        hint={showProviderId ? undefined : t('admin.auth.keepCurrent')}
      >
        <Input
          value={form.clientId}
          onChange={(event) => setField('clientId', event.target.value)}
          disabled={disabled}
          autoComplete="off"
        />
      </Field>
      <Field
        label={t('admin.auth.clientSecret')}
        hint={showProviderId ? t('admin.auth.secretHint') : t('admin.auth.keepCurrent')}
      >
        <Input
          type="password"
          value={form.clientSecret}
          onChange={(event) => setField('clientSecret', event.target.value)}
          disabled={disabled}
          autoComplete="new-password"
        />
      </Field>
      <Field label={t('admin.auth.scopes')}>
        <Input
          value={form.scopes}
          onChange={(event) => setField('scopes', event.target.value)}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-[var(--color-app-muted)]">{hint}</p>}
    </div>
  );
}
