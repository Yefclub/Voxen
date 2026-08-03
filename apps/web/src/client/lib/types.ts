import type { AppTheme } from './theme';
import type { AppInterfaceMode } from './interface-mode';

export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
export type UserRole = 'ADMIN' | 'USER';
export type AppLanguage = 'pt-BR' | 'en';
export type { AppTheme };
export type { AppInterfaceMode };

export interface MeUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  status: UserStatus;
  role: UserRole;
  theme: AppTheme;
  interfaceMode: AppInterfaceMode;
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

// Modelo do catálogo OpenRouter (spec 123 — seleção manual de modelos).
export interface OrModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string>;
}

// As 6 finalidades de modelo existentes (spec 118 + spec 123).
export type ModelPurpose =
  | 'default_chat_model'
  | 'default_transcription_model'
  | 'default_web_search_model'
  | 'default_vision_model'
  | 'default_document_model'
  | 'default_x_analysis_model';

export interface ModelPurposeStatus {
  purpose: ModelPurpose;
  canonical: string;
  override: string | null;
  effective: string;
}

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'COMPLETED_WITH_WARNINGS'
  | 'FAILED'
  | 'CANCELLED';
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
