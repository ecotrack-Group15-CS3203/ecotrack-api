import { BadRequestException, ConflictException } from '@nestjs/common';
import { TenantDbService } from '../../database/tenant-db.service';
import { createFakeDb, FakeDb } from '../../test-utils/fake-db';
import { AuditLogService } from '../audit/audit-log.service';
import {
  WorkflowStageRow,
  WorkflowStagesService,
} from './workflow-stages.service';

/** SRS 3.1.13 dynamic workflow editor: reorder and delete rules. */
const stage = (id: string, position: number) =>
  ({
    id,
    name: id,
    position,
    organisationId: 'org',
    isFinal: false,
  }) as WorkflowStageRow;

describe('WorkflowStagesService', () => {
  let fake: FakeDb;
  let audit: { record: jest.Mock };
  let service: WorkflowStagesService;

  beforeEach(() => {
    fake = createFakeDb();
    audit = { record: jest.fn() };
    service = new WorkflowStagesService(
      { db: fake.db } as unknown as TenantDbService,
      audit as unknown as AuditLogService,
    );
  });

  describe('reorderStages', () => {
    beforeEach(() => {
      jest
        .spyOn(service, 'listStages')
        .mockResolvedValue([stage('a', 0), stage('b', 1), stage('c', 2)]);
    });

    it('requires every existing stage exactly once', async () => {
      await expect(
        service.reorderStages('org', ['a', 'b'], 'admin'),
      ).rejects.toThrow(
        new BadRequestException(
          'Reorder list must include every existing stage exactly once',
        ),
      );
    });

    it('rejects an unknown stage id', async () => {
      await expect(
        service.reorderStages('org', ['a', 'b', 'x'], 'admin'),
      ).rejects.toThrow(new BadRequestException('Unknown stage id: x'));
    });

    it('assigns positions in the requested order, one update at a time, and audits it', async () => {
      fake
        .nextResult([stage('c', 0)])
        .nextResult([stage('a', 1)])
        .nextResult([stage('b', 2)]);
      const result = await service.reorderStages(
        'org',
        ['c', 'a', 'b'],
        'admin',
      );

      expect(result.map((s) => s.id)).toEqual(['c', 'a', 'b']);
      const positions = fake.calls
        .filter((c) => c.method === 'set')
        .map((c) => (c.args[0] as { position: number }).position);
      expect(positions).toEqual([0, 1, 2]);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workflow_stage.reordered' }),
      );
    });
  });

  describe('deleteStage', () => {
    beforeEach(() => {
      jest.spyOn(service, 'findById').mockResolvedValue(stage('b', 1));
    });

    it('refuses to delete a stage that incidents are currently in (409)', async () => {
      fake.nextResult([{ inUse: 3 }]);
      const err = await service
        .deleteStage('b', 'admin')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        conflictingCount: 3,
      });
    });

    it('refuses to delete a stage a workflow rule depends on (409)', async () => {
      fake.nextResult([{ inUse: 0 }]);
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue({
        organisationId: 'org',
      });
      await expect(service.deleteStage('b', 'admin')).rejects.toThrow(
        new ConflictException(
          'Cannot delete stage - it is used in a Task & Event Creation/Completion rule.',
        ),
      );
    });

    it('deletes an unused stage and closes the gap in positions', async () => {
      fake.nextResult([{ inUse: 0 }]); // count
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue(undefined);
      fake.nextResult(undefined); // delete
      fake.db.query.workflowStages.findMany.mockResolvedValue([
        stage('a', 0),
        stage('c', 2),
      ]);
      fake.nextResult(undefined); // renumber c

      await service.deleteStage('b', 'admin');
      const renumbered = fake.calls
        .filter((c) => c.method === 'set')
        .map((c) => c.args[0]);
      expect(renumbered).toEqual([{ position: 1 }]); // only c moves, 2 -> 1
    });
  });
});
