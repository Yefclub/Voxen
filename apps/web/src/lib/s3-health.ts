// HEAD no bucket S3 (MinIO/Garage/AWS) pra healthcheck deep.
// Importação tardia evita custo de SDK init no path normal.

import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { s3Bucket, s3Client } from './s3';

export async function headBucket(): Promise<void> {
  await s3Client().send(new HeadBucketCommand({ Bucket: s3Bucket() }));
}
