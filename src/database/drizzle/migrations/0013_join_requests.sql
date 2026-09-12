CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'join_request_submitted';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'join_request_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'join_request_rejected';--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" varchar,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;