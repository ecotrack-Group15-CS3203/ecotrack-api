import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

/** SRS 3.1.15. Kept here rather than in upload.config.ts so the multer path can be
 *  deleted wholesale later without taking this with it. */
export const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export interface UploadTarget {
  uploadUrl: string;
  mediaUrl: string;
  objectKey: string;
}

@Injectable()
export class MediaService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    this.bucket = this.config.get<string>('S3_BUCKET')!;

    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY')!,
      },
      // Both only apply to MinIO / other S3-compatible backends. Left undefined for
      // real AWS, where the SDK's own defaults are correct.
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.config.get<boolean>('S3_FORCE_PATH_STYLE') ?? false,
      // Without this the SDK bakes x-amz-sdk-checksum-algorithm / x-amz-checksum-crc32
      // query parameters into presigned URLs, obliging the uploading client to send a
      // matching precomputed checksum. Our clients are a phone and a browser doing a
      // plain PUT of an image; they send no such header. MinIO tolerates the mismatch,
      // real S3 need not, so the requirement is turned off rather than left to differ
      // between local and deployed.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

    this.publicBaseUrl = (
      this.config.get<string>('S3_PUBLIC_URL') ||
      (endpoint
        ? `${endpoint}/${this.bucket}`
        : `https://${this.bucket}.s3.${this.config.get<string>('S3_REGION')}.amazonaws.com`)
    ).replace(/\/$/, '');
  }

  /**
   * Issues a presigned PUT the client uploads to directly — no binary ever passes
   * through this API (SRS 3.1.15).
   *
   * The signature covers `content-type` (see `signableHeaders` below), so the client's
   * PUT **must** send exactly the same `Content-Type` it asked for here. A mismatch
   * fails as an opaque 403 with no useful body — the most common way this integration
   * breaks, and worth checking first when an upload fails for no evident reason.
   */
  async createUploadTarget(
    filename: string,
    contentType: string,
  ): Promise<UploadTarget> {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        `Unsupported content type "${contentType}". Allowed: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`,
      );
    }

    // Flat, opaque keys: the original filename is attacker-controlled, and a key
    // containing "/" would need a wildcard route to read back. Extension comes from
    // the validated content type, falling back to the filename's own only if unmapped.
    const objectKey = `${randomUUID()}${EXTENSION_BY_TYPE[contentType] ?? extname(filename) ?? ''}`;

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // Forces `content-type` into X-Amz-SignedHeaders. Without it the SDK signs
        // only `host`, the header is unbound, and the allow-list above becomes
        // advisory — a URL issued for image/jpeg would happily accept an HTML body.
        // With it, the header is part of the signature and a mismatch is rejected.
        signableHeaders: new Set(['content-type']),
      },
    );

    return {
      uploadUrl,
      mediaUrl: `${this.publicBaseUrl}/${objectKey}`,
      objectKey,
    };
  }

  /**
   * Short-lived read URL for a stored object. The bucket itself stays private — this
   * is the only way anything gets read out of it.
   */
  createDownloadUrl(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }
}
