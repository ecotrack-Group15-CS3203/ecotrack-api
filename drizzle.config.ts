import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { buildPgPoolConfig } from './src/database/pg-config';

const pool = buildPgPoolConfig((key) => process.env[key], { migrator: true });

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './src/database/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: pool.host!,
    port: pool.port,
    user: pool.user,
    password: pool.password as string | undefined,
    database: pool.database!,
    ssl: pool.ssl,
  },
});
