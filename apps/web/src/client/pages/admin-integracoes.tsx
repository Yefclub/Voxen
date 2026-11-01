// ============================================================================
// /admin/integracoes — config de tokens MCP e integrações
// ============================================================================
// ============================================================================

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, Sparkles } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { McpTokenAdminSection } from '../components/admin/mcp-token-admin-section';
import { useI18n } from '../lib/i18n';

export function AdminIntegracoesPage(): React.ReactElement {
  const { t } = useI18n();

  return (
    <PageShell width="workspace">
      <div data-page-content className="space-y-8 sm:space-y-10">
        <PageHeader
          eyebrow={t('shell.admin')}
          icon={Sparkles}
          iconClassName="text-violet-400"
          title={t('admin.integrations.title')}
          description={t('admin.integrations.description')}
        />

        <ConfigRevisionSection />
        <McpTokenAdminSection />
      </div>
    </PageShell>
  );
}

interface ConfigRevision {
  id: string;
  number: number;
  isBaseline: boolean;
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  changes: Array<{
    key: string;
    isSecret: boolean;
    previousValue: string | null;
    nextValue: string | null;
  }>;
}

function ConfigRevisionSection(): React.ReactElement {
  const { t, locale } = useI18n();
  const [revisions, setRevisions] = useState<ConfigRevision[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [target, setTarget] = useState<ConfigRevision | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const response = await apiGet<{ revisions: ConfigRevision[]; nextBefore: number | null }>(
        '/api/admin/config-revisions',
      );
      setRevisions(response.revisions);
      setNextBefore(response.nextBefore);
    } catch {
      setRevisions([]);
      setNextBefore(null);
    }
  }

  async function loadMore(): Promise<void> {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await apiGet<{ revisions: ConfigRevision[]; nextBefore: number | null }>(
        `/api/admin/config-revisions?before=${nextBefore}`,
      );
      setRevisions((current) => [...(current ?? []), ...response.revisions]);
      setNextBefore(response.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function rollback(): Promise<void> {
    if (!target) return;
    setRollingBack(true);
    try {
      const result = await apiPost<{ skippedSecretKeys: string[] }>(
        `/api/admin/config-revisions/${target.number}/rollback`,
        {},
      );
      toast.success(
        result.skippedSecretKeys.length > 0
          ? t('admin.integrations.revisions.rollbackPartial')
          : t('admin.integrations.revisions.rollbackSuccess'),
      );
      setTarget(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setRollingBack(false);
    }
  }

  if (!revisions) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card elevated>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <RotateCcw className="h-4 w-4 text-sky-400" />
            {t('admin.integrations.revisions.title')}
          </CardTitle>
          <CardDescription>{t('admin.integrations.revisions.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {revisions.length === 0 ? (
            <p className="text-sm text-[var(--color-app-muted)]">
              {t('admin.integrations.revisions.empty')}
            </p>
          ) : (
            revisions.map((revision, index) => (
              <div
                key={revision.id}
                className="rounded-lg border border-[var(--color-app-border)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">#{revision.number}</span>
                  {index === 0 && (
                    <Badge variant="success">{t('admin.integrations.revisions.current')}</Badge>
                  )}
                  <span className="text-[var(--color-app-muted)]">
                    {revision.actor?.name ?? t('admin.integrations.revisions.system')} ·{' '}
                    {new Date(revision.createdAt).toLocaleString(locale)}
                  </span>
                </div>
                {revision.reason && (
                  <p className="mt-1 text-xs text-[var(--color-app-muted)]">{revision.reason}</p>
                )}
                <ul className="mt-2 space-y-1 font-mono text-[11px] text-[var(--color-app-fg)]">
                  {revision.changes.map((change) => (
                    <li key={change.key}>
                      {change.key}:{' '}
                      {change.isSecret
                        ? t('admin.integrations.revisions.secret')
                        : `${change.previousValue ?? '∅'} → ${change.nextValue ?? '∅'}`}
                    </li>
                  ))}
                </ul>
                {!revision.isBaseline && (
                  <Button
                    className="mt-3"
                    variant="ghost"
                    size="sm"
                    onClick={() => setTarget(revision)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('admin.integrations.revisions.rollback')}
                  </Button>
                )}
              </div>
            ))
          )}
          {nextBefore !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? <Spinner /> : t('admin.integrations.revisions.loadMore')}
            </Button>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('admin.integrations.revisions.rollbackTitle')}
        description={t('admin.integrations.revisions.rollbackDescription')}
        confirmLabel={t('admin.integrations.revisions.rollback')}
        onConfirm={rollback}
        loading={rollingBack}
      />
    </motion.div>
  );
}
