import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('organisations/:organisationId/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get()
  list(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.eventsService.listForOrg(organisationId);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':eventId')
  findOne(@Param('organisationId', ParseUUIDPipe) organisationId: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.eventsService.findScoped(organisationId, eventId);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Post()
  create(@Param('organisationId', ParseUUIDPipe) organisationId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.eventsService.create(organisationId, user.id, dto);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Patch(':eventId/status')
  updateStatus(@Param('organisationId', ParseUUIDPipe) organisationId: string, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: UpdateEventStatusDto) {
    return this.eventsService.updateStatus(organisationId, eventId, dto.status);
  }
}