CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."incident_category" AS ENUM('illegal_dumping', 'water_pollution', 'air_pollution', 'deforestation', 'wildlife_hazard', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('task_assigned', 'incident_claimed', 'incident_rejected', 'task_status_changed', 'cleanup_scheduled', 'task_completed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('citizen', 'volunteer', 'org_admin');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('approved', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"contact_email" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"service_area_center" "geography",
	"service_area_radius_km" integer
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auth_subject" varchar NOT NULL,
	"email" varchar NOT NULL,
	"full_name" varchar NOT NULL,
	"role" "role" DEFAULT 'citizen' NOT NULL,
	"organisation_id" uuid,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"push_token" varchar,
	"notification_preferences" jsonb DEFAULT '{"taskAssigned":true,"scheduleChanged":true,"cleanupScheduled":false}'::jsonb NOT NULL,
	CONSTRAINT "users_auth_subject_unique" UNIQUE("auth_subject"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" varchar NOT NULL,
	"invited_full_name" varchar,
	"role" "role" DEFAULT 'volunteer' NOT NULL,
	"token" varchar NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"color" varchar(7) NOT NULL,
	"position" integer NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	CONSTRAINT "workflow_stages_org_position_unique" UNIQUE("organisation_id","position"),
	CONSTRAINT "workflow_stages_org_slug_unique" UNIQUE("organisation_id","slug")
);
--> statement-breakpoint
CREATE TABLE "incident_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"incident_id" uuid NOT NULL,
	"url" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid,
	"reported_by_user_id" uuid,
	"title" varchar NOT NULL,
	"description" text NOT NULL,
	"category" "incident_category" NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"location" "geography" NOT NULL,
	"address" text,
	"verification_status" "verification_status",
	"current_stage_id" uuid,
	"rejection_reason" text,
	"duplicate_of_id" uuid,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"volunteer_user_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"responded_at" timestamp with time zone,
	"decline_reason" varchar,
	CONSTRAINT "task_assignments_task_volunteer_unique" UNIQUE("task_id","volunteer_user_id")
);
--> statement-breakpoint
CREATE TABLE "task_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid,
	"note" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"url" varchar NOT NULL,
	"uploaded_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"description" text NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"organisation_id" uuid,
	"type" "notification_type" NOT NULL,
	"title" varchar NOT NULL,
	"message" text NOT NULL,
	"related_entity_type" varchar,
	"related_entity_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid,
	"acting_user_id" uuid,
	"action" varchar NOT NULL,
	"entity_type" varchar NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_images" ADD CONSTRAINT "incident_images_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_current_stage_id_workflow_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_duplicate_of_id_incidents_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_volunteer_user_id_users_id_fk" FOREIGN KEY ("volunteer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;