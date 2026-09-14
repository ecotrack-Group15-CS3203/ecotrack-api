-- SRS 3.1.10: notifying a volunteer their membership ended. Isolated in its own
-- migration for the same reason 0026 is: ALTER TYPE ... ADD VALUE cannot share a
-- transaction with a statement that references the new value.
ALTER TYPE "notification_type" ADD VALUE 'volunteer_removed';
