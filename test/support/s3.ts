import 'dotenv/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Makes sure the configured media bucket exists on whatever S3-compatible store the
 * suite is pointed at — local MinIO in dev, adobe/s3mock in CI. Done here rather
 * than by a compose/CI init container, so a fresh store works with no extra step.
 */
export async function ensureMediaBucket(): Promise<void> {
  const client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'test',
    },
  });
  const Bucket = process.env.S3_BUCKET;
  try {
    await client.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket }));
  } finally {
    client.destroy();
  }
}

/** Reads one query parameter off a presigned URL. */
export function queryParam(url: string, name: string): string | null {
  return new URL(url).searchParams.get(name);
}
