import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  // 4000 is the mobile client's expected default (EXPO_PUBLIC_API_BASE_URL).
  PORT: Joi.number().default(4000),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  // Runs DDL (drizzle-kit generate/migrate); falls back to DB_USER/DB_PASSWORD if
  // unset, but production should use a separate role — see database/README notes in
  // the M2.5 migration (RLS policies + NOBYPASSRLS app role).
  DB_MIGRATOR_USER: Joi.string().optional(),
  DB_MIGRATOR_PASSWORD: Joi.string().optional(),

  // WSO2 Asgardeo — JWKS endpoint the JwtStrategy validates access tokens against.
  // No JWT_SECRET any more: EcoTrack never issues its own tokens under delegated auth.
  OIDC_JWKS_URI: Joi.string().uri().required(),
  OIDC_ISSUER: Joi.string().uri().allow('').optional(),

  // Object storage for incident photos and task evidence (SRS 3.1.15). The same code
  // path serves local MinIO and real S3 — the only difference is the two optional
  // settings below, which MinIO needs and AWS does not.
  S3_BUCKET: Joi.string().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  /** Set for MinIO (http://localhost:9000); leave unset to hit real AWS S3. */
  S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  /** MinIO requires path-style addressing; AWS S3 prefers virtual-host style. */
  S3_FORCE_PATH_STYLE: Joi.boolean().default(false),
  /**
   * Public base URL clients use to GET stored objects. Separate from S3_ENDPOINT
   * because in deployment the API may reach the bucket by one address while browsers
   * and phones reach it by another (CDN, LAN IP vs container hostname).
   */
  S3_PUBLIC_URL: Joi.string().uri().allow('').optional(),
});
