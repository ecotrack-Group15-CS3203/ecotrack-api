import { boolean, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { baseColumns, geographyPoint } from './columns.helpers';

/**
 * `service_area_radius_km` is constrained to {1,5,10,25,50} via a hand-written CHECK
 * constraint added in a follow-up raw-SQL migration (drizzle-kit's schema DSL doesn't
 * emit CHECK constraints from TypeScript) — see
 * src/database/drizzle/migrations/0001_constraints_and_indexes.sql.
 */
export const organisations = pgTable('organisations', {
  ...baseColumns,
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  contactEmail: varchar('contact_email').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  serviceAreaCenter: geographyPoint('service_area_center'),
  serviceAreaRadiusKm: integer('service_area_radius_km'),
});
