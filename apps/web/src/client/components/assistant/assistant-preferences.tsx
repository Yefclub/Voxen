import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { apiGet, apiPut } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';

type Preferences = { role: 'standard' | 'fast'; webEnabled: boolean; searchConfigured?: boolean };
export function AssistantPreferences({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const [value, setValue] = useState<Preferences | null>(null);
  const [key, setKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!open) return;
    let current = true;
    setNotice('');
    setKey('');
    setRemoveKey(false);
    setValue(null);
    void apiGet<Preferences>('/api/chat/preferences')
      .then((data) => {
        if (current) setValue(data);
      })
      .catch(() => {
        if (current) setNotice(copy.failed);
      });
    return () => {
      current = false;
    };
  }, [open, copy.failed]);
  async function save() {
    if (!value) return;
    setSaving(true);
    setNotice('');
    try {
      await apiPut('/api/chat/preferences', {
        role: value.role,
        webEnabled: value.webEnabled,
        ...(removeKey ? { searchKey: null } : key ? { searchKey: key } : {}),
      });
      setValue((current) =>
        current
          ? {
              ...current,
              searchConfigured: removeKey ? false : Boolean(key || current.searchConfigured),
            }
          : null,
      );
      setRemoveKey(false);
      setKey('');
      setNotice(copy.saved);
    } catch {
      setNotice(copy.failed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="pr-12">
          <DialogTitle>{copy.settings}</DialogTitle>
          <DialogDescription>{copy.settingsHint}</DialogDescription>
        </DialogHeader>
        {value && (
          <div className="space-y-6">
            <label className="block space-y-2 text-sm">
              {copy.role}
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 text-[var(--color-app-fg)]"
                value={value.role}
                onChange={(event) =>
                  setValue({ ...value, role: event.target.value as Preferences['role'] })
                }
              >
                <option value="standard">{copy.standard}</option>
                <option value="fast">{copy.fast}</option>
              </select>
            </label>
            <Link
              to="/conta/ia"
              className="inline-block text-sm text-[var(--color-accent-primary)] underline underline-offset-4"
            >
              {copy.configure}
            </Link>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={value.webEnabled}
                onChange={(event) => setValue({ ...value, webEnabled: event.target.checked })}
              />
              {copy.webEnabled}
            </label>
            <div className="space-y-2">
              <label htmlFor="assistant-search-key" className="text-sm">
                {copy.key}
              </label>
              <Input
                id="assistant-search-key"
                type="password"
                autoComplete="off"
                value={key}
                disabled={removeKey}
                onChange={(event) => setKey(event.target.value)}
                placeholder={value.searchConfigured ? '••••••••' : ''}
                aria-describedby="assistant-key-hint"
              />
              <p
                id="assistant-key-hint"
                className="text-xs leading-relaxed text-[var(--color-app-muted)]"
              >
                {value.searchConfigured ? `${copy.keyConfigured}. ` : ''}
                {copy.keyHint}
              </p>
              {value.searchConfigured && (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={removeKey}
                    onChange={(event) => setRemoveKey(event.target.checked)}
                  />
                  {copy.removeKey}
                </label>
              )}
            </div>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {copy.save}
            </Button>
          </div>
        )}
        <p role="status" className="text-sm text-[var(--color-app-muted)]">
          {notice}
        </p>
      </DialogContent>
    </Dialog>
  );
}
