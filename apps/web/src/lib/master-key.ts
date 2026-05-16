// ============================================================================
// Master key loader (singleton)
// ============================================================================
// Carrega a master key uma única vez por processo, a partir de
// `MASTER_KEY_PATH` (default `/data/master.key`). Falha rápido se ausente.
//
// Spec 000: "If the master key file is missing or unreadable when an app
// starts, the app shall exit with non-zero code and log
// 'FATAL: master key not accessible at <path>'".
// ============================================================================

import { loadMasterKey, CryptoError } from './crypto';

let cachedKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const path = process.env.MASTER_KEY_PATH ?? '/data/master.key';
  try {
    cachedKey = loadMasterKey(path);
    return cachedKey;
  } catch (err) {
    if (err instanceof CryptoError) {
      console.error(err.message);
    }
    throw err;
  }
}

// Apenas para testes — força um reload na próxima chamada de getMasterKey().
export function __resetMasterKeyCache(): void {
  cachedKey = null;
}
