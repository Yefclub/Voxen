import { ApiError } from './api';
import type { I18nKey, TranslateFn } from './i18n';

export type OrganizationMode = 'OFF' | 'MANUAL' | 'AUTO';
export interface OrganizationPreferences {
  mode: OrganizationMode;
  automaticSince: string | null;
}
export interface OrganizationRun {
  id: string;
  revision: number;
  trigger: 'AUTO' | 'MANUAL';
  status: 'PENDING' | 'RUNNING' | 'RETRY' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  totalSections: number;
  completedSections: number;
  costUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
  warnings: string[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface OrganizationPage {
  items: OrganizationRun[];
  nextCursor: string | null;
  mode: OrganizationMode;
  sourceActive: boolean;
}
export const organizationActive = (row: OrganizationRun) =>
  ['PENDING', 'RUNNING', 'RETRY'].includes(row.status);
export function organizationStatusText(row: OrganizationRun, t: TranslateFn): string {
  const keys: Record<OrganizationRun['status'], I18nKey> = {
    PENDING: 'organization.pending',
    RUNNING: 'organization.running',
    RETRY: 'organization.retrying',
    COMPLETED: 'organization.completed',
    FAILED: 'organization.failed',
    CANCELLED: 'organization.stopped',
    SKIPPED: 'organization.skipped',
  };
  return `${t(keys[row.status])}${row.totalSections > 0 ? ` · ${organizationProgressText(row, t)}` : ''}`;
}
export function organizationProgressText(row: OrganizationRun, t: TranslateFn): string {
  return t(row.totalSections === 1 ? 'organization.progressOne' : 'organization.progress', {
    done: row.completedSections,
    total: row.totalSections,
  });
}
export function organizationErrorText(error: unknown, t: TranslateFn): string {
  const body = error instanceof ApiError ? (error.body as { error?: unknown } | undefined) : null;
  const code =
    typeof body?.error === 'string' ? body.error : typeof error === 'string' ? error : '';
  const keys: Record<string, I18nKey> = {
    AI_NOT_CONFIGURED: 'organization.error.model',
    DISABLED: 'organization.error.disabled',
    STALE_REVISION: 'organization.error.conflict',
    STALE_SOURCE: 'organization.error.conflict',
    SOURCE_PROVENANCE_UNAVAILABLE: 'organization.error.provenance',
    SOURCE_MAPPING_UNAVAILABLE: 'organization.error.mapping',
    SOURCE_TOO_LARGE: 'organization.error.large',
    TEXT_TOO_LARGE: 'organization.error.large',
    INPUT_TOO_LARGE: 'organization.error.large',
    RATE_LIMITED: 'organization.error.rate',
    NOT_FOUND: 'organization.error.missing',
    TIMEOUT: 'organization.error.timeout',
  };
  return t(keys[code] ?? 'organization.error.generic');
}
export function organizationWarnings(row: OrganizationRun, t: TranslateFn): string[] {
  const keys: Record<string, I18nKey> = {
    UNSUPPORTED_NODE: 'organization.warning.unsupported',
    UNSUPPORTED_RELATIONSHIP: 'organization.warning.unsupported',
    AMBIGUOUS_IDENTITY: 'organization.warning.ambiguous',
    INACTIVE_IDENTITY: 'organization.warning.inactive',
    INACTIVE_RELATIONSHIP: 'organization.warning.inactive',
    UNCONFIRMED_USAGE: 'organization.warning.usage',
  };
  return [...new Set(row.warnings.map((code) => t(keys[code] ?? 'organization.warning.generic')))];
}
