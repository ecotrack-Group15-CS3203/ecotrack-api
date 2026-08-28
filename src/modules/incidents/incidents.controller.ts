import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { incidentImageUploadOptions } from '../../common/config/upload.config';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { VerificationStatus } from '../../common/enums/incident.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { MarkDuplicateDto } from './dto/mark-duplicate.dto';
import { RejectIncidentDto } from './dto/reject-incident.dto';
import { OrganisationMember } from '../organisations/entities/organisation-member.entity';
import { IncidentsService } from './incidents.service';

@ApiTags('incidents')
@ApiBearerAuth()
@Controller('organisations/:organisationId/incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Roles(MembershipRole.COMMUNITY_USER)
  @ApiConsumes('multipart/form-data')
  @Post()
  @UseInterceptors(FilesInterceptor('images', 5, incidentImageUploadOptions))
  create(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateIncidentDto,
    @UploadedFiles() images: Express.Multer.File[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const imageUrls = (images ?? []).map(
      (file) => `/uploads/incidents/${file.filename}`,
    );
    return this.incidentsService.create(
      organisationId,
      user.id,
      dto,
      imageUrls,
    );
  }

  @Roles(MembershipRole.COMMUNITY_USER)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.findMyReports(user.id);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get('incident-pool')
  findPool() {
    return this.incidentsService.listPool();
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @Post(':incidentId/claim')
  claim(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidentsService.claim(organisationId, incidentId, user.id);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get()
  findAll(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query('status') status?: VerificationStatus,
  ) {
    return this.incidentsService.listForOrg(organisationId, status);
  }

  @Roles(
    MembershipRole.COMMUNITY_USER,
    MembershipRole.ORG_ADMIN,
    PLATFORM_ADMIN,
  )
  @Get(':incidentId')
  async findOne(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() membership?: OrganisationMember,
  ) {
    const incident = await this.incidentsService.findScoped(
      organisationId,
      incidentId,
    );
    const isOwner = incident.reportedByUserId === user.id;
    const isOrgAdmin = membership?.role === MembershipRole.ORG_ADMIN;
    if (!isOwner && !isOrgAdmin && !user.isPlatformAdmin) {
      throw new ForbiddenException();
    }
    return incident;
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':incidentId/approve')
  approve(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidentsService.approve(organisationId, incidentId, user.id);
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':incidentId/reject')
  reject(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() dto: RejectIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidentsService.reject(
      organisationId,
      incidentId,
      user.id,
      dto.reason,
    );
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':incidentId/duplicate')
  markDuplicate(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() dto: MarkDuplicateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (dto.duplicateOfId === incidentId) {
      throw new BadRequestException('An incident cannot duplicate itself');
    }
    return this.incidentsService.markDuplicate(
      organisationId,
      incidentId,
      user.id,
      dto.duplicateOfId,
    );
  }
}
