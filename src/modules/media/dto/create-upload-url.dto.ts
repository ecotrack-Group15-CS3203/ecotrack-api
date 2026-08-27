import { IsString, MinLength } from 'class-validator';

export class CreateUploadUrlDto {
  /** Used only to derive a file extension when the content type is unmapped — the
   *  stored object key is always server-generated, never the client's filename. */
  @IsString()
  @MinLength(1)
  filename: string;

  /** Must match the Content-Type the client will send on the PUT exactly, or S3
   *  rejects the upload with a 403. Validated against the allow-list in MediaService. */
  @IsString()
  @MinLength(1)
  contentType: string;
}
