// ============================================================================
// Voxen — Better Auth config
// ============================================================================
// Email+senha + workflow de aprovação:
//   - Primeiro cadastro (count(User)==0) vira ADMIN + APPROVED auto
//   - Demais entram PENDING; login bloqueado até admin aprovar
//   - Status REJECTED/DISABLED também bloqueia login
// ============================================================================

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { randomUUID } from 'node:crypto';
import { oauthProvider } from '@better-auth/oauth-provider';
import { jwt } from 'better-auth/plugins/jwt';
import { oneTimeToken } from 'better-auth/plugins/one-time-token';
import { sso } from '@better-auth/sso';
import { db } from './db';
import { encryptedSsoPrismaAdapter } from './sso-adapter';
import { getSetting } from './settings';
import {
  emailMatchesSsoDomains,
  normalizeSsoDomains,
  scrubFederatedAccountTokens,
} from './sso-oidc';
import { currentSsoProviderId } from './sso-request-context';
import { resolveAuthBaseURL } from './auth-base-url';
import { structuredLog } from './structured-log';

export { resolveAuthBaseURL } from './auth-base-url';

// TTL do token de login por QR (spec 060). Curto de propósito: o handoff é
// imediato (escanear → abrir). `expiresIn` do plugin é em MINUTOS.
export const QR_LOGIN_TTL_SEC = 60;
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SEC = 5 * 60;
export const MCP_OAUTH_REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

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

function callbackProviderId(path: string | undefined): string | null {
  const match = path?.match(/(?:^|\/)sso\/callback\/([^/?]+)\/?$/);
  if (!match?.[1] || match[1].startsWith(':')) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function assertNewUserRegistrationAllowed(): Promise<void> {
  const userCount = await db.user.count();
  if (userCount === 0) return;
  const [allowSignupsRaw, onboardingRaw] = await Promise.all([
    getSetting('allow_signups').catch(() => null),
    getSetting('onboarding_done').catch(() => null),
  ]);
  if (onboardingRaw === 'true' && allowSignupsRaw === 'false') {
    throw new APIError('FORBIDDEN', {
      message: 'Cadastros novos estão desativados nesta instância.',
      code: 'SIGNUPS_DISABLED',
    });
  }
}

async function getActiveSsoProvider(providerId: string): Promise<{
  domain: string;
  domainVerified: boolean;
} | null> {
  const provider = await db.ssoProvider.findUnique({
    where: { providerId },
    select: { domain: true, domainVerified: true, oidcConfig: true, disabledAt: true },
  });
  if (!provider) return null;
  if (!provider.oidcConfig || provider.disabledAt) {
    throw new APIError('FORBIDDEN', { message: 'Provedor OIDC desativado.' });
  }
  return { domain: provider.domain, domainVerified: provider.domainVerified };
}

async function assertFederatedIdentity(input: {
  providerId: string;
  email: string;
  emailVerified?: boolean;
  requireClaimVerification: boolean;
}): Promise<void> {
  const provider = await getActiveSsoProvider(input.providerId);
  if (!provider) {
    throw new APIError('FORBIDDEN', { message: 'Provedor OIDC não encontrado.' });
  }
  if (!provider.domainVerified) {
    throw new APIError('FORBIDDEN', { message: 'Domínio do provedor OIDC não verificado.' });
  }
  if (input.requireClaimVerification && input.emailVerified !== true) {
    throw new APIError('FORBIDDEN', { message: 'O provedor OIDC não verificou o e-mail.' });
  }
  if (!emailMatchesSsoDomains(input.email, normalizeSsoDomains(provider.domain))) {
    throw new APIError('FORBIDDEN', { message: 'E-mail fora dos domínios autorizados.' });
  }
}

function verifiedEmailFromOidcIdToken(idToken: unknown): string {
  if (typeof idToken !== 'string') {
    throw new APIError('FORBIDDEN', { message: 'O provedor OIDC não enviou um ID token.' });
  }
  const encodedPayload = idToken.split('.')[1];
  if (!encodedPayload) {
    throw new APIError('FORBIDDEN', { message: 'ID token OIDC inválido.' });
  }
  let claims: { email?: unknown; email_verified?: unknown };
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as typeof claims;
  } catch {
    throw new APIError('FORBIDDEN', { message: 'ID token OIDC inválido.' });
  }
  if (claims.email_verified !== true || typeof claims.email !== 'string') {
    throw new APIError('FORBIDDEN', { message: 'O provedor OIDC não verificou o e-mail.' });
  }
  return claims.email.trim().toLowerCase();
}

// Sem anotação explícita `: BetterAuthOptions` no `const` — ela apagaria os
// tipos literais dos plugins, e `auth.api.generateOneTimeToken` ficaria
// invisível. Usamos `satisfies` no fim para checar a forma sem perder a
// inferência dos endpoints dos plugins.
const authBaseURL = resolveAuthBaseURL(process.env.APP_BASE_URL);
const mcpOAuthResource = `${new URL(authBaseURL).origin}/mcp`;

export function resolveMcpOAuthResource(): string {
  return mcpOAuthResource;
}

const config = {
  database: encryptedSsoPrismaAdapter,
  logger: {
    disableColors: true,
    level: 'warn',
    log: (level: 'debug' | 'info' | 'warn' | 'error') => {
      structuredLog(
        level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info',
        'auth-library-log',
        { component: 'better-auth' },
      );
    },
  },
  // Propagate unexpected provider/database failures to Hono's structured
  // boundary instead of letting better-call print raw multi-line payloads.
  onAPIError: { throw: true },
  // Mínimo 32 chars pra HMAC seguro. Em prod, gerar com `openssl rand -base64 32`.
  secret: requireEnv('BETTER_AUTH_SECRET', 32),
  baseURL: authBaseURL,
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
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: false,
      requireLocalEmailVerified: false,
      updateUserInfoOnLink: false,
      trustedProviders: [],
    },
  },
  plugins: [
    jwt({
      jwt: { issuer: `${new URL(authBaseURL).origin}/api/auth` },
    }),
    oauthProvider({
      silenceWarnings: { oauthAuthServerConfig: true },
      loginPage: '/entrar',
      consentPage: '/oauth/consent',
      scopes: ['mcp:read', 'mcp:write', 'offline_access'],
      validAudiences: [mcpOAuthResource],
      grantTypes: ['authorization_code', 'refresh_token'],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: ['mcp:read'],
      clientRegistrationAllowedScopes: ['mcp:read', 'mcp:write', 'offline_access'],
      accessTokenExpiresIn: MCP_OAUTH_ACCESS_TOKEN_TTL_SEC,
      refreshTokenExpiresIn: MCP_OAUTH_REFRESH_TOKEN_TTL_SEC,
      codeExpiresIn: 5 * 60,
      storeClientSecret: 'hashed',
      storeTokens: 'hashed',
      customAccessTokenClaims: async ({ user, resource }) => {
        if (!user || user.status !== 'APPROVED') {
          throw new APIError('FORBIDDEN', {
            message: 'A conta Voxen não está aprovada para delegar acesso MCP.',
            code: 'MCP_OAUTH_USER_NOT_APPROVED',
          });
        }
        if (resource !== mcpOAuthResource) {
          throw new APIError('BAD_REQUEST', {
            message: 'O recurso OAuth solicitado não corresponde ao MCP desta instância.',
            code: 'MCP_OAUTH_RESOURCE_MISMATCH',
          });
        }
        return {
          jti: randomUUID(),
          'https://voxen.dev/claims/credential_class': 'mcp_oauth',
        };
      },
    }),
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
    sso({
      // A gestão do plugin fica fechada. Provedores globais passam somente
      // pelas rotas admin do Voxen e pelo adapter cifrado.
      providersLimit: 0,
      trustEmailVerified: true,
      // Também inclui domainVerified no schema interno do adapter. O Voxen
      // realiza o desafio DNS por sua própria API administrativa, enquanto o
      // plugin usa este campo para recusar início e callback antes do IdP.
      domainVerification: { enabled: true, tokenPrefix: 'voxen-sso' },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          await assertNewUserRegistrationAllowed();
          const providerId = currentSsoProviderId() ?? callbackProviderId(context?.path);
          if (providerId) {
            await assertFederatedIdentity({
              providerId,
              email: user.email,
              emailVerified: user.emailVerified,
              requireClaimVerification: true,
            });
          }
          return { data: user };
        },
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
    account: {
      create: {
        before: async (account) => {
          const provider = await getActiveSsoProvider(account.providerId);
          if (!provider) return { data: account };
          const user = await db.user.findUnique({
            where: { id: account.userId },
            select: { email: true },
          });
          if (!user) {
            throw new APIError('UNAUTHORIZED', { message: 'Usuário federado não encontrado.' });
          }
          const verifiedEmail = verifiedEmailFromOidcIdToken(account.idToken);
          if (verifiedEmail !== user.email.trim().toLowerCase()) {
            throw new APIError('FORBIDDEN', {
              message: 'O e-mail do ID token não corresponde ao usuário federado.',
            });
          }
          await assertFederatedIdentity({
            providerId: account.providerId,
            email: user.email,
            emailVerified: true,
            requireClaimVerification: true,
          });
          return { data: scrubFederatedAccountTokens(account) };
        },
      },
      update: {
        before: async (account, context) => {
          const providerId =
            (typeof account.providerId === 'string' ? account.providerId : null) ??
            currentSsoProviderId() ??
            callbackProviderId(context?.path);
          if (!providerId || !(await getActiveSsoProvider(providerId))) {
            return { data: account };
          }
          return { data: scrubFederatedAccountTokens(account) };
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
            throw new APIError('UNAUTHORIZED', {
              message: 'Usuário não encontrado.',
              code: 'ACCOUNT_NOT_FOUND',
            });
          }
          if (user.status === 'PENDING') {
            throw new APIError('FORBIDDEN', {
              message: 'Cadastro aguardando aprovação do administrador.',
              code: 'ACCOUNT_PENDING',
            });
          }
          if (user.status === 'REJECTED') {
            throw new APIError('FORBIDDEN', {
              message: 'Cadastro recusado. Entre em contato com o administrador.',
              code: 'ACCOUNT_REJECTED',
            });
          }
          if (user.status === 'DISABLED') {
            throw new APIError('FORBIDDEN', {
              message: 'Conta desativada. Entre em contato com o administrador.',
              code: 'ACCOUNT_DISABLED',
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
