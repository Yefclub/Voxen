// ============================================================================
// Bun test preload — garante master key disponível antes dos imports
// ============================================================================
// Roda antes de QUALQUER teste; cria uma master key efêmera se nenhuma chave
// estiver definida. Em deploys reais a fonte canônica é MASTER_KEY.
// ============================================================================

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (
  !process.env.MASTER_KEY &&
  (!process.env.MASTER_KEY_PATH || !existsSync(process.env.MASTER_KEY_PATH))
) {
  process.env.MASTER_KEY = randomBytes(32).toString('base64');
}

// BETTER_AUTH_SECRET é exigido com mín 32 chars; default p/ tests locais.
if (!process.env.BETTER_AUTH_SECRET) {
  process.env.BETTER_AUTH_SECRET = 'test-secret-' + 'x'.repeat(40);
}
