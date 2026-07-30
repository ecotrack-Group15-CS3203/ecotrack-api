import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import dataSource from './data-source';

const SALT_ROUNDS = 10;

/**
 * Bootstraps the very first platform administrator, since public
 * registration never creates one and only a platform admin can create
 * organisations. Run with:
 *   pnpm seed:platform-admin -- --email=you@example.com --password=... --name="Your Name"
 */
async function main() {
  const args = new Map(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      return [key, value];
    }),
  );

  const email = args.get('email');
  const password = args.get('password');
  const fullName = args.get('name') ?? 'Platform Admin';

  if (!email || !password) {
    console.error(
      'Usage: pnpm seed:platform-admin -- --email=you@example.com --password=secret [--name="Your Name"]',
    );
    process.exit(1);
  }

  await dataSource.initialize();

  const existing = await dataSource.query<Array<{ id: string }>>(
    'SELECT id FROM users WHERE email = $1',
    [email],
  );
  if (existing.length > 0) {
    console.error(`A user with email ${email} already exists.`);
    await dataSource.destroy();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await dataSource.query(
    `INSERT INTO users (full_name, email, password_hash, is_platform_admin)
     VALUES ($1, $2, $3, true)`,
    [fullName, email, passwordHash],
  );

  console.log(`Platform admin created: ${email}`);
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
