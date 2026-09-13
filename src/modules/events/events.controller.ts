import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQuery } from './dto/list-events.query';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { EventsService } from './events.service';

/** SRS 3.1.7/3.1.9. */
@ApiTags('events')
@ApiBearerAuth()
@Controller('organisations/:organisationId/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Roles(UserRole.ORG_ADMIN)
  @Post()
  create(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.create(organisationId, user.id, dto);
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.VOLUNTEER, PLATFORM_ADMIN)
  @Get()
  findAll(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEventsQuery,
  ) {
    return this.eventsService.listForOrganisation(
      organisationId,
      user.id,
      query,
      query.status,
    );
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.VOLUNTEER, PLATFORM_ADMIN)
  @Get(':eventId')
  findOne(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.eventsService.findScoped(organisationId, eventId);
  }

  @Roles(UserRole.ORG_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':eventId/status')
  updateStatus(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.updateStatus(
      organisationId,
      eventId,
      dto.status,
      user.id,
    );
  }

  @Roles(UserRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Post(':eventId/rsvp')
  rsvp(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.rsvp(organisationId, eventId, user.id);
  }

  @Roles(UserRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Delete(':eventId/rsvp')
  cancelRsvp(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.cancelRsvp(organisationId, eventId, user.id);
  }
}
