import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  Paginated,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { NotificationType } from '../../common/enums/notification.enum';
import {
  eventIncidents,
  events,
  eventRsvps,
  users,
} from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { IncidentRow, IncidentsService } from '../incidents/incidents.service';
import { NotificationDispatchRepository } from '../notifications/dispatch/notification-dispatch.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowStageRulesService } from '../workflow/workflow-stage-rules.service';
import {
  WorkflowStagesService,
  WorkflowStageRow,
} from '../workflow/workflow-stages.service';
import { CreateEventDto } from './dto/create-event.dto';

export type EventRow = typeof events.$inferSelect;
export type EventStatus = EventRow['status'];

export interface EventFull extends EventRow {
  incidents: IncidentRow[];
  rsvps: {
    userId: string;
    rsvpedAt: Date;
    user: { id: string; fullName: string; email: string } | null;
  }[];
}

/** SRS 3.1.9's lifecycle. 'scheduled' is never a target — nothing moves back to it. */
const VALID_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  scheduled: ['ongoing', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class EventsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly auditLogService: AuditLogService,
    private readonly incidentsService: IncidentsService,
    private readonly workflowStagesService: WorkflowStagesService,
    private readonly workflowStageRulesService: WorkflowStageRulesService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationDispatchRepository: NotificationDispatchRepository,
  ) {}

  /** SRS 3.1.9: 24h-before-scheduledAt reminder — see NotificationDispatchService. */
  private scheduleReminder(eventId: string, scheduledAt: Date): Promise<void> {
    const dueAt = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
    if (dueAt <= new Date()) return Promise.resolve();
    return this.notificationDispatchRepository.schedule(
      this.tenantDb.db,
      'event_reminder',
      'event',
      eventId,
      dueAt,
    );
  }

  private cancelReminder(eventId: string): Promise<void> {
    return this.notificationDispatchRepository.cancel(
      this.tenantDb.db,
      'event_reminder',
      eventId,
    );
  }

  /**
   * Mirrors TasksService.create()'s precondition shape exactly: the
   * verificationStatus guard stays alongside the stage-minimum check for the same
   * reason (a rejected/duplicate incident can sit at any position). Validates and
   * gathers every linked incident's current stage *before* writing anything, so a
   * failure on incident N doesn't leave a partially-linked event — the tenant
   * transaction would roll it back anyway, but there's no reason to attempt the
   * insert at all if incident 1 of 3 already fails.
   */
  async create(
    organisationId: string,
    createdByUserId: string,
    dto: CreateEventDto,
  ): Promise<EventFull> {
    const incidentStages: {
      incidentId: string;
      currentStage: WorkflowStageRow;
    }[] = [];
    for (const incidentId of dto.incidentIds) {
      const incident = await this.incidentsService.findScoped(
        organisationId,
        incidentId,
      );
      if (
        incident.verificationStatus !== VerificationStatus.APPROVED ||
        !incident.currentStageId
      ) {
        throw new BadRequestException(
          `Incident ${incidentId} can only be linked to an event once claimed`,
        );
      }
      const currentStage = await this.workflowStagesService.findById(
        incident.currentStageId,
      );
      await this.workflowStageRulesService.assertMinimumStageReached(
        organisationId,
        'eventCreation',
        currentStage,
      );
      incidentStages.push({ incidentId, currentStage });
    }

    const [saved] = await this.tenantDb.db
      .insert(events)
      .values({
        organisationId,
        title: dto.title,
        description: dto.description ?? null,
        location: dto.location,
        scheduledAt: new Date(dto.scheduledAt),
        endsAt: new Date(dto.endsAt),
        maxAttendees: dto.maxAttendees ?? null,
        createdByUserId,
      })
      .returning();

    await this.tenantDb.db.insert(eventIncidents).values(
      dto.incidentIds.map((incidentId) => ({
        organisationId,
        eventId: saved.id,
        incidentId,
      })),
    );

    await this.scheduleReminder(saved.id, saved.scheduledAt);

    await this.auditLogService.record({
      organisationId,
      actingUserId: createdByUserId,
      action: 'event.created',
      entityType: 'event',
      entityId: saved.id,
      metadata: { incidentIds: dto.incidentIds },
    });

    for (const { incidentId, currentStage } of incidentStages) {
      const targetStage = await this.workflowStageRulesService.resolveTarget(
        organisationId,
        'eventCreation',
        currentStage,
      );
      if (targetStage && targetStage.id !== currentStage.id) {
        await this.incidentsService.advanceStage(
          organisationId,
          incidentId,
          targetStage.id,
          createdByUserId,
          'event.created',
        );
      }
    }

    return this.findById(saved.id);
  }

  /**
   * `rsvpedByMe` is resolved here rather than left to the client: the list is the
   * screen where a volunteer decides whether to RSVP, and without it the UI has no
   * way to render an already-going state short of fetching every event's detail.
   */
  async listForOrganisation(
    organisationId: string,
    userId: string,
    { page, limit }: PaginationQueryDto,
    status?: EventStatus,
  ): Promise<Paginated<EventRow & { rsvpedByMe: boolean }>> {
    const where = status
      ? and(
          eq(events.organisationId, organisationId),
          eq(events.status, status),
        )
      : eq(events.organisationId, organisationId);

    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const rows = await this.tenantDb.db.query.events.findMany({
      where,
      orderBy: asc(events.scheduledAt),
      limit,
      offset: (page - 1) * limit,
    });
    const [{ count: total }] = await this.tenantDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(where);
    if (rows.length === 0) return { items: [], total, page, limit };

    const mine = await this.tenantDb.db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.userId, userId),
        inArray(
          eventRsvps.eventId,
          rows.map((r) => r.id),
        ),
      ),
      columns: { eventId: true },
    });
    const rsvpedEventIds = new Set(mine.map((r) => r.eventId));

    const items = rows.map((row) => ({
      ...row,
      rsvpedByMe: rsvpedEventIds.has(row.id),
    }));
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<EventFull> {
    const event = await this.tenantDb.db.query.events.findFirst({
      where: eq(events.id, id),
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const links = await this.tenantDb.db.query.eventIncidents.findMany({
      where: eq(eventIncidents.eventId, id),
    });
    const rsvpRows = await this.tenantDb.db.query.eventRsvps.findMany({
      where: eq(eventRsvps.eventId, id),
    });

    const incidentIds = links.map((l) => l.incidentId);
    const linkedIncidents: IncidentRow[] = [];
    for (const incidentId of incidentIds) {
      linkedIncidents.push(await this.incidentsService.findById(incidentId));
    }

    const userIds = rsvpRows.map((r) => r.userId);
    const rsvpUsers = userIds.length
      ? await this.tenantDb.db.query.users.findMany({
          where: inArray(users.id, userIds),
          columns: { id: true, fullName: true, email: true },
        })
      : [];
    const userById = new Map(rsvpUsers.map((u) => [u.id, u]));

    return {
      ...event,
      incidents: linkedIncidents,
      rsvps: rsvpRows.map((r) => ({
        userId: r.userId,
        rsvpedAt: r.rsvpedAt,
        user: userById.get(r.userId) ?? null,
      })),
    };
  }

  /** Matches TasksService.findScoped's exact shape: fetch the full record first,
   * then check org ownership, so a mismatch 404s like the incidents module does. */
  async findScoped(
    organisationId: string,
    eventId: string,
  ): Promise<EventFull> {
    const event = await this.findById(eventId);
    if (event.organisationId !== organisationId) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  /**
   * Marking an event completed always succeeds and advances every linked
   * incident per the Event Completion rule — same "consequence that must always
   * succeed on its own terms" pattern as TasksService.markCompleted(), never
   * blocked by a precondition the way creation is.
   */
  async updateStatus(
    organisationId: string,
    eventId: string,
    status: EventStatus,
    actingUserId: string,
  ): Promise<EventFull> {
    const event = await this.findScoped(organisationId, eventId);
    if (!VALID_TRANSITIONS[event.status].includes(status)) {
      throw new BadRequestException(
        `Cannot move an event from '${event.status}' to '${status}'.`,
      );
    }

    await this.tenantDb.db
      .update(events)
      .set({ status, updatedAt: new Date() })
      .where(eq(events.id, eventId));

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: `event.${status}`,
      entityType: 'event',
      entityId: eventId,
    });

    if (status === 'cancelled') {
      await this.cancelReminder(eventId);

      const rsvps = await this.tenantDb.db.query.eventRsvps.findMany({
        where: eq(eventRsvps.eventId, eventId),
      });
      await Promise.all(
        rsvps.map((r) =>
          this.notificationsService.create({
            userId: r.userId,
            organisationId,
            type: NotificationType.EVENT_CANCELLED,
            title: 'Event cancelled',
            message: `"${event.title}" has been cancelled.`,
            relatedEntityType: 'event',
            relatedEntityId: eventId,
          }),
        ),
      );
    }

    if (status === 'completed') {
      const links = await this.tenantDb.db.query.eventIncidents.findMany({
        where: eq(eventIncidents.eventId, eventId),
      });
      for (const link of links) {
        const incident = await this.incidentsService.findScoped(
          organisationId,
          link.incidentId,
        );
        if (!incident.currentStageId) continue;
        const currentStage = await this.workflowStagesService.findById(
          incident.currentStageId,
        );
        const targetStage = await this.workflowStageRulesService.resolveTarget(
          organisationId,
          'eventCompletion',
          currentStage,
        );
        if (targetStage && targetStage.id !== currentStage.id) {
          await this.incidentsService.advanceStage(
            organisationId,
            incident.id,
            targetStage.id,
            actingUserId,
            'event.completed',
          );
        }
      }
    }

    return this.findById(eventId);
  }

  /**
   * SRS 3.1.9's capacity guard: `SELECT ... FOR UPDATE` on the event row is what
   * actually prevents two concurrent RSVPs from both squeezing past a maxAttendees
   * limit — the pre-checks around it exist only for a specific, helpful error.
   * A repeat RSVP from the same volunteer is a no-op, not an error: nothing about
   * retrying an already-successful RSVP should look like a failure to the caller.
   */
  async rsvp(
    organisationId: string,
    eventId: string,
    userId: string,
  ): Promise<EventFull> {
    const [event] = await this.tenantDb.db
      .select()
      .from(events)
      .where(
        and(eq(events.id, eventId), eq(events.organisationId, organisationId)),
      )
      .for('update');
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.status === 'cancelled') {
      throw new GoneException('This event has been cancelled.');
    }
    if (event.status === 'completed') {
      throw new BadRequestException('This event has already taken place.');
    }

    const existing = await this.tenantDb.db.query.eventRsvps.findFirst({
      where: and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, userId),
      ),
    });
    if (existing) {
      return this.findById(eventId);
    }

    if (event.maxAttendees !== null && event.rsvpCount >= event.maxAttendees) {
      throw new ConflictException('This event has reached capacity.');
    }

    await this.tenantDb.db
      .insert(eventRsvps)
      .values({ organisationId, eventId, userId });
    await this.tenantDb.db
      .update(events)
      .set({ rsvpCount: sql`${events.rsvpCount} + 1`, updatedAt: new Date() })
      .where(eq(events.id, eventId));

    await this.auditLogService.record({
      organisationId,
      actingUserId: userId,
      action: 'event.rsvp',
      entityType: 'event',
      entityId: eventId,
    });

    return this.findById(eventId);
  }

  /**
   * Withdraws an RSVP. Takes the same `FOR UPDATE` row lock the RSVP path does, so a
   * concurrent RSVP and cancellation can't interleave into a wrong `rsvpCount`.
   * Idempotent: cancelling when not going is a no-op, not an error.
   *
   * Deliberately allowed on a cancelled or completed event — the row is being
   * removed, not added, so none of the capacity or lifecycle reasons to refuse an
   * RSVP apply to withdrawing one.
   */
  async cancelRsvp(
    organisationId: string,
    eventId: string,
    userId: string,
  ): Promise<EventFull> {
    const [event] = await this.tenantDb.db
      .select()
      .from(events)
      .where(
        and(eq(events.id, eventId), eq(events.organisationId, organisationId)),
      )
      .for('update');
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const deleted = await this.tenantDb.db
      .delete(eventRsvps)
      .where(
        and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)),
      )
      .returning({ eventId: eventRsvps.eventId });

    if (deleted.length === 0) {
      return this.findById(eventId);
    }

    // GREATEST guards the counter against ever going negative, however the row and
    // the count might have drifted apart.
    await this.tenantDb.db
      .update(events)
      .set({
        rsvpCount: sql`GREATEST(${events.rsvpCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    await this.auditLogService.record({
      organisationId,
      actingUserId: userId,
      action: 'event.rsvp_cancelled',
      entityType: 'event',
      entityId: eventId,
    });

    return this.findById(eventId);
  }
}
