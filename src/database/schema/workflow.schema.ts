import {
  boolean,
  integer,
  pgTable,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import { organisations } from './organisations.schema';

/**
 * `slug` is server-generated from `name` at creation (lowercased, spaces->underscores)
 * and immutable thereafter — never exposed as editable in the DTO. `color` is a hex
 * string, validated at the DTO layer (`@Matches(/^#[0-9a-fA-F]{6}$/)`), not here.
 */
export const workflowStages = pgTable(
  'workflow_stages',
  {
    ...baseColumns,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: varchar('name').notNull(),
    slug: varchar('slug').notNull(),
    color: varchar('color', { length: 7 }).notNull(),
    position: integer('position').notNull(),
    isFinal: boolean('is_final').notNull().default(false),
  },
  (t) => [
    unique('workflow_stages_org_position_unique').on(
      t.organisationId,
      t.position,
    ),
    unique('workflow_stages_org_slug_unique').on(t.organisationId, t.slug),
  ],
);
