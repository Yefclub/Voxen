export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
export type UserRole = 'ADMIN' | 'USER';
export type AppLanguage = 'pt-BR' | 'en';

export interface MeUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  status: UserStatus;
  role: UserRole;
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

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface JobSummary {
  id: string;
  status: JobStatus;
  sourceUrl: string;
  errorMsg: string | null;
  transcriptId: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
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
