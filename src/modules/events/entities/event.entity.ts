import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EventStatus } from '../../../common/enums/event.enum';
import { Incident } from '../../incidents/entities/incident.entity';

@Entity('events')
export class Event extends BaseEntity {
  @Column({ name: 'organisation_id' })
  @Index()
  organisationId: string;

  @Column({ name: 'incident_ids', type: 'uuid', array: true })
  incidentIds: string[];

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ name: 'max_attendees', type: 'integer', nullable: true })
  maxAttendees: number | null;

  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.SCHEDULED })
  status: EventStatus;

  @Column({ name: 'created_by_user_id' })
  createdByUserId: string;

  incidents: Incident[];
  rsvps: unknown[];
}