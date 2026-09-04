import pg from 'pg';

/**
 * Money arrives from PostgreSQL as NUMERIC. `pg` returns NUMERIC as a string by
 * default, which is the only lossless representation, and this module never converts
 * one to a JavaScript number.
 *
 * `30 §5.3` (ACOS-JCS-1) states the rule this implements: "Per-column declared decimal
 * scale, serialised as a string at that exact scale. `25.0` and `25.00` are different
 * bytes, deliberately — a scale change is a semantic change in a money field."
 *
 * The default `pg` behaviour is therefore correct and is asserted rather than
 * overridden. BIGINT (OID 20) is also returned as a string for the same reason; the
 * count ledgers are converted explicitly where they are used.
 */
const NUMERIC_OID = 1700;
const parsedAsString = pg.types.getTypeParser(NUMERIC_OID);
if (parsedAsString('1.00') !== '1.00') {
  throw new Error(
    'pg is parsing NUMERIC to a JavaScript number. Money would lose precision. Refusing to start.',
  );
}

export type Client = pg.PoolClient;
export type Pool = pg.Pool;

export interface PoolOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
}

export function createPool(options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'acos-s1a',
    // Targeted-interleaving tests deliberately hold a transaction at a barrier. A short
    // idle-in-transaction timeout would kill the very state the test is examining.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function controlUrl(): string {
  const url = process.env['ACOS_CONTROL_PG_URL'];
  if (!url) {
    throw new Error('ACOS_CONTROL_PG_URL is not set. See .env.example.');
  }
  return url;
}

export function auditUrl(): string {
  const url = process.env['ACOS_AUDIT_PG_URL'];
  if (!url) {
    throw new Error('ACOS_AUDIT_PG_URL is not set. See .env.example.');
  }
  return url;
}

export type IsolationLevel =
  | 'READ COMMITTED'
  | 'REPEATABLE READ'
  | 'SERIALIZABLE';

/**
 * Run `fn` inside one explicit transaction at the given isolation level.
 *
 * Explicit BEGIN/COMMIT, no ORM, no implicit transaction management. The S1A mandate
 * and `24 §3` K5 both turn on exactly where a transaction begins and ends, so that
 * boundary is written out rather than inferred from a decorator.
 */
export async function inTransaction<T>(
  client: Client,
  isolation: IsolationLevel,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; the original error is the one that matters.
    }
    throw error;
  }
}
