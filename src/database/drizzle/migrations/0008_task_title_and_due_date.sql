ALTER TYPE "public"."assignment_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "title" varchar NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_date" timestamp with time zone;