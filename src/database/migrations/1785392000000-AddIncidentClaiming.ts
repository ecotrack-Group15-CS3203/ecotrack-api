import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncidentClaiming1785392000000 implements MigrationInterface {
  name = 'AddIncidentClaiming1785392000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" ALTER COLUMN "organisation_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD COLUMN "claimed_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "claimed_at"`);
    await queryRunner.query(`ALTER TABLE "incidents" ALTER COLUMN "organisation_id" SET NOT NULL`);
  }
}