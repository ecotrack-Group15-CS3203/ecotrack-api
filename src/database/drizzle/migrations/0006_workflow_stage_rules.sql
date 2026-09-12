CREATE TABLE "workflow_stage_rules" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"task_creation_min_stage_id" uuid,
	"task_creation_target_stage_id" uuid,
	"event_creation_min_stage_id" uuid,
	"event_creation_target_stage_id" uuid,
	"task_completion_target_stage_id" uuid,
	"event_completion_target_stage_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_task_creation_min_stage_id_workflow_stages_id_fk" FOREIGN KEY ("task_creation_min_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_task_creation_target_stage_id_workflow_stages_id_fk" FOREIGN KEY ("task_creation_target_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_event_creation_min_stage_id_workflow_stages_id_fk" FOREIGN KEY ("event_creation_min_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_event_creation_target_stage_id_workflow_stages_id_fk" FOREIGN KEY ("event_creation_target_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_task_completion_target_stage_id_workflow_stages_id_fk" FOREIGN KEY ("task_completion_target_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_rules" ADD CONSTRAINT "workflow_stage_rules_event_completion_target_stage_id_workflow_stages_id_fk" FOREIGN KEY ("event_completion_target_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;