// ============================================================================
// S3-compatible storage config
// ============================================================================
// `S3_*` é o formato canônico (MinIO no Easypanel/local, AWS S3, etc.).
// `GARAGE_*` permanece apenas como fallback de compatibilidade.
// ============================================================================

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

let cachedClient: S3Client | null = null;

export function s3Client(): S3Client {
  if (cachedClient) return cachedClient;

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

  const forcePathStyle = (envOr('S3_FORCE_PATH_STYLE') ?? 'true').toLowerCase() !== 'false';
  cachedClient = new S3Client({
    endpoint: envOr('S3_ENDPOINT', 'GARAGE_ENDPOINT') ?? 'http://minio:9000',
    region: envOr('S3_REGION', 'GARAGE_REGION') ?? 'us-east-1',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle,
  });
  return cachedClient;
}

export async function deleteS3Object(key: string): Promise<void> {
  if (process.env.S3_DELETE_DISABLED === 'true') return;
  await s3Client().send(
    new DeleteObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
    }),
  );
}
