import * as Joi from 'joi';
import { DB_SSL_MODES } from '../database/pg-config';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  // 4000 is the mobile client's expected default (EXPO_PUBLIC_API_BASE_URL).
  PORT: Joi.number().default(4000),
  /**
   * Express `trust proxy`. Set to 1 behind a single reverse proxy (Nginx on the same
   * host), so rate limiting keys on the caller's real IP instead of the proxy's.
   * Leave unset when clients connect directly.
   */
  TRUST_PROXY: Joi.string().allow('').optional(),
  /**
   * Comma-separated browser origins allowed to call the API cross-origin. Unset
   * allows any origin. The web dashboard calls through its own same-origin proxy and
   * the mobile app is not a browser, so production can keep this narrow.
   */
  CORS_ORIGINS: Joi.string().allow('').optional(),

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
  /** TLS to Postgres — see database/pg-config.ts. RDS needs verify-full (or require). */
  DB_SSL: Joi.string()
    .valid(...DB_SSL_MODES)
    .default('disable'),
  /** Path to the CA bundle used by DB_SSL=verify-full (RDS: global-bundle.pem). */
  DB_SSL_CA: Joi.when('DB_SSL', {
    is: 'verify-full',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),

  // WSO2 Asgardeo — JWKS endpoint the JwtStrategy validates access tokens against.
  // No JWT_SECRET any more: EcoTrack never issues its own tokens under delegated auth.
  OIDC_JWKS_URI: Joi.string().uri().required(),
  // Without an issuer check, any token signed by a key in the JWKS is accepted.
  // Optional for the local mock; required once NODE_ENV=production.
  OIDC_ISSUER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().uri().allow('').optional(),
  }),
  /**
   * Comma-separated client IDs whose access tokens the API accepts (the web and
   * mobile Asgardeo applications). Unset skips the audience check.
   */
  OIDC_AUDIENCE: Joi.string().allow('').optional(),

  // Object storage for incident photos and task evidence (SRS 3.1.15). The same code
  // path serves local MinIO and real S3 — the only difference is the optional
  // settings below, which MinIO needs and AWS does not.
  S3_BUCKET: Joi.string().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  /**
   * Static keys: required for MinIO, and should be left unset on EC2, where the SDK
   * picks up the instance profile role instead. Set both or neither.
   */
  S3_ACCESS_KEY_ID: Joi.string().optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  /** Set for MinIO (http://localhost:9000); leave unset to hit real AWS S3. */
  S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  /** MinIO requires path-style addressing; AWS S3 prefers virtual-host style. */
  S3_FORCE_PATH_STYLE: Joi.boolean().default(false),
  /**
   * Base of the permanent object URL stored with each photo. Clients never load it
   * directly: the bucket is private, and read endpoints hand out presigned URLs (see
   * MediaService.signStoredUrl). Leave unset for real S3.
   */
  S3_PUBLIC_URL: Joi.string().uri().allow('').optional(),

  /**
   * Expo push access token. Only needed once "Enhanced push security" is enabled on
   * the Expo project; without it, push sends are unauthenticated.
   */
  EXPO_ACCESS_TOKEN: Joi.string().allow('').optional(),
}).and('S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY');
