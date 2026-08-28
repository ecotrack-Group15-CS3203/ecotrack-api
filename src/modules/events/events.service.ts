import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventStatus } from '../../common/enums/event.enum';
import { Incident } from '../incidents/entities/incident.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { Event } from './entities/event.entity';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event) private readonly eventsRepository: Repository<Event>,
    @InjectRepository(Incident) private readonly incidentsRepository: Repository<Incident>,
  ) {}

  async listForOrg(organisationId: string): Promise<Event[]> {
    const events = await this.eventsRepository.find({
      where: { organisationId },
      order: { scheduledAt: 'ASC' },
    });
    return this.withIncidents(events, organisationId);
  }

  async findScoped(organisationId: string, eventId: string): Promise<Event> {
    const event = await this.eventsRepository.findOne({ where: { id: eventId, organisationId } });
    if (!event) throw new NotFoundException('Event not found');
    return (await this.withIncidents([event], organisationId))[0];
  }

  async create(organisationId: string, createdByUserId: string, dto: CreateEventDto): Promise<Event> {
    const incidents = await this.incidentsRepository.find({
      where: { id: In(dto.incidentIds), organisationId, verificationStatus: 'approved' as never },
    });
    if (incidents.length !== dto.incidentIds.length) {
      throw new BadRequestException('Events can only link to approved incidents in this organisation');
    }
    const event = await this.eventsRepository.save(this.eventsRepository.create({
      organisationId,
      createdByUserId,
      incidentIds: dto.incidentIds,
      title: dto.title,
      description: dto.description,
      latitude: dto.latitude,
      longitude: dto.longitude,
      address: dto.address ?? null,
      scheduledAt: new Date(dto.scheduledAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      maxAttendees: dto.maxAttendees ?? null,
      status: EventStatus.SCHEDULED,
    }));
    return (await this.withIncidents([event], organisationId))[0];
  }

  async updateStatus(organisationId: string, eventId: string, status: EventStatus): Promise<Event> {
    const event = await this.findScoped(organisationId, eventId);
    event.status = status;
    await this.eventsRepository.save(event);
    return event;
  }

  private async withIncidents(events: Event[], organisationId: string): Promise<Event[]> {
    const ids = events.flatMap((event) => event.incidentIds);
    const incidents = ids.length === 0 ? [] : await this.incidentsRepository.find({ where: { id: In(ids), organisationId } });
    const byId = new Map(incidents.map((incident) => [incident.id, incident]));
    return events.map((event) => ({ ...event, incidents: event.incidentIds.map((id) => byId.get(id)).filter(Boolean), rsvps: [] } as Event));
  }
}