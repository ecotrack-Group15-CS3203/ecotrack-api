import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organisation } from '../../organisations/entities/organisation.entity';

@Entity('workflow_stages')
@Unique(['organisationId', 'position'])
export class WorkflowStage extends BaseEntity {
  @Column({ name: 'organisation_id' })
  @Index()
  organisationId: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisation_id' })
  organisation: Organisation;

  @Column()
  name: string;

  /** Zero-based order of this stage within the organisation's workflow. */
  @Column({ type: 'int' })
  position: number;

  @Column({ name: 'is_final', default: false })
  isFinal: boolean;
}
