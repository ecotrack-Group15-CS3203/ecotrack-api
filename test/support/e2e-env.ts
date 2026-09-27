/**
 * Runs before every e2e spec file (jest-e2e.json `setupFiles`). Keeps the pino
 * request log out of the test output unless a run explicitly asks for it, e.g.
 * `LOG_LEVEL=info pnpm test:integration` when debugging a failing request.
 */
process.env.LOG_LEVEL ??= 'silent';
