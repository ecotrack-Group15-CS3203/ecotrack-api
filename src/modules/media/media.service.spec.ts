import { ConfigService } from '@nestjs/config';
import { DOWNLOAD_URL_TTL_SECONDS, MediaService } from './media.service';

const MINIO_ENV: Record<string, string | boolean> = {
  S3_BUCKET: 'ecotrack-media',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'test-key',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_FORCE_PATH_STYLE: true,
  S3_PUBLIC_URL: 'http://localhost:9000/ecotrack-media',
};

const OBJECT_KEY = '3f1c2b9e-6a4d-4c1e-9b7a-2d5e8f0a1b3c.jpg';

function makeService(env: Record<string, string | boolean>) {
  return new MediaService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

describe('MediaService.signStoredUrl', () => {
  const service = makeService(MINIO_ENV);

  it('turns a stored object URL into a presigned GET for the same key', async () => {
    const signed = new URL(
      await service.signStoredUrl(
        `http://localhost:9000/ecotrack-media/${OBJECT_KEY}`,
      ),
    );
    expect(signed.origin).toBe('http://localhost:9000');
    expect(signed.pathname).toBe(`/ecotrack-media/${OBJECT_KEY}`);
    expect(signed.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(signed.searchParams.get('X-Amz-Expires')).toBe(
      String(DOWNLOAD_URL_TTL_SECONDS),
    );
  });

  it('resolves URLs stored under a different base, e.g. virtual-host style S3', async () => {
    const signed = new URL(
      await service.signStoredUrl(
        `https://old-bucket.s3.ap-southeast-1.amazonaws.com/${OBJECT_KEY}`,
      ),
    );
    expect(signed.pathname).toBe(`/ecotrack-media/${OBJECT_KEY}`);
  });

  it('round-trips the mediaUrl createUploadTarget hands out', async () => {
    const { mediaUrl, objectKey } = await service.createUploadTarget(
      'photo.png',
      'image/png',
    );
    const signed = new URL(await service.signStoredUrl(mediaUrl));
    expect(signed.pathname).toBe(`/ecotrack-media/${objectKey}`);
  });

  it('leaves URLs that are not our object keys untouched', async () => {
    const placeholder =
      'http://localhost:9000/ecotrack-media/seed-placeholder.jpg';
    await expect(service.signStoredUrl(placeholder)).resolves.toBe(placeholder);
    await expect(service.signStoredUrl('not a url')).resolves.toBe('not a url');
  });

  it('passes null through for incidents without a thumbnail', async () => {
    await expect(service.signStoredUrl(null)).resolves.toBeNull();
  });
});
