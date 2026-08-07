import { storageHealthCheck } from './storage';

export async function checkStorage(): Promise<void> {
  await storageHealthCheck();
}
