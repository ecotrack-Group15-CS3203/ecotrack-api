import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncidentCode1785394000000 implements MigrationInterface {
  name = 'AddIncidentCode1785394000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE SEQUENCE "incidents_incident_code_seq" OWNED BY "incidents"."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD COLUMN "incident_code" character varying NOT NULL DEFAULT ('INC-' || LPAD(nextval('incidents_incident_code_seq')::text, 6, '0'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "UQ_incidents_incident_code" UNIQUE ("incident_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "incidents" DROP CONSTRAINT "UQ_incidents_incident_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" DROP COLUMN "incident_code"`,
    );
    await queryRunner.query(`DROP SEQUENCE "incidents_incident_code_seq"`);
  }
}