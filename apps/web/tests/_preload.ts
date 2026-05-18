// ============================================================================
// Bun test preload — garante master key disponível antes dos imports
// ============================================================================
// Roda antes de QUALQUER teste; cria uma master key efêmera num tmpdir e
// aponta MASTER_KEY_PATH se ainda não estiver definido (CI já define).
// ============================================================================

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

if (!process.env.MASTER_KEY_PATH || !existsSync(process.env.MASTER_KEY_PATH)) {
  const dir = mkdtempSync(join(tmpdir(), 'voxen-mk-'));
  const file = join(dir, 'master.key');
  writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o400 });
  process.env.MASTER_KEY_PATH = file;
}

// BETTER_AUTH_SECRET é exigido com mín 32 chars; default p/ tests locais.
if (!process.env.BETTER_AUTH_SECRET) {
  process.env.BETTER_AUTH_SECRET = 'test-secret-' + 'x'.repeat(40);
}
