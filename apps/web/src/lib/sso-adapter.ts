import type { BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from './db';
import { getMasterKey } from './master-key';
import { decryptOidcConfig, emailMatchesSsoDomains, normalizeSsoDomains } from './sso-oidc';

type AdapterFactory = ReturnType<typeof prismaAdapter>;
type AuthAdapter = ReturnType<AdapterFactory>;
type TransactionAdapter = Parameters<Parameters<AuthAdapter['transaction']>[0]>[0];
type AdapterRecord = Record<string, unknown>;

function exposeProviderConfig(record: unknown): AdapterRecord | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const source = record as AdapterRecord;
  if (source.disabledAt != null || source.domainVerified !== true) return null;
  if (typeof source.oidcConfig !== 'string' || source.oidcConfig.length === 0) return null;

  let config;
  try {
    config = decryptOidcConfig(source.oidcConfig, getMasterKey());
  } catch {
    return null;
  }
  // Keep domainVerified visible to the plugin's own sign-in/callback guard.
  // Voxen independently requires the IdP's email_verified claim before it
  // provisions or links a user in the database hooks.
  const { disabledAt: _disabledAt, ...publicRecord } = source;
  return { ...publicRecord, oidcConfig: JSON.stringify(config) };
}

function domainLookup(args: Parameters<AuthAdapter['findOne']>[0]): string | null {
  const where = (args as { where?: unknown }).where;
  if (!Array.isArray(where)) return null;
  const condition = where.find(
    (candidate): candidate is { field: string; value: string } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { field?: unknown }).field === 'domain' &&
      typeof (candidate as { value?: unknown }).value === 'string',
  );
  return condition?.value ?? null;
}

function providerMatchesDomain(provider: AdapterRecord, domain: string): boolean {
  if (typeof provider.domain !== 'string') return false;
  try {
    return emailMatchesSsoDomains(`sso@${domain}`, normalizeSsoDomains(provider.domain));
  } catch {
    return false;
  }
}

function protectTransactionAdapter(adapter: TransactionAdapter): TransactionAdapter {
  return {
    ...adapter,
    async findOne<T>(args: Parameters<AuthAdapter['findOne']>[0]): Promise<T | null> {
      const result = await adapter.findOne<T>(args);
      if (args.model !== 'ssoProvider') return result;
      const exposed = exposeProviderConfig(result);
      if (exposed) return exposed as T;

      // Better Auth looks up an email domain with exact equality. Voxen stores
      // all domains in one row and deliberately allows subdomains, so retry the
      // lookup against active, verified providers using Voxen's domain policy.
      const domain = domainLookup(args);
      if (!domain) return null;
      // Plugin adapter schemas do not expose Voxen's disabledAt field. Query
      // Prisma directly so the fallback never scans disabled or unverified
      // provider secrets before applying the multi-domain policy.
      const providers = await db.ssoProvider.findMany({
        where: { domainVerified: true, disabledAt: null },
      });
      for (const provider of providers) {
        const candidate = exposeProviderConfig(provider);
        if (candidate && providerMatchesDomain(candidate, domain)) return candidate as T;
      }
      return null;
    },
    async findMany<T>(args: Parameters<AuthAdapter['findMany']>[0]): Promise<T[]> {
      const result = await adapter.findMany<T>(args);
      if (args.model !== 'ssoProvider') return result;
      return result.flatMap((record) => {
        const exposed = exposeProviderConfig(record);
        return exposed ? [exposed as T] : [];
      });
    },
    async create(args) {
      if (args.model === 'ssoProvider') {
        throw new Error('A gestão direta de provedores SSO está desativada.');
      }
      return adapter.create(args);
    },
    async update(args) {
      if (args.model === 'ssoProvider') {
        throw new Error('A gestão direta de provedores SSO está desativada.');
      }
      return adapter.update(args);
    },
    async updateMany(args) {
      if (args.model === 'ssoProvider') {
        throw new Error('A gestão direta de provedores SSO está desativada.');
      }
      return adapter.updateMany(args);
    },
    async delete(args) {
      if (args.model === 'ssoProvider') {
        throw new Error('A gestão direta de provedores SSO está desativada.');
      }
      return adapter.delete(args);
    },
    async deleteMany(args) {
      if (args.model === 'ssoProvider') {
        throw new Error('A gestão direta de provedores SSO está desativada.');
      }
      return adapter.deleteMany(args);
    },
  };
}

function protectSsoProviderWrites(adapter: AuthAdapter): AuthAdapter {
  return {
    ...protectTransactionAdapter(adapter),
    async transaction(callback) {
      return adapter.transaction((transactionAdapter) =>
        callback(protectTransactionAdapter(transactionAdapter)),
      );
    },
  };
}

/**
 * Better Auth receives plaintext OIDC config only from this in-memory adapter
 * boundary. All persistence and management continue through Voxen's encrypted
 * admin contract.
 */
export const encryptedSsoPrismaAdapter = (options: BetterAuthOptions): AuthAdapter => {
  const base = prismaAdapter(db, { provider: 'postgresql' })(options);
  return protectSsoProviderWrites(base);
};
