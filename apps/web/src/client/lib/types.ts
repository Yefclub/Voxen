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
  ssoEnabled: boolean;
}

export interface VersionResponse {
  version: string;
  gitSha: string | null;
  builtAt: string;
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
