// HEAD no bucket S3 (Garage/MinIO/AWS) pra healthcheck deep.
// Importação tardia evita custo de SDK init no path normal.

import { existsSync, readFileSync } from 'node:fs';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

function envOr(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

function readCreds(key: string): string | undefined {
  try {
    const path = envOr('S3_CREDS_PATH', 'GARAGE_CREDS_PATH') ?? '/creds/voxen.env';
    if (!existsSync(path)) return undefined;
    const content = readFileSync(path, 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const accessKey =
    envOr('S3_ACCESS_KEY', 'GARAGE_ACCESS_KEY') ??
    readCreds('S3_ACCESS_KEY') ??
    readCreds('GARAGE_ACCESS_KEY');
  const secretKey =
    envOr('S3_SECRET_KEY', 'GARAGE_SECRET_KEY') ??
    readCreds('S3_SECRET_KEY') ??
    readCreds('GARAGE_SECRET_KEY');
  if (!accessKey || !secretKey) {
    throw new Error('S3 credenciais ausentes (S3_ACCESS_KEY/SECRET_KEY ou GARAGE_*)');
  }
  const forcePathStyle = (envOr('S3_FORCE_PATH_STYLE') ?? 'true').toLowerCase() !== 'false';
  _client = new S3Client({
    endpoint: envOr('S3_ENDPOINT', 'GARAGE_ENDPOINT') ?? 'http://garage:3900',
    region: envOr('S3_REGION', 'GARAGE_REGION') ?? 'garage',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle,
  });
  return _client;
}

export async function headBucket(): Promise<void> {
  const bucket = envOr('S3_BUCKET', 'GARAGE_BUCKET') ?? 'voxen-transcripts';
  await client().send(new HeadBucketCommand({ Bucket: bucket }));
}
