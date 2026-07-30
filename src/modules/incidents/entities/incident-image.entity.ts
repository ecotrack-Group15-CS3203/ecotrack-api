import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Incident } from './incident.entity';

@Entity('incident_images')
export class IncidentImage extends BaseEntity {
  @Column({ name: 'incident_id' })
  @Index()
  incidentId: string;

  @ManyToOne(() => Incident, (incident) => incident.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @Column()
  url: string;
}
