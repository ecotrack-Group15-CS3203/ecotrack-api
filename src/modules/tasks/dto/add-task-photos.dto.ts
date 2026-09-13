import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
} from 'class-validator';

/**
 * SRS 3.1.16: up to five "after" photos, uploaded straight to S3 beforehand via
 * POST /v1/media/upload-url — the same presigned flow incident photos use, so no
 * binary passes through the API.
 */
export class AddTaskPhotosDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  mediaUrls: string[];
}
