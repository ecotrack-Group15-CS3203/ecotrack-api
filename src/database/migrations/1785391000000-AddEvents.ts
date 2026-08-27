import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvents1785391000000 implements MigrationInterface {
  name = 'AddEvents1785391000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."events_status_enum" AS ENUM('scheduled', 'ongoing', 'completed', 'cancelled')`);
    await queryRunner.query(`CREATE TABLE "events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "incident_ids" uuid[] NOT NULL, "title" character varying NOT NULL, "description" text NOT NULL, "latitude" double precision NOT NULL, "longitude" double precision NOT NULL, "address" text, "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE, "max_attendees" integer, "status" "public"."events_status_enum" NOT NULL DEFAULT 'scheduled', "created_by_user_id" uuid NOT NULL, CONSTRAINT "PK_events_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_events_organisation_id" ON "events" ("organisation_id")`);
    await queryRunner.query(`ALTER TABLE "events" ADD CONSTRAINT "FK_events_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "events" ADD CONSTRAINT "FK_events_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "events" DROP CONSTRAINT "FK_events_creator"`);
    await queryRunner.query(`ALTER TABLE "events" DROP CONSTRAINT "FK_events_organisation"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_events_organisation_id"`);
    await queryRunner.query(`DROP TABLE "events"`);
    await queryRunner.query(`DROP TYPE "public"."events_status_enum"`);
  }
}