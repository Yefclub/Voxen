import { AsyncLocalStorage } from 'node:async_hooks';

const providerRequest = new AsyncLocalStorage<{ providerId: string; sessionDenied?: boolean }>();

export function currentSsoProviderId(): string | null {
  return providerRequest.getStore()?.providerId ?? null;
}

export function withSsoProviderRequest<T>(providerId: string, operation: () => T): T {
  return providerRequest.run({ providerId }, operation);
}

export function denyPendingSsoSession(): void {
  const request = providerRequest.getStore();
  if (request) request.sessionDenied = true;
}

export function pendingSsoSessionDenied(): boolean {
  return providerRequest.getStore()?.sessionDenied === true;
}
