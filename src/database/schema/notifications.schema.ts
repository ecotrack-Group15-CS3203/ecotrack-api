import { boolean, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import { notificationTypeEnum } from './enums.schema';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

export const notifications = pgTable('notifications', {
  ...baseColumns,
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  organisationId: uuid('organisation_id').references(() => organisations.id, {
    onDelete: 'cascade',
  }),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title').notNull(),
  message: text('message').notNull(),
  relatedEntityType: varchar('related_entity_type'),
  relatedEntityId: uuid('related_entity_id'),
  isRead: boolean('is_read').notNull().default(false),
});
