import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvitations1785389975049 implements MigrationInterface {
  name = 'AddInvitations1785389975049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."invitations_role_enum" AS ENUM('community_user', 'volunteer', 'org_admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organisation_id" uuid NOT NULL, "email" character varying NOT NULL, "role" "public"."invitations_role_enum" NOT NULL DEFAULT 'volunteer', "token" character varying NOT NULL, "invited_by_user_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "accepted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e577dcf9bb6d084373ed3998509" UNIQUE ("token"), CONSTRAINT "PK_5dec98cfdfd562e4ad3648bbb07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db8eb6da8f383cb3443217d853" ON "invitations"  ("organisation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_db8eb6da8f383cb3443217d8536" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_e686620e08c4661e70a6b39b94a" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_e686620e08c4661e70a6b39b94a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_db8eb6da8f383cb3443217d8536"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db8eb6da8f383cb3443217d853"`,
    );
    await queryRunner.query(`DROP TABLE "invitations"`);
    await queryRunner.query(`DROP TYPE "public"."invitations_role_enum"`);
  }
}
