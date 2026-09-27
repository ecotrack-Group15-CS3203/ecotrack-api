/**
 * A stand-in for the Drizzle instance TenantDbService exposes, for unit tests.
 *
 * - Builder chains (db.insert(..).values(..).returning(), db.update(..).set(..).where(..),
 *   db.select(..).from(..).where(..), ...) all return one shared builder. Awaiting it
 *   resolves to the next value queued with `nextResult()`, in call order.
 * - db.query.<table>.findFirst / findMany are jest.fn()s, created on first access.
 * - db.execute is a jest.fn() (raw SQL); give it `mockResolvedValueOnce({ rows })`.
 */
type Fn = jest.Mock;

export interface FakeDb {
  db: Record<string, unknown> & {
    execute: Fn;
    query: Record<string, { findFirst: Fn; findMany: Fn }>;
  };
  /** Queues the value the next awaited builder chain resolves to. */
  nextResult(value: unknown): FakeDb;
  /** Every builder method called, in order, e.g. ['update', 'set', 'where', 'returning']. */
  calls: { method: string; args: unknown[] }[];
}

const BUILDER_METHODS = [
  'insert',
  'update',
  'delete',
  'select',
  'from',
  'where',
  'set',
  'values',
  'returning',
  'innerJoin',
  'leftJoin',
  'limit',
  'offset',
  'orderBy',
  'groupBy',
  'onConflictDoUpdate',
  'onConflictDoNothing',
];

export function createFakeDb(): FakeDb {
  const queue: unknown[] = [];
  const calls: FakeDb['calls'] = [];
  const builder: Record<string, unknown> = {};
  for (const method of BUILDER_METHODS) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(queue.shift()).then(resolve, reject);

  const tables: Record<string, { findFirst: Fn; findMany: Fn }> = {};
  const query = new Proxy(tables, {
    get: (target, table: string) =>
      (target[table] ??= { findFirst: jest.fn(), findMany: jest.fn() }),
  });

  const db = {
    insert: builder.insert,
    update: builder.update,
    delete: builder.delete,
    select: builder.select,
    execute: jest.fn(),
    query,
  } as FakeDb['db'];

  const fake: FakeDb = {
    db,
    calls,
    nextResult(value) {
      queue.push(value);
      return fake;
    },
  };
  return fake;
}
