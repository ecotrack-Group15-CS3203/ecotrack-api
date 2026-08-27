import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * No @Roles: any authenticated user may upload, because reporting an incident is
   * open to every role (SRS 3.1.2). Authorization for what an uploaded object is then
   * *attached to* is enforced by the endpoint that consumes the returned mediaUrl.
   */
  @Post('upload-url')
  @ApiOperation({ summary: 'Presigned S3 PUT URL for a direct client upload' })
  createUploadUrl(@Body() dto: CreateUploadUrlDto) {
    return this.mediaService.createUploadTarget(dto.filename, dto.contentType);
  }

  @Get(':objectKey')
  @ApiOperation({
    summary: 'Short-lived presigned GET URL for a stored object',
  })
  async getDownloadUrl(@Param('objectKey') objectKey: string) {
    return { url: await this.mediaService.createDownloadUrl(objectKey) };
  }
}
