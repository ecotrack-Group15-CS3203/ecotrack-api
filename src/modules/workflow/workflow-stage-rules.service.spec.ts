import { UnprocessableEntityException } from '@nestjs/common';
import { TenantDbService } from '../../database/tenant-db.service';
import { createFakeDb, FakeDb } from '../../test-utils/fake-db';
import { AuditLogService } from '../audit/audit-log.service';
import { WorkflowStageRulesService } from './workflow-stage-rules.service';
import {
  WorkflowStageRow,
  WorkflowStagesService,
} from './workflow-stages.service';

/** SRS 3.1.21 / 3.1.13: minimum-stage gates and auto-advance targets. */
const stage = (
  id: string,
  position: number,
  over: Partial<WorkflowStageRow> = {},
) =>
  ({
    id,
    name: id,
    position,
    isFinal: false,
    organisationId: 'org',
    ...over,
  }) as WorkflowStageRow;

describe('WorkflowStageRulesService', () => {
  let fake: FakeDb;
  let stages: jest.Mocked<
    Pick<
      WorkflowStagesService,
      'findById' | 'findNextStage' | 'findDefaultClaimStage' | 'listStages'
    >
  >;
  let service: WorkflowStageRulesService;
  const rules = (over: Record<string, string | null> = {}) => ({
    organisationId: 'org',
    taskCreationMinStageId: null,
    taskCreationTargetStageId: null,
    eventCreationMinStageId: null,
    eventCreationTargetStageId: null,
    taskCompletionTargetStageId: null,
    eventCompletionTargetStageId: null,
    ...over,
  });

  beforeEach(() => {
    fake = createFakeDb();
    stages = {
      findById: jest.fn(),
      findNextStage: jest.fn(),
      findDefaultClaimStage: jest.fn(),
      listStages: jest.fn(),
    };
    service = new WorkflowStageRulesService(
      { db: fake.db } as unknown as TenantDbService,
      { record: jest.fn() } as unknown as AuditLogService,
      stages as unknown as WorkflowStagesService,
    );
  });

  it('creates default rules on first read, gated at the claim stage', async () => {
    fake.db.query.workflowStageRules.findFirst.mockResolvedValue(undefined);
    stages.findDefaultClaimStage.mockResolvedValue(stage('claimed', 1));
    fake.nextResult([
      rules({
        taskCreationMinStageId: 'claimed',
        eventCreationMinStageId: 'claimed',
      }),
    ]);

    const created = await service.getRules('org');
    expect(created.taskCreationMinStageId).toBe('claimed');
    const values = fake.calls.find((c) => c.method === 'values')!.args[0];
    expect(values).toMatchObject({
      taskCreationMinStageId: 'claimed',
      eventCreationMinStageId: 'claimed',
    });
  });

  describe('assertMinimumStageReached', () => {
    it('refuses to create a task before the incident reaches the minimum stage (422)', async () => {
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue(
        rules({ taskCreationMinStageId: 'claimed' }),
      );
      stages.findById.mockResolvedValue(
        stage('claimed', 1, { name: 'Claimed' }),
      );

      await expect(
        service.assertMinimumStageReached(
          'org',
          'taskCreation',
          stage('reported', 0, { name: 'Reported' }),
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException(
          "This incident must reach the 'Claimed' stage before a task can be created. It is currently at 'Reported'.",
        ),
      );
    });

    it('allows it at or beyond the minimum stage', async () => {
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue(
        rules({ eventCreationMinStageId: 'claimed' }),
      );
      stages.findById.mockResolvedValue(stage('claimed', 1));
      await expect(
        service.assertMinimumStageReached(
          'org',
          'eventCreation',
          stage('claimed', 1),
        ),
      ).resolves.toBeUndefined();
      await expect(
        service.assertMinimumStageReached(
          'org',
          'eventCreation',
          stage('resolved', 2),
        ),
      ).resolves.toBeUndefined();
    });

    it('allows anything when no minimum is configured', async () => {
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue(rules());
      await expect(
        service.assertMinimumStageReached(
          'org',
          'taskCreation',
          stage('reported', 0),
        ),
      ).resolves.toBeUndefined();
      expect(stages.findById).not.toHaveBeenCalled();
    });
  });

  describe('resolveTarget', () => {
    it('never moves an incident that is already in a final stage', async () => {
      await expect(
        service.resolveTarget(
          'org',
          'taskCompletion',
          stage('done', 3, { isFinal: true }),
        ),
      ).resolves.toBeUndefined();
    });

    it('uses the configured target stage', async () => {
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue(
        rules({ taskCompletionTargetStageId: 'resolved' }),
      );
      stages.findById.mockResolvedValue(stage('resolved', 2));
      await expect(
        service.resolveTarget('org', 'taskCompletion', stage('claimed', 1)),
      ).resolves.toMatchObject({ id: 'resolved' });
    });

    it('falls back to the next stage ("Automatic") when none is configured', async () => {
      fake.db.query.workflowStageRules.findFirst.mockResolvedValue(rules());
      stages.findNextStage.mockResolvedValue(stage('in-progress', 2));
      await expect(
        service.resolveTarget('org', 'taskCreation', stage('claimed', 1)),
      ).resolves.toMatchObject({ id: 'in-progress' });
    });
  });

  it("rejects a rule that points at another organisation's stage (422)", async () => {
    fake.db.query.workflowStageRules.findFirst.mockResolvedValue(rules());
    stages.listStages.mockResolvedValue([stage('claimed', 1)]);
    await expect(
      service.updateRules(
        'org',
        { taskCreationMinStageId: 'foreign-stage' },
        'admin',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
