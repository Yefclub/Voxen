import type { SsoProvider } from '../../prisma-generated/client';
import { db } from './db';
import { getMasterKey } from './master-key';
import {
  buildSsoCallbackUrl,
  decryptOidcConfig,
  normalizeSsoDomains,
  redactSsoProvider,
  type PublicSsoProvider,
} from './sso-oidc';

function unreadableProvider(row: SsoProvider): PublicSsoProvider {
  let domains: string[];
  try {
    domains = normalizeSsoDomains(row.domain);
  } catch {
    domains = [];
  }
  return {
    id: row.id,
    providerId: row.providerId,
    issuer: row.issuer,
    domains,
    domainVerified: false,
    clientIdLastFour: '',
    secretConfigured: row.oidcConfig !== null,
    pkce: true,
    scopes: [],
    callbackUrl: buildSsoCallbackUrl(row.providerId),
    configurationError: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listOidcProviders(): Promise<PublicSsoProvider[]> {
  const rows = await db.ssoProvider.findMany({
    where: { disabledAt: null, oidcConfig: { not: null } },
    orderBy: { providerId: 'asc' },
  });
  const key = getMasterKey();
  return rows.map((row) => {
    try {
      return redactSsoProvider({
        ...row,
        oidcConfig: decryptOidcConfig(row.oidcConfig!, key),
      });
    } catch {
      return unreadableProvider(row);
    }
  });
}
