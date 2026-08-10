import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './src/database/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER!,
    password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
  },
});
