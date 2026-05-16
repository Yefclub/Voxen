// ============================================================================
// Voxen — Better Auth config
// ============================================================================
// Email+senha apenas. Sem OAuth, sem 2FA, sem reset por enquanto.
// Workflow de aprovação (status PENDING/APPROVED) é adicionado em PR seguinte.
// ============================================================================

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from './db';

function requireEnv(name: string, minLength = 0): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (minLength > 0 && v.length < minLength) {
    throw new Error(`Env var ${name} must be >= ${minLength} chars (got ${v.length})`);
  }
  return v;
}

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  // Mínimo 32 chars pra HMAC seguro. Em prod, gerar com `openssl rand -base64 32`.
  secret: requireEnv('BETTER_AUTH_SECRET', 32),
  baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    // autoSignIn: false propositalmente — sem enforcement de status=PENDING
    // nessa PR, login auto pós-cadastro abriria janela de vulnerabilidade.
    // Quando `feat/admin-approval` mergear (PR seguinte), reavaliar.
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 256,
  },
  user: {
    additionalFields: {
      // Mapeados no schema.prisma mas adicionados aqui pra exposure no /api/me
      status: { type: 'string', required: false, defaultValue: 'PENDING' },
      role: { type: 'string', required: false, defaultValue: 'USER' },
    },
  },
  // Sessões: cookies HTTP-only + SameSite=Lax (default better-auth)
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 dias
    updateAge: 60 * 60 * 24, // refresh a cada 24h
  },
});

export type AuthSession = typeof auth.$Infer.Session;
