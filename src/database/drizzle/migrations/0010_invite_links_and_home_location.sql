CREATE TABLE "invite_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"token_hash" varchar NOT NULL,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invite_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location" "geography";--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;