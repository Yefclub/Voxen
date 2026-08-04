import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { decrypt, encrypt } from './crypto';
import { resolveAuthBaseURL } from './auth-base-url';

export const REQUIRED_OIDC_SCOPES = ['openid', 'email', 'profile'] as const;
export const CLEARED_FEDERATED_ACCOUNT_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
} as const;

export interface StoredOidcConfig {
  issuer: string;
  discoveryEndpoint: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
  userInfoEndpoint?: string;
  tokenEndpointAuthentication: 'client_secret_basic' | 'client_secret_post';
  clientId: string;
  clientSecret: string;
  pkce: boolean;
  scopes: string[];
  mapping?: {
    id?: string;
    email?: string;
    emailVerified?: string;
    name?: string;
    image?: string;
  };
}

const storedOidcConfigSchema = z
  .object({
    issuer: z.string().min(1),
    discoveryEndpoint: z.string().min(1),
    authorizationEndpoint: z.string().min(1),
    tokenEndpoint: z.string().min(1),
    jwksEndpoint: z.string().min(1),
    userInfoEndpoint: z.string().min(1).optional(),
    tokenEndpointAuthentication: z.enum(['client_secret_basic', 'client_secret_post']),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    pkce: z.literal(true),
    scopes: z.array(z.string().min(1)),
    mapping: z
      .object({
        id: z.string().min(1).optional(),
        email: z.string().min(1).optional(),
        emailVerified: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        image: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface SsoProviderForRedaction {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified: boolean;
  oidcConfig: StoredOidcConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicSsoProvider {
  id: string;
  providerId: string;
  issuer: string;
  domains: string[];
  domainVerified: boolean;
  clientIdLastFour: string;
  secretConfigured: boolean;
  pkce: true;
  scopes: string[];
  callbackUrl: string;
  configurationError: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeDomain(raw: string): string {
  const candidate = raw.trim().toLowerCase().replace(/\.$/, '');
  if (
    !candidate ||
    candidate.includes('://') ||
    candidate.includes('/') ||
    candidate.includes('*')
  ) {
    throw new Error('Domínio OIDC inválido. Informe somente o domínio, sem URL ou wildcard.');
  }
  const ascii = domainToASCII(candidate);
  if (!ascii || ascii.length > 253 || !ascii.includes('.')) {
    throw new Error('Domínio OIDC inválido.');
  }
  const labels = ascii.split('.');
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-') ||
        !/^[a-z0-9-]+$/.test(label),
    )
  ) {
    throw new Error('Domínio OIDC inválido.');
  }
  return ascii;
}

export function normalizeSsoDomains(value: string | string[]): string[] {
  const rawDomains = (Array.isArray(value) ? value : value.split(',')).filter(
    (domain) => domain.trim().length > 0,
  );
  const normalized = [...new Set(rawDomains.map(normalizeDomain))].sort();
  if (normalized.length === 0) throw new Error('Informe ao menos um domínio OIDC.');
  return normalized;
}

export function emailMatchesSsoDomains(email: string, domains: readonly string[]): boolean {
  const separator = email.lastIndexOf('@');
  if (separator <= 0 || separator === email.length - 1) return false;
  let emailDomain: string;
  try {
    emailDomain = normalizeDomain(email.slice(separator + 1));
  } catch {
    return false;
  }
  return domains.some((domain) => emailDomain === domain || emailDomain.endsWith(`.${domain}`));
}

export function encryptOidcConfig(config: StoredOidcConfig, key: Buffer): string {
  return encrypt(JSON.stringify(config), key);
}

export function decryptOidcConfig(value: string, key: Buffer): StoredOidcConfig {
  try {
    return storedOidcConfigSchema.parse(JSON.parse(decrypt(value, key)));
  } catch {
    throw new Error('Configuração OIDC cifrada inválida.');
  }
}

export function buildSsoCallbackUrl(
  providerId: string,
  baseUrl = resolveAuthBaseURL(process.env.APP_BASE_URL),
): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/auth/sso/callback/${encodeURIComponent(providerId)}`;
}

export function redactSsoProvider(provider: SsoProviderForRedaction): PublicSsoProvider {
  return {
    id: provider.id,
    providerId: provider.providerId,
    issuer: provider.issuer,
    domains: normalizeSsoDomains(provider.domain),
    domainVerified: provider.domainVerified,
    clientIdLastFour: provider.oidcConfig.clientId.slice(-4),
    secretConfigured: provider.oidcConfig.clientSecret.length > 0,
    pkce: true,
    scopes: [...provider.oidcConfig.scopes],
    callbackUrl: buildSsoCallbackUrl(provider.providerId),
    configurationError: false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function scrubFederatedAccountTokens<T extends Record<string, unknown>>(account: T): T {
  return {
    ...account,
    ...CLEARED_FEDERATED_ACCOUNT_TOKENS,
  };
}

export function isBlockedDirectSsoRoute(pathname: string): boolean {
  let normalized: string;
  try {
    normalized = decodeURIComponent(pathname);
  } catch {
    normalized = pathname;
  }
  normalized = `/${normalized.replace(/^\/+/, '')}`.toLowerCase();
  if (!normalized.startsWith('/api/auth/sso/')) return false;
  return !/^\/api\/auth\/sso\/callback\/[a-z0-9][a-z0-9_-]{1,62}\/?$/.test(normalized);
}

export function isPublicOidcHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    const address = ipaddr.parse(hostname);
    const normalized =
      address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()
        ? address.toIPv4Address()
        : address;
    return normalized.range() === 'unicast';
  }
  if (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    return false;
  }
  return domainToASCII(hostname).length > 0;
}

export function parsePublicHttpsOidcUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL OIDC inválida.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !isPublicOidcHostname(parsed.hostname)
  ) {
    throw new Error('Endpoint OIDC deve usar HTTPS público e não pode conter credenciais.');
  }
  return parsed;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

export function hasOidcIdentityBoundaryChange(
  current: StoredOidcConfig,
  updated: StoredOidcConfig,
): boolean {
  // Endpoints are discovered metadata transitively bound to the issuer. They
  // can rotate without changing who owns an identity, and must not prevent an
  // emergency client-secret rotation after accounts are linked.
  const fields: (keyof StoredOidcConfig)[] = ['issuer', 'clientId'];
  if (fields.some((field) => stable(current[field]) !== stable(updated[field]))) return true;
  return stable(current.mapping?.id ?? 'sub') !== stable(updated.mapping?.id ?? 'sub');
}
