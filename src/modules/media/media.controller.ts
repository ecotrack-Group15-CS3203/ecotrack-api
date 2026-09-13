import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { TenantDbService } from '../../database/tenant-db.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly tenantDb: TenantDbService,
  ) {}

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

  /**
   * Object keys are unguessable UUIDs, but that is obscurity, not authorization —
   * without this check any authenticated user who obtained a key by any means could
   * mint a presigned GET for it. Confirm the key is actually attached to something
   * this caller may view before ever asking S3 for a URL.
   *
   * Two independent checks, either of which is sufficient:
   *  - a task_photos or incident_images row visible through the caller's normal
   *    RLS-scoped session (their own org's task evidence, their own reports, an
   *    incident their org has claimed);
   *  - an incident_images row on a hazard that would also appear on the public map
   *    (incidents.service.ts's findNearby) — a thumbnail shown to every citizen
   *    would otherwise resolve to a key nobody but that one tenant could actually
   *    open, which isn't a tighter rule than the map itself, just an inconsistent one.
   */
  @Get(':objectKey')
  @ApiOperation({
    summary: 'Short-lived presigned GET URL for a stored object',
  })
  async getDownloadUrl(@Param('objectKey') objectKey: string) {
    const suffix = `%${objectKey}`;

    const [ownVisible] = (
      await this.tenantDb.db.execute<{ found: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM incident_images WHERE url LIKE ${suffix}
          UNION ALL
          SELECT 1 FROM task_photos WHERE url LIKE ${suffix}
        ) AS found
      `)
    ).rows;

    if (!ownVisible.found) {
      await this.tenantDb.db.execute(
        sql`SELECT set_config('app.public_map_read', 'true', true)`,
      );
      const [publiclyVisible] = (
        await this.tenantDb.db.execute<{ found: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1
            FROM incident_images ii
            JOIN incidents i ON i.id = ii.incident_id
            WHERE ii.url LIKE ${suffix}
              AND (i.verification_status IS NULL OR i.verification_status = 'approved')
          ) AS found
        `)
      ).rows;
      if (!publiclyVisible.found) {
        throw new NotFoundException('Object not found');
      }
    }

    return { url: await this.mediaService.createDownloadUrl(objectKey) };
  }
}
