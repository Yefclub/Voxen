import { AsyncLocalStorage } from 'node:async_hooks';

const providerRequest = new AsyncLocalStorage<string>();

export function currentSsoProviderId(): string | null {
  return providerRequest.getStore() ?? null;
}

export function withSsoProviderRequest<T>(providerId: string, operation: () => T): T {
  return providerRequest.run(providerId, operation);
}
