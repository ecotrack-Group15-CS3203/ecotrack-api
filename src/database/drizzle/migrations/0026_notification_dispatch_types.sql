-- New notification_type values for the three dispatch-cron-driven pushes
-- (SRS 3.1.4 proximity, 3.1.8 task due-date, 3.1.9 event reminder). Kept in its own
-- migration: ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a
-- statement that references the new value, and drizzle-kit's generated migrations
-- already isolate enum-value additions from surrounding DDL for that reason.
ALTER TYPE "notification_type" ADD VALUE 'incident_proximity';
ALTER TYPE "notification_type" ADD VALUE 'task_due_reminder';
ALTER TYPE "notification_type" ADD VALUE 'event_reminder';
