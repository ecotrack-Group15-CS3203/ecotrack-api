import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns, geographyPoint } from './columns.helpers';
import { eventStatusEnum } from './enums.schema';
import { incidents } from './incidents.schema';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

/** SRS 3.1.7/3.1.9. `maxAttendees` NULL = uncapped, no capacity check on RSVP. */
export const events = pgTable('events', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  title: varchar('title').notNull(),
  description: text('description'),
  location: geographyPoint('location').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  maxAttendees: integer('max_attendees'),
  status: eventStatusEnum('status').notNull().default('scheduled'),
  rsvpCount: integer('rsvp_count').notNull().default(0),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
});

/**
 * A pure join table (SAD Table 17.1) — organisationId is denormalized from the
 * parent event, same reasoning as tasks' child tables (tasks.schema.ts), so RLS
 * doesn't need a subquery through `events`.
 */
export const eventIncidents = pgTable(
  'event_incidents',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.incidentId] })],
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rsvpedAt: timestamp('rsvped_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);
