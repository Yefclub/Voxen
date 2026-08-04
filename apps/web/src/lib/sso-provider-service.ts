import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { discoverOIDCConfig } from '@better-auth/sso';
import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { getMasterKey } from './master-key';
import {
  decryptOidcConfig,
  CLEARED_FEDERATED_ACCOUNT_TOKENS,
  encryptOidcConfig,
  hasOidcIdentityBoundaryChange,
  isPublicOidcHostname,
  normalizeSsoDomains,
  parsePublicHttpsOidcUrl,
  redactSsoProvider,
  REQUIRED_OIDC_SCOPES,
  type StoredOidcConfig,
} from './sso-oidc';
import {
  hasFreshRuntimeEndpointCache,
  invalidateRuntimeEndpointCache,
  rememberRuntimeEndpointCache,
} from './sso-runtime-endpoint-cache';

const DOMAIN_VERIFICATION_PREFIX = 'voxen-sso-domain:';
const DNS_RECORD_PREFIX = '_voxen-sso';
const RESERVED_PROVIDER_IDS = new Set(['credential', 'email']);

export { listOidcProviders } from './sso-provider-list';

export class SsoProviderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 = 400,
  ) {
    super(message);
  }
}

function decryptManageableOidcConfig(ciphertext: string): StoredOidcConfig {
  const key = getMasterKey();
  try {
    return decryptOidcConfig(ciphertext, key);
  } catch {
    throw new SsoProviderError(
      'Configuração OIDC ilegível. Exclua o provedor e cadastre-o novamente.',
      409,
    );
  }
}

export interface OidcProviderInput {
  providerId: string;
  issuer: string;
  domains: string[] | string;
  clientId: string;
  clientSecret: string;
  pkce?: boolean;
  scopes?: string[];
}

interface NormalizedOidcProviderInput {
  providerId: string;
  issuer: string;
  domains: string[];
  clientId: string;
  clientSecret: string;
  pkce: boolean;
  scopes: string[];
}

type LookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<{ address: string; family: number }[]>;

export interface OidcDiscoveryDependencies {
  lookupAll?: LookupAll;
  discover?: typeof discoverOIDCConfig;
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(normalized)) {
    throw new SsoProviderError(
      'Identificador inválido. Use 2–63 caracteres minúsculos, números, hífen ou underscore.',
    );
  }
  if (RESERVED_PROVIDER_IDS.has(normalized)) {
    throw new SsoProviderError('Identificador reservado pelo Voxen.');
  }
  return normalized;
}

function normalizeScopes(value: string[] | undefined): string[] {
  const requested = value ?? [];
  if (
    requested.some(
      (scope) =>
        typeof scope !== 'string' ||
        scope.length === 0 ||
        scope.length > 100 ||
        !/^[a-zA-Z0-9_:./-]+$/.test(scope),
    )
  ) {
    throw new SsoProviderError('Escopo OIDC inválido.');
  }
  return [...new Set([...REQUIRED_OIDC_SCOPES, ...requested])];
}

function normalizeIssuer(value: string): string {
  const url = parsePublicHttpsOidcUrl(value.trim());
  if (url.search || url.hash) {
    throw new SsoProviderError('Issuer OIDC não pode conter query string ou fragmento.');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeProviderInput(input: OidcProviderInput): NormalizedOidcProviderInput {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!clientId || clientId.length > 512) throw new SsoProviderError('Client ID inválido.');
  if (clientSecret.length < 8 || clientSecret.length > 4096) {
    throw new SsoProviderError('Client secret deve ter entre 8 e 4096 caracteres.');
  }
  if (input.pkce === false) {
    throw new SsoProviderError('PKCE é obrigatório para provedores OIDC.');
  }
  return {
    providerId: normalizeProviderId(input.providerId),
    issuer: normalizeIssuer(input.issuer),
    domains: normalizeSsoDomains(input.domains),
    clientId,
    clientSecret,
    pkce: true,
    scopes: normalizeScopes(input.scopes),
  };
}

export async function assertOidcUrlResolvesPublic(
  value: string,
  lookupAll: LookupAll = (hostname, options) => lookup(hostname, options),
): Promise<URL> {
  const url = parsePublicHttpsOidcUrl(value);
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) return url;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookupAll(url.hostname, { all: true });
  } catch {
    throw new SsoProviderError(`Não foi possível resolver o host OIDC ${url.hostname}.`, 502);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicOidcHostname(address))) {
    throw new SsoProviderError(`O host OIDC ${url.hostname} resolve para endereço não público.`);
  }
  return url;
}

export async function buildStoredOidcConfig(
  input: OidcProviderInput,
  dependencies: OidcDiscoveryDependencies = {},
): Promise<{ providerId: string; domains: string[]; config: StoredOidcConfig }> {
  const normalized = normalizeProviderInput(input);
  const discoveryEndpoint = `${normalized.issuer}/.well-known/openid-configuration`;
  await assertOidcUrlResolvesPublic(discoveryEndpoint, dependencies.lookupAll);

  const isSyntacticallyTrusted = (value: string): boolean => {
    try {
      parsePublicHttpsOidcUrl(value);
      return true;
    } catch {
      return false;
    }
  };
  let discovered: Awaited<ReturnType<typeof discoverOIDCConfig>>;
  try {
    discovered = await (dependencies.discover ?? discoverOIDCConfig)({
      issuer: normalized.issuer,
      discoveryEndpoint,
      isTrustedOrigin: isSyntacticallyTrusted,
      timeout: 10_000,
    });
  } catch (error) {
    throw new SsoProviderError(
      `Falha na descoberta OIDC: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  const endpointValues = [
    discovered.discoveryEndpoint,
    discovered.authorizationEndpoint,
    discovered.tokenEndpoint,
    discovered.jwksEndpoint,
    discovered.userInfoEndpoint,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  await Promise.all(
    endpointValues.map((endpoint) => assertOidcUrlResolvesPublic(endpoint, dependencies.lookupAll)),
  );

  if (
    !discovered.authorizationEndpoint ||
    !discovered.tokenEndpoint ||
    !discovered.jwksEndpoint ||
    !discovered.discoveryEndpoint
  ) {
    throw new SsoProviderError('Descoberta OIDC incompleta.');
  }
  const tokenEndpointAuthentication = discovered.tokenEndpointAuthentication;
  if (
    tokenEndpointAuthentication !== 'client_secret_basic' &&
    tokenEndpointAuthentication !== 'client_secret_post'
  ) {
    throw new SsoProviderError('Método de autenticação do token endpoint não suportado.');
  }

  return {
    providerId: normalized.providerId,
    domains: normalized.domains,
    config: {
      issuer: normalized.issuer,
      discoveryEndpoint: discovered.discoveryEndpoint,
      authorizationEndpoint: discovered.authorizationEndpoint,
      tokenEndpoint: discovered.tokenEndpoint,
      jwksEndpoint: discovered.jwksEndpoint,
      // Prefer the signed OIDC ID token. The upstream plugin otherwise fetches
      // UserInfo with redirect-following semantics, which would weaken the
      // fail-closed endpoint policy enforced for token and JWKS requests.
      userInfoEndpoint: undefined,
      tokenEndpointAuthentication,
      clientId: normalized.clientId,
      clientSecret: normalized.clientSecret,
      pkce: normalized.pkce,
      scopes: normalized.scopes,
      mapping: {
        id: 'sub',
        email: 'email',
        emailVerified: 'email_verified',
        name: 'name',
        image: 'picture',
      },
    },
  };
}

function domainsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((a) => right.some((b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));
}

async function withSsoProviderLock<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('voxen:sso-providers'))");
    return operation(tx);
  });
}

async function assertDomainsAvailable(
  tx: Prisma.TransactionClient,
  domains: string[],
  excludingId?: string,
): Promise<void> {
  const existing = await tx.ssoProvider.findMany({
    where: { disabledAt: null, ...(excludingId ? { id: { not: excludingId } } : {}) },
    select: { providerId: true, domain: true },
  });
  const conflict = existing.find((provider) =>
    domainsOverlap(domains, normalizeSsoDomains(provider.domain)),
  );
  if (conflict) {
    throw new SsoProviderError(`Domínio já coberto pelo provedor ${conflict.providerId}.`, 409);
  }
}

export async function createOidcProvider(
  input: OidcProviderInput,
  actorUserId: string,
  dependencies: OidcDiscoveryDependencies = {},
): Promise<ReturnType<typeof redactSsoProvider>> {
  const built = await buildStoredOidcConfig(input, dependencies);
  try {
    const row = await withSsoProviderLock(async (tx) => {
      await assertDomainsAvailable(tx, built.domains);
      return tx.ssoProvider.create({
        data: {
          providerId: built.providerId,
          issuer: built.config.issuer,
          domain: built.domains.join(','),
          domainVerified: false,
          oidcConfig: encryptOidcConfig(built.config, getMasterKey()),
          userId: actorUserId,
        },
      });
    });
    invalidateRuntimeEndpointCache(built.providerId);
    return redactSsoProvider({ ...row, oidcConfig: built.config });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new SsoProviderError('Identificador de provedor já utilizado.', 409);
    }
    throw error;
  }
}

export async function updateOidcProvider(
  providerId: string,
  patch: Partial<Omit<OidcProviderInput, 'providerId'>>,
  dependencies: OidcDiscoveryDependencies = {},
): Promise<ReturnType<typeof redactSsoProvider>> {
  const existing = await db.ssoProvider.findUnique({ where: { providerId } });
  if (!existing || !existing.oidcConfig || existing.disabledAt) {
    throw new SsoProviderError('Provedor OIDC não encontrado.', 404);
  }
  const current = decryptManageableOidcConfig(existing.oidcConfig);
  const built = await buildStoredOidcConfig(
    {
      providerId,
      issuer: patch.issuer ?? current.issuer,
      domains: patch.domains ?? normalizeSsoDomains(existing.domain),
      clientId: patch.clientId ?? current.clientId,
      clientSecret: patch.clientSecret?.trim() || current.clientSecret,
      pkce: patch.pkce ?? current.pkce,
      scopes: patch.scopes ?? current.scopes,
    },
    dependencies,
  );
  const row = await withSsoProviderLock(async (tx) => {
    const locked = await tx.ssoProvider.findUnique({ where: { providerId } });
    if (!locked || !locked.oidcConfig || locked.disabledAt) {
      throw new SsoProviderError('Provedor OIDC não encontrado.', 404);
    }
    if (
      locked.updatedAt.getTime() !== existing.updatedAt.getTime() ||
      locked.oidcConfig !== existing.oidcConfig
    ) {
      throw new SsoProviderError(
        'O provedor foi alterado por outro administrador. Recarregue e tente novamente.',
        409,
      );
    }
    const lockedConfig = decryptManageableOidcConfig(locked.oidcConfig);
    const linkedAccounts = await tx.account.count({ where: { providerId } });
    if (linkedAccounts > 0 && hasOidcIdentityBoundaryChange(lockedConfig, built.config)) {
      throw new SsoProviderError(
        'Não é possível alterar a fronteira de identidade enquanto houver contas vinculadas.',
        409,
      );
    }
    await assertDomainsAvailable(tx, built.domains, locked.id);
    const domainsChanged = built.domains.join(',') !== locked.domain;
    if (domainsChanged) {
      await tx.verification.deleteMany({
        where: { identifier: `${DOMAIN_VERIFICATION_PREFIX}${providerId}` },
      });
    }
    return tx.ssoProvider.update({
      where: { id: locked.id },
      data: {
        issuer: built.config.issuer,
        domain: built.domains.join(','),
        domainVerified: domainsChanged ? false : locked.domainVerified,
        oidcConfig: encryptOidcConfig(built.config, getMasterKey()),
      },
    });
  });
  invalidateRuntimeEndpointCache(providerId);
  return redactSsoProvider({ ...row, oidcConfig: built.config });
}

export async function disableOidcProvider(providerId: string): Promise<void> {
  await withSsoProviderLock(async (tx) => {
    const existing = await tx.ssoProvider.findUnique({ where: { providerId } });
    if (!existing || existing.disabledAt)
      throw new SsoProviderError('Provedor OIDC não encontrado.', 404);
    await tx.verification.deleteMany({
      where: { identifier: `${DOMAIN_VERIFICATION_PREFIX}${providerId}` },
    });
    const tombstoneProviderId = `disabled:${existing.id}`;
    // Release the public providerId without allowing a different issuer to
    // inherit the old immutable subject links. A recreated provider links the
    // same Voxen user again through its verified email and keeps the workspace.
    await tx.account.updateMany({
      where: { providerId },
      data: { providerId: tombstoneProviderId, ...CLEARED_FEDERATED_ACCOUNT_TOKENS },
    });
    await tx.ssoProvider.update({
      where: { id: existing.id },
      data: {
        providerId: tombstoneProviderId,
        oidcConfig: null,
        domainVerified: false,
        disabledAt: new Date(),
      },
    });
  });
  invalidateRuntimeEndpointCache(providerId);
}

export async function requestOidcDomainVerification(providerId: string): Promise<{
  records: { name: string; type: 'TXT'; value: string }[];
}> {
  const provider = await db.ssoProvider.findUnique({ where: { providerId } });
  if (!provider || !provider.oidcConfig || provider.disabledAt) {
    throw new SsoProviderError('Provedor OIDC não encontrado.', 404);
  }
  const domains = normalizeSsoDomains(provider.domain);
  const identifier = `${DOMAIN_VERIFICATION_PREFIX}${providerId}`;
  const token = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`;
    const existing = await tx.verification.findFirst({
      where: { identifier, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing.value;

    await tx.verification.deleteMany({ where: { identifier } });
    const created = await tx.verification.create({
      data: {
        identifier,
        value: randomBytes(24).toString('base64url'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return created.value;
  });
  return {
    records: domains.map((domain) => ({
      name: `${DNS_RECORD_PREFIX}-${providerId}.${domain}`,
      type: 'TXT' as const,
      value: token,
    })),
  };
}

export async function verifyOidcDomains(
  providerId: string,
  resolveTxt: (hostname: string) => Promise<string[][]>,
): Promise<void> {
  const provider = await db.ssoProvider.findUnique({ where: { providerId } });
  if (!provider || !provider.oidcConfig || provider.disabledAt) {
    throw new SsoProviderError('Provedor OIDC não encontrado.', 404);
  }
  const identifier = `${DOMAIN_VERIFICATION_PREFIX}${providerId}`;
  const challenge = await db.verification.findFirst({
    where: { identifier, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge) throw new SsoProviderError('Solicite um novo desafio de verificação.');
  for (const domain of normalizeSsoDomains(provider.domain)) {
    let records: string[][];
    try {
      records = await resolveTxt(`${DNS_RECORD_PREFIX}-${providerId}.${domain}`);
    } catch {
      throw new SsoProviderError(`Registro TXT ainda não encontrado para ${domain}.`, 409);
    }
    if (!records.some((parts) => parts.join('') === challenge.value)) {
      throw new SsoProviderError(`Registro TXT inválido para ${domain}.`, 409);
    }
  }
  await db.$transaction([
    db.ssoProvider.update({ where: { id: provider.id }, data: { domainVerified: true } }),
    db.verification.deleteMany({ where: { identifier } }),
  ]);
}

export async function assertProviderRuntimeEndpointsPublic(
  providerId: string,
  lookupAll?: LookupAll,
): Promise<void> {
  const provider = await db.ssoProvider.findUnique({ where: { providerId } });
  if (!provider || !provider.oidcConfig || provider.disabledAt || !provider.domainVerified) {
    throw new SsoProviderError('Provedor OIDC indisponível.', 404);
  }
  const fingerprint = `${provider.updatedAt.getTime()}:${provider.oidcConfig}`;
  // Injected resolvers are used by deterministic security tests and must never
  // inherit a previous result. Runtime requests use a short positive-only cache
  // to bound unauthenticated decrypt/DNS work without masking configuration
  // changes (updatedAt + ciphertext form the fingerprint).
  if (!lookupAll && hasFreshRuntimeEndpointCache(providerId, fingerprint)) return;
  const config = decryptOidcConfig(provider.oidcConfig, getMasterKey());
  const endpoints = [
    config.issuer,
    config.discoveryEndpoint,
    config.authorizationEndpoint,
    config.tokenEndpoint,
    config.jwksEndpoint,
    config.userInfoEndpoint,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  await Promise.all(endpoints.map((endpoint) => assertOidcUrlResolvesPublic(endpoint, lookupAll)));
  if (!lookupAll) rememberRuntimeEndpointCache(providerId, fingerprint);
}
