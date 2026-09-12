import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Network } from '@/components/ui/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Spinner } from '../ui/spinner';
import { toast } from '../../lib/toast';
import { ApiError, apiGet, apiPatch } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

type ResearchMode = 'OFF' | 'MANUAL' | 'AUTO';

const RESEARCH_MODE_COPY = {
  OFF: {
    title: 'admin.integrations.researchPolicy.off.title',
    description: 'admin.integrations.researchPolicy.off.description',
  },
  MANUAL: {
    title: 'admin.integrations.researchPolicy.manual.title',
    description: 'admin.integrations.researchPolicy.manual.description',
  },
  AUTO: {
    title: 'admin.integrations.researchPolicy.auto.title',
    description: 'admin.integrations.researchPolicy.auto.description',
  },
} as const;

export function ResearchPolicySection(): React.ReactElement {
  const { t } = useI18n();
  const [mode, setMode] = useState<ResearchMode | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ mode: ResearchMode }>('/api/admin/research-policy')
      .then((response) => setMode(response.mode))
      .catch((error) => toast.error(error instanceof ApiError ? error.message : t('common.error')));
  }, [t]);

  async function updateMode(nextMode: ResearchMode): Promise<void> {
    if (saving || mode === nextMode) return;
    setSaving(true);
    try {
      const response = await apiPatch<{ mode: ResearchMode }>('/api/admin/research-policy', {
        mode: nextMode,
      });
      setMode(response.mode);
      toast.success(t('admin.integrations.researchPolicy.saved'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card elevated>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <Network className="h-4 w-4 text-sky-400" />
            {t('admin.integrations.researchPolicy.title')}
          </CardTitle>
          <CardDescription>{t('admin.integrations.researchPolicy.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === null ? (
            <Spinner />
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {(['OFF', 'MANUAL', 'AUTO'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => void updateMode(value)}
                  className={cn(
                    'rounded-xl border px-3 py-3 text-left transition-colors',
                    mode === value
                      ? 'border-violet-400/50 bg-violet-500/10 text-[var(--color-app-fg)]'
                      : 'border-[var(--color-app-border)] text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface)]',
                  )}
                >
                  <span className="block text-xs font-semibold">
                    {t(RESEARCH_MODE_COPY[value].title)}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed">
                    {t(RESEARCH_MODE_COPY[value].description)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--color-app-muted)]">
            {t('admin.integrations.researchPolicy.boundary')}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
