import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

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
});
