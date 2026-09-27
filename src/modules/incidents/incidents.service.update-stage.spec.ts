import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantDbService } from '../../database/tenant-db.service';
import { createFakeDb, FakeDb } from '../../test-utils/fake-db';
import { AuditLogService } from '../audit/audit-log.service';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { IncidentsService } from './incidents.service';

/** SRS 3.1.21 incident status state machine: stage changes and optimistic locking. */
describe('IncidentsService.updateStage', () => {
  let fake: FakeDb;
  let audit: { record: jest.Mock };
  let service: IncidentsService;
  const incident = (over: Record<string, unknown> = {}) =>
    ({
      id: 'inc',
      organisationId: 'org',
      currentStageId: 'claimed',
      version: 3,
      ...over,
    }) as never;

  beforeEach(() => {
    fake = createFakeDb();
    audit = { record: jest.fn() };
    const stages = {
      listStages: jest.fn().mockResolvedValue([
        { id: 'reported', position: 0 },
        { id: 'claimed', position: 1 },
        { id: 'resolved', position: 2, isFinal: true },
      ]),
    };
    service = new IncidentsService(
      { db: fake.db } as unknown as TenantDbService,
      {} as NotificationsService,
      audit as unknown as AuditLogService,
      stages as unknown as WorkflowStagesService,
      {} as MediaService,
    );
  });

  it('refuses to stage an incident nobody has claimed (409)', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(incident({ organisationId: null }));
    await expect(
      service.updateStage('org', 'inc', { stageId: 'resolved' }, 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a stage that isn't in this organisation's workflow (422)", async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(incident());
    await expect(
      service.updateStage('org', 'inc', { stageId: 'foreign' }, 'admin'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('does nothing, and audits nothing, when the stage is unchanged', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(incident());
    await service.updateStage('org', 'inc', { stageId: 'claimed' }, 'admin');
    expect(fake.calls.some((c) => c.method === 'update')).toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('allows moving backwards, out of a final stage', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(incident({ currentStageId: 'resolved' }));
    fake.nextResult([incident({ currentStageId: 'reported', version: 4 })]);
    await expect(
      service.updateStage('org', 'inc', { stageId: 'reported' }, 'admin'),
    ).resolves.toMatchObject({ currentStageId: 'reported' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'incident.stage_changed' }),
    );
  });

  it('returns 409 when someone else changed the incident first (optimistic lock)', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(incident());
    fake.nextResult([]); // UPDATE ... WHERE version = expectedVersion matched no row
    await expect(
      service.updateStage(
        'org',
        'inc',
        { stageId: 'resolved', expectedVersion: 2 },
        'admin',
      ),
    ).rejects.toThrow(
      new ConflictException(
        'Incident status was modified concurrently; please refresh and retry.',
      ),
    );
  });
});
