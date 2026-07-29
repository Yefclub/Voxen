import type { AppTheme } from './theme';

export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
export type UserRole = 'ADMIN' | 'USER';
export type AppLanguage = 'pt-BR' | 'en';
export type { AppTheme };

export interface MeUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  status: UserStatus;
  role: UserRole;
  theme: AppTheme;
}

export interface MeResponse {
  user: MeUser | null;
  setupComplete: boolean;
  onboardingDone: boolean;
  language: AppLanguage;
}

export interface InstanceState {
  allowSignups: boolean;
  hasUsers: boolean;
  onboardingDone: boolean;
  language: AppLanguage;
}

export interface VersionResponse {
  version: string;
  gitSha: string | null;
  builtAt: string;
}

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
export type JobType =
  | 'DOWNLOAD_AND_TRANSCRIBE'
  | 'SCRAPE_WEB'
  | 'UPLOAD_AND_TRANSCRIBE'
  | 'UPLOAD_AND_ANALYZE_IMAGE'
  | 'UPLOAD_AND_ANALYZE_DOCUMENT'
  | 'ANALYZE_X';

export interface JobSummary {
  id: string;
  type?: JobType;
  status: JobStatus;
  sourceUrl: string;
  errorMsg: string | null;
  transcriptId: string | null;
  progressStage?: string | null;
  progressPercent?: number | null;
  progressedAt?: string | null;
  events?: JobProgressEvent[];
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Presente quando o job já tem transcript (DONE). */
  title?: string | null;
  thumbnailUrl?: string | null;
  transcriptSource?: string | null;
  durationSec?: number | null;
}

export interface JobProgressEvent {
  id: string;
  jobId: string;
  stage: string;
  percent?: number | null;
  chunkIndex?: number | null;
  transcriptId?: string | null;
  errorMsg?: string | null;
  ts: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  role: UserRole;
  monthlyBudgetUsd: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
}

export interface OrModel {
  id: string;
  name: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  pricing?: Record<string, string>;
}
