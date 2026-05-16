// ============================================================================
// Voxen — Better Auth config
// ============================================================================
// Email+senha apenas. Sem OAuth, sem 2FA, sem reset por enquanto.
// Workflow de aprovação (status PENDING/APPROVED) é adicionado em PR seguinte.
// ============================================================================

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from './db';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret: requireEnv('BETTER_AUTH_SECRET'),
  baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
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
