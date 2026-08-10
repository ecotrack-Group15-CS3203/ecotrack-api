import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { incidentImageUploadOptions } from '../../common/config/upload.config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentsService } from './incidents.service';

/**
 * No `:organisationId` in these routes — incidents enter the Global Incident Pool
 * unowned (SRS 3.1.2/3.1.21). Org-scoped actions on already-claimed incidents
 * (list, reject, mark-duplicate) live in org-incidents.controller.ts instead; pool
 * browsing/claiming lives in incident-pool.controller.ts.
 */
@ApiTags('incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Roles(UserRole.CITIZEN, UserRole.VOLUNTEER, UserRole.ORG_ADMIN)
  @ApiConsumes('multipart/form-data')
  @Post()
  @UseInterceptors(FilesInterceptor('images', 5, incidentImageUploadOptions))
  create(
    @Body() dto: CreateIncidentDto,
    @UploadedFiles() images: Express.Multer.File[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const imageUrls = (images ?? []).map(
      (file) => `/uploads/incidents/${file.filename}`,
    );
    return this.incidentsService.create(user.id, dto, imageUrls);
  }

  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.findMyReports(user.id);
  }

  /**
   * Visibility is entirely RLS-enforced (see incidents.service.ts's findById doc
   * comment) — no role restriction needed here, every authenticated role can hit this
   * route, the database decides what's actually visible to them.
   */
  @Get(':incidentId')
  findOne(@Param('incidentId', ParseUUIDPipe) incidentId: string) {
    return this.incidentsService.findByIdWithImages(incidentId);
  }
}
