import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJoinRequests1785393000000 implements MigrationInterface {
  name = 'AddJoinRequests1785393000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."join_requests_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
    await queryRunner.query(`CREATE TABLE "join_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "requester_user_id" uuid NOT NULL, "message" text, "status" "public"."join_requests_status_enum" NOT NULL DEFAULT 'pending', CONSTRAINT "PK_join_requests_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_join_requests_organisation_id" ON "join_requests" ("organisation_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_join_requests_requester_user_id" ON "join_requests" ("requester_user_id")`);
    await queryRunner.query(`ALTER TABLE "join_requests" ADD CONSTRAINT "FK_join_requests_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "join_requests" ADD CONSTRAINT "FK_join_requests_requester" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "join_requests" DROP CONSTRAINT "FK_join_requests_requester"`);
    await queryRunner.query(`ALTER TABLE "join_requests" DROP CONSTRAINT "FK_join_requests_organisation"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_join_requests_requester_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_join_requests_organisation_id"`);
    await queryRunner.query(`DROP TABLE "join_requests"`);
    await queryRunner.query(`DROP TYPE "public"."join_requests_status_enum"`);
  }
}