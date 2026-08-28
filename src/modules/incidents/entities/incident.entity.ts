import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import {
  IncidentCategory,
  IncidentSeverity,
  VerificationStatus,
} from '../../../common/enums/incident.enum';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { User } from '../../users/entities/user.entity';
import { WorkflowStage } from '../../workflow/entities/workflow-stage.entity';
import { IncidentImage } from './incident-image.entity';

@Entity('incidents')
export class Incident extends BaseEntity {
  @Column({ name: 'incident_code', unique: true })
  incidentCode: string;

  @Column({ name: 'organisation_id', nullable: true })
  @Index()
  organisationId: string | null;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisation_id' })
  organisation: Organisation;

  @Column({ name: 'reported_by_user_id' })
  reportedByUserId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reported_by_user_id' })
  reportedBy: User;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: IncidentCategory })
  category: IncidentCategory;

  @Column({ type: 'enum', enum: IncidentSeverity })
  severity: IncidentSeverity;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  @Index()
  verificationStatus: VerificationStatus;

  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true })
  currentStageId: string | null;

  @ManyToOne(() => WorkflowStage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'current_stage_id' })
  currentStage: WorkflowStage | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'duplicate_of_id', type: 'uuid', nullable: true })
  duplicateOfId: string | null;

  @ManyToOne(() => Incident, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'duplicate_of_id' })
  duplicateOf: Incident | null;

  @Column({ name: 'verified_by_user_id', type: 'uuid', nullable: true })
  verifiedByUserId: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @OneToMany(() => IncidentImage, (image) => image.incident)
  images: IncidentImage[];
}
