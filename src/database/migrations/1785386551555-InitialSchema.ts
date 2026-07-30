import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1785386551555 implements MigrationInterface {
  name = 'InitialSchema1785386551555';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "postgis"`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "full_name" character varying NOT NULL, "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "is_platform_admin" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."organisation_members_role_enum" AS ENUM('community_user', 'volunteer', 'org_admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "organisation_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "public"."organisation_members_role_enum" NOT NULL DEFAULT 'community_user', "is_active" boolean NOT NULL DEFAULT true, "invited_at" TIMESTAMP WITH TIME ZONE, "joined_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_3cc6551a3f80b7aca61439ac6a5" UNIQUE ("organisation_id", "user_id"), CONSTRAINT "PK_2eb071f7c93bf3156dbe9318f29" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_588fd3930af62ea399879e1d7a" ON "organisation_members"  ("organisation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d808506119822a1e47422b512" ON "organisation_members"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "organisations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7bf54cba378d5b2f1d4c10ef4df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid, "acting_user_id" uuid, "action" character varying NOT NULL, "entity_type" character varying NOT NULL, "entity_id" uuid, "metadata" jsonb, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e8a264439375f1dec49b3497f" ON "audit_logs"  ("organisation_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workflow_stages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "name" character varying NOT NULL, "position" integer NOT NULL, "is_final" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_ca8f440beb71862fe2533e7be2b" UNIQUE ("organisation_id", "position"), CONSTRAINT "PK_a521b91fac23874e5750cbeccb2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c552c18009d40281a10507089" ON "workflow_stages"  ("organisation_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."incidents_category_enum" AS ENUM('illegal_dumping', 'water_pollution', 'air_pollution', 'deforestation', 'wildlife_hazard', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."incidents_severity_enum" AS ENUM('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."incidents_verification_status_enum" AS ENUM('pending', 'approved', 'rejected', 'duplicate')`,
    );
    await queryRunner.query(
      `CREATE TABLE "incidents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "reported_by_user_id" uuid NOT NULL, "title" character varying NOT NULL, "description" text NOT NULL, "category" "public"."incidents_category_enum" NOT NULL, "severity" "public"."incidents_severity_enum" NOT NULL, "latitude" double precision NOT NULL, "longitude" double precision NOT NULL, "address" text, "verification_status" "public"."incidents_verification_status_enum" NOT NULL DEFAULT 'pending', "current_stage_id" uuid, "rejection_reason" text, "duplicate_of_id" uuid, "verified_by_user_id" uuid, "verified_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ccb34c01719889017e2246469f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d146b5c618d964683283cfcdc" ON "incidents"  ("organisation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0285c766dbd75604302722be39" ON "incidents"  ("verification_status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "incident_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "incident_id" uuid NOT NULL, "url" character varying NOT NULL, CONSTRAINT "PK_7ea95e286fbc1ac9937ff32fd23" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1c9b31a43b4d7e19965356a02" ON "incident_images"  ("incident_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('task_assigned', 'incident_approved', 'incident_rejected', 'task_status_changed', 'cleanup_scheduled', 'task_completed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "organisation_id" uuid, "type" "public"."notifications_type_enum" NOT NULL, "title" character varying NOT NULL, "message" text NOT NULL, "related_entity_type" character varying, "related_entity_id" uuid, "is_read" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a8a82462cab47c73d25f49261" ON "notifications"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "task_id" uuid NOT NULL, "author_user_id" uuid NOT NULL, "note" text NOT NULL, CONSTRAINT "PK_85e3e7dfff9c342d8381ebd0699" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_64b5fe204db538868df564df69" ON "task_notes"  ("task_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_photos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "task_id" uuid NOT NULL, "url" character varying NOT NULL, "uploaded_by_user_id" uuid NOT NULL, CONSTRAINT "PK_7f5609ef95ff8d5ca3eea7cf504" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_177e3667c2d6ea987b5b3a851f" ON "task_photos"  ("task_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tasks_priority_enum" AS ENUM('low', 'medium', 'high')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tasks_status_enum" AS ENUM('pending', 'in_progress', 'completed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "incident_id" uuid NOT NULL, "description" text NOT NULL, "priority" "public"."tasks_priority_enum" NOT NULL DEFAULT 'medium', "scheduled_at" TIMESTAMP WITH TIME ZONE, "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'pending', "created_by_user_id" uuid NOT NULL, CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea46985a8c7921288fb2cb694f" ON "tasks"  ("organisation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39b2a8d37474236de9649a7172" ON "tasks"  ("incident_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6086c8dafbae729a930c04d865" ON "tasks"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."task_assignments_status_enum" AS ENUM('assigned', 'accepted', 'declined')`,
    );
    await queryRunner.query(
      `CREATE TABLE "task_assignments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "task_id" uuid NOT NULL, "volunteer_user_id" uuid NOT NULL, "status" "public"."task_assignments_status_enum" NOT NULL DEFAULT 'assigned', "responded_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e576759687a6016566e5cee2c47" UNIQUE ("task_id", "volunteer_user_id"), CONSTRAINT "PK_b68f42cf36d807d8a19a96066d7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b389f4488d0a8241c3c9827396" ON "task_assignments"  ("task_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5821ab010ae013e35539d4277d" ON "task_assignments"  ("volunteer_user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "organisation_members" ADD CONSTRAINT "FK_588fd3930af62ea399879e1d7ab" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "organisation_members" ADD CONSTRAINT "FK_6d808506119822a1e47422b512a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_6e8a264439375f1dec49b3497f2" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_ceab43abc684f428294f235291d" FOREIGN KEY ("acting_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workflow_stages" ADD CONSTRAINT "FK_5c552c18009d40281a105070896" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_2d146b5c618d964683283cfcdc3" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_07e76fb0a4eda527ef6d63a22d1" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_40a692a439985cb6b5267ec8518" FOREIGN KEY ("current_stage_id") REFERENCES "workflow_stages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_32bd6581a97bddcca3ea8636a9b" FOREIGN KEY ("duplicate_of_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "incident_images" ADD CONSTRAINT "FK_c1c9b31a43b4d7e19965356a02a" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_c075d9ce655d67bbec46ff5631a" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_notes" ADD CONSTRAINT "FK_64b5fe204db538868df564df695" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_notes" ADD CONSTRAINT "FK_f8ae473c20412b4baa66475e5e9" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_photos" ADD CONSTRAINT "FK_177e3667c2d6ea987b5b3a851f2" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_photos" ADD CONSTRAINT "FK_bbb70aafbb0f8e604c988764dcf" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_ea46985a8c7921288fb2cb694f2" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_39b2a8d37474236de9649a71720" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_932b7ae90148e482bc27b0a6d65" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_assignments" ADD CONSTRAINT "FK_b389f4488d0a8241c3c98273966" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_assignments" ADD CONSTRAINT "FK_5821ab010ae013e35539d4277d0" FOREIGN KEY ("volunteer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_assignments" DROP CONSTRAINT "FK_5821ab010ae013e35539d4277d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_assignments" DROP CONSTRAINT "FK_b389f4488d0a8241c3c98273966"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_932b7ae90148e482bc27b0a6d65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_39b2a8d37474236de9649a71720"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_ea46985a8c7921288fb2cb694f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_photos" DROP CONSTRAINT "FK_bbb70aafbb0f8e604c988764dcf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_photos" DROP CONSTRAINT "FK_177e3667c2d6ea987b5b3a851f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_notes" DROP CONSTRAINT "FK_f8ae473c20412b4baa66475e5e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_notes" DROP CONSTRAINT "FK_64b5fe204db538868df564df695"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_c075d9ce655d67bbec46ff5631a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incident_images" DROP CONSTRAINT "FK_c1c9b31a43b4d7e19965356a02a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" DROP CONSTRAINT "FK_32bd6581a97bddcca3ea8636a9b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" DROP CONSTRAINT "FK_40a692a439985cb6b5267ec8518"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" DROP CONSTRAINT "FK_07e76fb0a4eda527ef6d63a22d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" DROP CONSTRAINT "FK_2d146b5c618d964683283cfcdc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workflow_stages" DROP CONSTRAINT "FK_5c552c18009d40281a105070896"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_ceab43abc684f428294f235291d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_6e8a264439375f1dec49b3497f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organisation_members" DROP CONSTRAINT "FK_6d808506119822a1e47422b512a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organisation_members" DROP CONSTRAINT "FK_588fd3930af62ea399879e1d7ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5821ab010ae013e35539d4277d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b389f4488d0a8241c3c9827396"`,
    );
    await queryRunner.query(`DROP TABLE "task_assignments"`);
    await queryRunner.query(
      `DROP TYPE "public"."task_assignments_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6086c8dafbae729a930c04d865"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39b2a8d37474236de9649a7172"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea46985a8c7921288fb2cb694f"`,
    );
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."tasks_priority_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_177e3667c2d6ea987b5b3a851f"`,
    );
    await queryRunner.query(`DROP TABLE "task_photos"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64b5fe204db538868df564df69"`,
    );
    await queryRunner.query(`DROP TABLE "task_notes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a8a82462cab47c73d25f49261"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1c9b31a43b4d7e19965356a02"`,
    );
    await queryRunner.query(`DROP TABLE "incident_images"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0285c766dbd75604302722be39"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d146b5c618d964683283cfcdc"`,
    );
    await queryRunner.query(`DROP TABLE "incidents"`);
    await queryRunner.query(
      `DROP TYPE "public"."incidents_verification_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."incidents_severity_enum"`);
    await queryRunner.query(`DROP TYPE "public"."incidents_category_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c552c18009d40281a10507089"`,
    );
    await queryRunner.query(`DROP TABLE "workflow_stages"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e8a264439375f1dec49b3497f"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "organisations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d808506119822a1e47422b512"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_588fd3930af62ea399879e1d7a"`,
    );
    await queryRunner.query(`DROP TABLE "organisation_members"`);
    await queryRunner.query(
      `DROP TYPE "public"."organisation_members_role_enum"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
