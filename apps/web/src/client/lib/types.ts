// Tipos da API (espelhados do server). Em uma próxima PR podem virar do package @voxen/shared-types.

export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
export type UserRole = 'ADMIN' | 'USER';

export interface MeUser {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  role: UserRole;
}

export interface MeResponse {
  user: MeUser | null;
  setupComplete: boolean;
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
}
