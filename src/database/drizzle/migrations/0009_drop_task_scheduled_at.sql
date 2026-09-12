ALTER TABLE "tasks" ALTER COLUMN "due_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "scheduled_at";