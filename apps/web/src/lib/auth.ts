// ============================================================================
// Voxen — Better Auth config
// ============================================================================
// Email+senha + workflow de aprovação:
//   - Primeiro cadastro (count(User)==0) vira ADMIN + APPROVED auto
//   - Demais entram PENDING; login bloqueado até admin aprovar
//   - Status REJECTED/DISABLED também bloqueia login
// ============================================================================

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
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

const config: BetterAuthOptions = {
  database: prismaAdapter(db, { provider: 'postgresql' }),
  // Mínimo 32 chars pra HMAC seguro. Em prod, gerar com `openssl rand -base64 32`.
  secret: requireEnv('BETTER_AUTH_SECRET', 32),
  baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    autoSignIn: false, // login só após aprovação — fail-closed
    minPasswordLength: 12,
    maxPasswordLength: 256,
  },
  user: {
    additionalFields: {
      status: { type: 'string', required: false, defaultValue: 'PENDING' },
      role: { type: 'string', required: false, defaultValue: 'USER' },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 dias
    updateAge: 60 * 60 * 24, // refresh a cada 24h
  },
  databaseHooks: {
    user: {
      create: {
        // Depois de criar user: se foi o primeiro, vira ADMIN + APPROVED.
        // Usamos `after` (e não `before`) porque approvedAt/approvedBy não
        // estão em additionalFields — better-auth ignoraria no before.
        // Pequena janela de race em signups simultâneos no DB vazio é aceitável
        // pro MVP (admin é setup único na vida do sistema).
        after: async (user) => {
          const count = await db.user.count();
          if (count === 1) {
            await db.user.update({
              where: { id: user.id },
              data: {
                role: 'ADMIN',
                status: 'APPROVED',
                approvedAt: new Date(),
                approvedBy: user.id,
              },
            });
          }
        },
      },
    },
    session: {
      create: {
        // Antes de criar session (i.e., login): bloqueia se não APPROVED.
        before: async (session) => {
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (!user) {
            throw new APIError('UNAUTHORIZED', { message: 'Usuário não encontrado.' });
          }
          if (user.status === 'PENDING') {
            throw new APIError('FORBIDDEN', {
              message: 'Cadastro aguardando aprovação do administrador.',
            });
          }
          if (user.status === 'REJECTED') {
            throw new APIError('FORBIDDEN', {
              message: 'Cadastro recusado. Entre em contato com o administrador.',
            });
          }
          if (user.status === 'DISABLED') {
            throw new APIError('FORBIDDEN', {
              message: 'Conta desativada. Entre em contato com o administrador.',
            });
          }
          return { data: session };
        },
      },
    },
  },
};

export const auth = betterAuth(config);

export type AuthSession = typeof auth.$Infer.Session;
