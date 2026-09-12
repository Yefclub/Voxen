// ============================================================================
// S3-compatible storage config
// ============================================================================
// `S3_*` é o formato canônico (MinIO no Easypanel/local, AWS S3, etc.).
// `GARAGE_*` permanece apenas como fallback de compatibilidade.
// ============================================================================

import { S3Client } from '@aws-sdk/client-s3';
import { existsSync, readFileSync } from 'node:fs';

function envOr(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function readCredsFile(key: string): string | undefined {
  try {
    const path = envOr('S3_CREDS_PATH', 'GARAGE_CREDS_PATH') ?? '/creds/voxen.env';
    if (!existsSync(path)) return undefined;
    const content = readFileSync(path, 'utf-8');
    const line = content.split('\n').find((item) => item.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

export function s3Bucket(): string {
  return envOr('S3_BUCKET', 'GARAGE_BUCKET') ?? 'voxen-transcripts';
}

function s3ForcePathStyle(): boolean {
  return (envOr('S3_FORCE_PATH_STYLE') ?? 'true').toLowerCase() !== 'false';
}

function s3Region(): string {
  return envOr('S3_REGION', 'GARAGE_REGION') ?? 'us-east-1';
}

function s3Credentials(): { accessKeyId: string; secretAccessKey: string } {
  const accessKey =
    envOr('S3_ACCESS_KEY', 'GARAGE_ACCESS_KEY') ??
    readCredsFile('S3_ACCESS_KEY') ??
    readCredsFile('GARAGE_ACCESS_KEY');
  const secretKey =
    envOr('S3_SECRET_KEY', 'GARAGE_SECRET_KEY') ??
    readCredsFile('S3_SECRET_KEY') ??
    readCredsFile('GARAGE_SECRET_KEY');

  if (!accessKey || !secretKey) {
    throw new Error('S3 credenciais ausentes: defina S3_ACCESS_KEY e S3_SECRET_KEY');
  }
  return { accessKeyId: accessKey, secretAccessKey: secretKey };
}

let cachedClient: S3Client | null = null;

export function s3Client(): S3Client {
  if (cachedClient) return cachedClient;

  cachedClient = new S3Client({
    endpoint: envOr('S3_ENDPOINT', 'GARAGE_ENDPOINT') ?? 'http://minio:9000',
    region: s3Region(),
    credentials: s3Credentials(),
    forcePathStyle: s3ForcePathStyle(),
  });
  return cachedClient;
}

/**
 * Base URL do S3/MinIO alcançável pelo BROWSER (ex.: https://s3.dominio.com).
 * Distinto do `S3_ENDPOINT` interno (`http://minio:9000`), que só a rede Docker
 * enxerga. Quando ausente, o upload presigned fica indisponível e o front cai
 * no fluxo de upload via app.
 */
export function s3PublicEndpoint(): string | undefined {
  return envOr('S3_PUBLIC_ENDPOINT');
}

/** Indica se o upload presigned direto pro S3 está habilitado. */
export function presignEnabled(): boolean {
  return Boolean(s3PublicEndpoint());
}

let cachedPresignClient: S3Client | null = null;

/**
 * Client de presign: usa `S3_PUBLIC_ENDPOINT` como endpoint pra que a URL
 * assinada seja alcançável pelo browser. Mesmas credenciais/região/path-style
 * do client interno. Lança se `S3_PUBLIC_ENDPOINT` não estiver definido —
 * sempre cheque `presignEnabled()` antes de chamar.
 */
export function presignClient(): S3Client {
  if (cachedPresignClient) return cachedPresignClient;

  const endpoint = s3PublicEndpoint();
  if (!endpoint) {
    throw new Error('S3_PUBLIC_ENDPOINT ausente: upload presigned indisponível');
  }

  cachedPresignClient = new S3Client({
    endpoint,
    region: s3Region(),
    credentials: s3Credentials(),
    forcePathStyle: s3ForcePathStyle(),
  });
  return cachedPresignClient;
}
