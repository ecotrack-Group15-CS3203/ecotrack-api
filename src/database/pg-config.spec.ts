import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildPgPoolConfig, buildSslOptions } from './pg-config';

const BASE_ENV: Record<string, string> = {
  DB_HOST: 'db.internal',
  DB_PORT: '5432',
  DB_NAME: 'ecotrack',
  DB_USER: 'ecotrack_app',
  DB_PASSWORD: 'app-secret',
  DB_MIGRATOR_USER: 'ecotrack',
  DB_MIGRATOR_PASSWORD: 'migrator-secret',
};

const lookupFrom = (env: Record<string, string>) => (key: string) => env[key];

describe('buildSslOptions', () => {
  it('disables TLS when DB_SSL is unset, so local Docker and CI keep working', () => {
    expect(buildSslOptions(lookupFrom(BASE_ENV))).toBe(false);
  });

  it('encrypts without certificate checks for DB_SSL=require', () => {
    expect(
      buildSslOptions(lookupFrom({ ...BASE_ENV, DB_SSL: 'require' })),
    ).toEqual({ rejectUnauthorized: false });
  });

  describe('verify-full', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'pg-config-spec-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('loads the CA bundle and verifies the certificate', () => {
      const caPath = join(dir, 'ca.pem');
      writeFileSync(caPath, 'FAKE CA');
      expect(
        buildSslOptions(
          lookupFrom({ ...BASE_ENV, DB_SSL: 'verify-full', DB_SSL_CA: caPath }),
        ),
      ).toEqual({ rejectUnauthorized: true, ca: 'FAKE CA' });
    });

    it('fails loudly when DB_SSL_CA is missing', () => {
      expect(() =>
        buildSslOptions(lookupFrom({ ...BASE_ENV, DB_SSL: 'verify-full' })),
      ).toThrow(/DB_SSL_CA/);
    });
  });

  it('rejects an unknown mode instead of silently connecting in plain text', () => {
    expect(() =>
      buildSslOptions(lookupFrom({ ...BASE_ENV, DB_SSL: 'on' })),
    ).toThrow(/Unknown DB_SSL/);
  });
});

describe('buildPgPoolConfig', () => {
  it('connects as the runtime role by default', () => {
    expect(buildPgPoolConfig(lookupFrom(BASE_ENV))).toMatchObject({
      host: 'db.internal',
      port: 5432,
      user: 'ecotrack_app',
      password: 'app-secret',
      database: 'ecotrack',
    });
  });

  it('connects as the migrator role when asked', () => {
    expect(
      buildPgPoolConfig(lookupFrom(BASE_ENV), { migrator: true }),
    ).toMatchObject({ user: 'ecotrack', password: 'migrator-secret' });
  });

  it('falls back to the runtime credentials when no migrator is configured', () => {
    const env = Object.fromEntries(
      Object.entries(BASE_ENV).filter(
        ([key]) => !key.startsWith('DB_MIGRATOR_'),
      ),
    );
    expect(
      buildPgPoolConfig(lookupFrom(env), { migrator: true }),
    ).toMatchObject({ user: 'ecotrack_app', password: 'app-secret' });
  });

  it('accepts numeric values as ConfigService returns them', () => {
    expect(
      buildPgPoolConfig((key) => (key === 'DB_PORT' ? 5434 : BASE_ENV[key])),
    ).toMatchObject({ port: 5434 });
  });
});
