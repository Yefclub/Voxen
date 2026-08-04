import { describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  buildSsoCallbackUrl,
  decryptOidcConfig,
  emailMatchesSsoDomains,
  encryptOidcConfig,
  hasOidcIdentityBoundaryChange,
  isBlockedDirectSsoRoute,
  normalizeSsoDomains,
  parsePublicHttpsOidcUrl,
  redactSsoProvider,
  scrubFederatedAccountTokens,
  type StoredOidcConfig,
} from '../src/lib/sso-oidc';
import {
  assertOidcUrlResolvesPublic,
  buildStoredOidcConfig,
} from '../src/lib/sso-provider-service';
import {
  hasFreshRuntimeEndpointCache,
  invalidateRuntimeEndpointCache,
  rememberRuntimeEndpointCache,
} from '../src/lib/sso-runtime-endpoint-cache';

const OIDC_CONFIG: StoredOidcConfig = {
  issuer: 'https://id.example.com',
  discoveryEndpoint: 'https://id.example.com/.well-known/openid-configuration',
  authorizationEndpoint: 'https://id.example.com/oauth2/authorize',
  tokenEndpoint: 'https://id.example.com/oauth2/token',
  jwksEndpoint: 'https://id.example.com/.well-known/jwks.json',
  userInfoEndpoint: 'https://api.example.com/oidc/userinfo',
  tokenEndpointAuthentication: 'client_secret_basic',
  clientId: 'voxen-client',
  clientSecret: 'super-secret-value',
  pkce: true,
  scopes: ['openid', 'email', 'profile'],
};

describe('SSO OIDC domain contract', () => {
  it('normalizes, deduplicates and sorts configured domains', () => {
    expect(normalizeSsoDomains(' Example.COM,sub.example.com, example.com, ')).toEqual([
      'example.com',
      'sub.example.com',
    ]);
  });

  it('rejects empty, wildcard and URL-shaped domains', () => {
    expect(() => normalizeSsoDomains('')).toThrow();
    expect(() => normalizeSsoDomains('*.example.com')).toThrow();
    expect(() => normalizeSsoDomains('https://example.com/login')).toThrow();
  });

  it('matches the exact domain and its subdomains without suffix confusion', () => {
    expect(emailMatchesSsoDomains('person@example.com', ['example.com'])).toBe(true);
    expect(emailMatchesSsoDomains('person@team.example.com', ['example.com'])).toBe(true);
    expect(emailMatchesSsoDomains('person@notexample.com', ['example.com'])).toBe(false);
    expect(emailMatchesSsoDomains('not-an-email', ['example.com'])).toBe(false);
  });
});

describe('SSO OIDC secret boundary', () => {
  it('encrypts the complete provider config and decrypts only in memory', () => {
    const key = randomBytes(32);
    const encrypted = encryptOidcConfig(OIDC_CONFIG, key);
    expect(encrypted).not.toContain(OIDC_CONFIG.clientSecret);
    expect(encrypted.split('.')).toHaveLength(3);
    expect(decryptOidcConfig(encrypted, key)).toEqual(OIDC_CONFIG);
  });

  it('rejects decrypted values that do not satisfy the stored config contract', () => {
    const key = randomBytes(32);
    const malformed = encryptOidcConfig(
      { ...OIDC_CONFIG, tokenEndpointAuthentication: 'none' } as never,
      key,
    );
    expect(() => decryptOidcConfig(malformed, key)).toThrow('Configuração OIDC cifrada inválida.');

    const withoutPkce = encryptOidcConfig({ ...OIDC_CONFIG, pkce: false } as never, key);
    expect(() => decryptOidcConfig(withoutPkce, key)).toThrow(
      'Configuração OIDC cifrada inválida.',
    );
  });

  it('redacts client identifiers and never returns the secret', () => {
    const publicProvider = redactSsoProvider({
      id: 'provider-row',
      providerId: 'corporate',
      issuer: OIDC_CONFIG.issuer,
      domain: 'example.com',
      domainVerified: true,
      oidcConfig: OIDC_CONFIG,
      createdAt: new Date('2026-08-03T12:00:00.000Z'),
      updatedAt: new Date('2026-08-03T12:00:00.000Z'),
    });

    expect(publicProvider.clientIdLastFour).toBe('ient');
    expect(publicProvider.secretConfigured).toBe(true);
    expect(publicProvider.pkce).toBe(true);
    expect(publicProvider.configurationError).toBe(false);
    expect(publicProvider.callbackUrl).toBe(
      `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/api/auth/sso/callback/corporate`,
    );
    expect(JSON.stringify(publicProvider)).not.toContain(OIDC_CONFIG.clientSecret);
    expect(publicProvider).not.toHaveProperty('oidcConfig');
  });

  it('removes OIDC bearer material before account create or update', () => {
    expect(
      scrubFederatedAccountTokens({
        providerId: 'corporate',
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id-token',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
        scope: 'openid,email',
      }),
    ).toMatchObject({
      providerId: 'corporate',
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
    });
  });
});

describe('SSO OIDC route and endpoint policy', () => {
  it('blocks every direct plugin management surface but preserves sign-in and callbacks', () => {
    for (const path of [
      '/api/auth/sso/register',
      '/api/auth/sso/providers',
      '/api/auth/sso/get-provider',
      '/api/auth/sso/update-provider',
      '/api/auth/sso/delete-provider',
      '/api/auth/sso/request-domain-verification',
      '/api/auth/sso/verify-domain',
      '/api/auth/sso/saml2/sp/metadata',
    ]) {
      expect(isBlockedDirectSsoRoute(path)).toBe(true);
    }
    expect(isBlockedDirectSsoRoute('/api/auth/sign-in/sso')).toBe(false);
    expect(isBlockedDirectSsoRoute('/api/auth/sso/callback/corporate')).toBe(false);
    expect(isBlockedDirectSsoRoute('/api/auth/sso/callback')).toBe(true);
    expect(isBlockedDirectSsoRoute('/api/auth/sso%2fregister')).toBe(true);
    expect(isBlockedDirectSsoRoute('/api/auth/SSO/register')).toBe(true);
    expect(isBlockedDirectSsoRoute('//api/auth/sso/register')).toBe(true);
    expect(isBlockedDirectSsoRoute('/api/auth/sso/callback/corporate/extra')).toBe(true);
  });

  it('preserves an APP_BASE_URL path prefix in the displayed callback URL', () => {
    expect(buildSsoCallbackUrl('corporate', 'https://voxen.example.com/internal/')).toBe(
      'https://voxen.example.com/internal/api/auth/sso/callback/corporate',
    );
  });

  it('accepts only credential-free public HTTPS endpoint shapes', () => {
    expect(parsePublicHttpsOidcUrl('https://id.example.com/oauth2').origin).toBe(
      'https://id.example.com',
    );
    for (const value of [
      'http://id.example.com',
      'https://user:pass@id.example.com',
      'https://localhost:8443',
      'https://127.0.0.1',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:127.0.0.1]',
      'https://[64:ff9b::7f00:1]',
      'https://[64:ff9b:1::7f00:1]',
      'https://[2001:db8::1]',
      'https://metadata.google.internal',
      'file:///etc/passwd',
    ]) {
      expect(() => parsePublicHttpsOidcUrl(value)).toThrow();
    }
  });

  it('recognizes identity-boundary changes and ignores secret rotation', () => {
    expect(hasOidcIdentityBoundaryChange(OIDC_CONFIG, { ...OIDC_CONFIG })).toBe(false);
    expect(
      hasOidcIdentityBoundaryChange(OIDC_CONFIG, {
        ...OIDC_CONFIG,
        clientSecret: 'rotated-secret',
      }),
    ).toBe(false);
    expect(
      hasOidcIdentityBoundaryChange(OIDC_CONFIG, {
        ...OIDC_CONFIG,
        clientId: 'another-client',
      }),
    ).toBe(true);
    expect(
      hasOidcIdentityBoundaryChange(OIDC_CONFIG, {
        ...OIDC_CONFIG,
        issuer: 'https://other.example.com',
      }),
    ).toBe(true);
    expect(
      hasOidcIdentityBoundaryChange(OIDC_CONFIG, {
        ...OIDC_CONFIG,
        tokenEndpoint: 'https://id.example.com/oauth2/rotated-token',
        jwksEndpoint: 'https://id.example.com/.well-known/rotated-jwks.json',
      }),
    ).toBe(false);
    expect(
      hasOidcIdentityBoundaryChange(OIDC_CONFIG, {
        ...OIDC_CONFIG,
        mapping: { ...OIDC_CONFIG.mapping, id: 'employee_id' },
      }),
    ).toBe(true);
  });

  it('hydrates a provider through discovery while forcing the required scopes', async () => {
    const built = await buildStoredOidcConfig(
      {
        providerId: 'Corporate',
        issuer: 'https://id.example.com/',
        domains: 'Example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        scopes: ['groups'],
      },
      {
        lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
        discover: (async () => ({
          issuer: 'https://id.example.com',
          discoveryEndpoint: 'https://id.example.com/.well-known/openid-configuration',
          authorizationEndpoint: 'https://id.example.com/authorize',
          tokenEndpoint: 'https://id.example.com/token',
          jwksEndpoint: 'https://id.example.com/jwks',
          userInfoEndpoint: 'https://api.example.com/userinfo',
          tokenEndpointAuthentication: 'client_secret_basic',
        })) as never,
      },
    );
    expect(built.providerId).toBe('corporate');
    expect(built.domains).toEqual(['example.com']);
    expect(built.config.scopes).toEqual(['openid', 'email', 'profile', 'groups']);
    expect(built.config.clientSecret).toBe('client-secret');
    expect(built.config.userInfoEndpoint).toBeUndefined();
  });

  it('rejects attempts to disable mandatory PKCE', async () => {
    await expect(
      buildStoredOidcConfig({
        providerId: 'corporate',
        issuer: 'https://id.example.com',
        domains: 'example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        pkce: false,
      }),
    ).rejects.toThrow(/PKCE é obrigatório/i);
  });

  it('rejects provider identifiers reserved by local authentication', async () => {
    for (const providerId of ['credential', 'email']) {
      await expect(
        buildStoredOidcConfig({
          providerId,
          issuer: 'https://id.example.com',
          domains: 'example.com',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
      ).rejects.toThrow(/reservado/i);
    }
  });

  it('rejects DNS that resolves a syntactically public issuer to a private address', async () => {
    await expect(
      assertOidcUrlResolvesPublic(
        'https://id.example.com/.well-known/openid-configuration',
        async () => [{ address: '127.0.0.1', family: 4 }],
      ),
    ).rejects.toThrow(/não público/i);
  });

  it('caches only a matching runtime fingerprint within the short TTL', () => {
    const providerId = 'cache-contract';
    invalidateRuntimeEndpointCache(providerId);
    rememberRuntimeEndpointCache(providerId, 'fingerprint-a', 1_000);
    expect(hasFreshRuntimeEndpointCache(providerId, 'fingerprint-a', 30_999)).toBe(true);
    expect(hasFreshRuntimeEndpointCache(providerId, 'fingerprint-a', 31_000)).toBe(false);

    rememberRuntimeEndpointCache(providerId, 'fingerprint-a', 50_000);
    expect(hasFreshRuntimeEndpointCache(providerId, 'fingerprint-b', 50_001)).toBe(false);
    invalidateRuntimeEndpointCache(providerId);
    expect(hasFreshRuntimeEndpointCache(providerId, 'fingerprint-a', 50_001)).toBe(false);
  });
});
