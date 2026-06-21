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
import { oneTimeToken } from 'better-auth/plugins/one-time-token';
import { db } from './db';

// TTL do token de login por QR (spec 060). Curto de propósito: o handoff é
// imediato (escanear → abrir). `expiresIn` do plugin é em MINUTOS.
export const QR_LOGIN_TTL_SEC = 60;

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

// Sem anotação explícita `: BetterAuthOptions` no `const` — ela apagaria os
// tipos literais dos plugins, e `auth.api.generateOneTimeToken` ficaria
// invisível. Usamos `satisfies` no fim para checar a forma sem perder a
// inferência dos endpoints dos plugins.
const config = {
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
  plugins: [
    // Login rápido por QR (spec 060). O `generate` exige sessão válida
    // (sessionMiddleware interno), gerando token de alta entropia (32 chars)
    // single-use. `storeToken: 'hashed'` guarda só o hash no DB — dump não
    // revela tokens utilizáveis. O `verify` invalida o token no 1º uso e seta
    // o cookie de sessão no device que escaneou (reusa a sessão do desktop).
    oneTimeToken({
      expiresIn: QR_LOGIN_TTL_SEC / 60, // plugin usa minutos → 1 min
      storeToken: 'hashed',
      // Fecha a rota HTTP crua (/api/auth/one-time-token/*): geração e consumo só
      // via auth.api.* (server-side), que é como os wrappers /api/account/qr-login
      // e /qr-login usam. Evita bypass do rate-limit do wrapper pela rota direta.
      disableClientRequest: true,
    }),
  ],
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
} satisfies BetterAuthOptions;

export const auth = betterAuth(config);

export type AuthSession = typeof auth.$Infer.Session;
