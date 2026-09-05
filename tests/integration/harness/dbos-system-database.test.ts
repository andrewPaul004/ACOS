import { afterAll, describe, expect, it } from 'vitest';

import pg from 'pg';

import {
  DBOS_SYSTEM_DATABASE,
  dbosSystemUrlFor,
  ensureDatabase,
  ensureDbosSystemDatabase,
  withDatabase,
} from '../../support/localPostgres.js';

/**
 * S1A-H1 — the DBOS spike's clean-environment bootstrap prerequisite.
 *
 * THE DEFECT THIS TEST EXISTS TO PREVENT, recorded rather than smoothed over.
 *
 * `docker compose up` creates `acos_control` on the control server and `acos_audit` on
 * the audit server. It creates nothing else. The durable-execution spike, however,
 * derived `ACOS_DBOS_SYS_PG_URL` from `ACOS_AUDIT_PG_URL` by string substitution and
 * expected `acos_dbos_sys` to already exist. From a genuinely clean environment it does
 * not, and five candidate-A tests failed:
 *
 *   3D000: database "acos_dbos_sys" does not exist
 *
 * The original S1A run was green only because that database had been created BY HAND.
 * That is a test-harness reproducibility defect — not a money-path defect and not a DBOS
 * semantic failure — and this file is its regression assertion.
 *
 * The repair is in `tests/support/localPostgres.ts`: `provision()` creates the database
 * over a `pg` connection to the maintenance database (never by shelling out to `psql`),
 * on BOTH the Docker/external provider and the local PostgreSQL-binary provider, and
 * RETURNS the resulting URL, which `globalSetup.ts` publishes. The spike now reads that
 * variable instead of deriving infrastructure provisioning does not know about.
 *
 * The clean reproduction the owner required:
 *
 *   npm run db:down  &&  npm run db:up  &&  npm test
 *
 * with no manual SQL.
 */

const clients: pg.Client[] = [];

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  clients.push(client);
  return client;
}

afterAll(async () => {
  for (const client of clients) {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
});

describe('S1A-H1 — the DBOS system database is provisioned by the harness', () => {
  it('provisioning published ACOS_DBOS_SYS_PG_URL, and it names acos_dbos_sys', () => {
    const url = process.env['ACOS_DBOS_SYS_PG_URL'];
    expect(
      url,
      'ACOS_DBOS_SYS_PG_URL is unset — globalSetup did not publish the provisioned URL',
    ).toBeTruthy();
    expect(new URL(url!).pathname).toBe(`/${DBOS_SYSTEM_DATABASE}`);
  });

  it('it is a DIFFERENT database on the SAME server as the audit URL', () => {
    // The system database is a second database, which is the whole reason candidate A's
    // coupling cost exists (ADR-IMP-002 §4.1). The audit SERVER hosts it as a
    // convenience; it is NOT the architecture's audit plane.
    const sys = new URL(process.env['ACOS_DBOS_SYS_PG_URL']!);
    const audit = new URL(process.env['ACOS_AUDIT_PG_URL']!);
    expect(sys.host).toBe(audit.host);
    expect(sys.pathname).not.toBe(audit.pathname);
  });

  it('THE PREREQUISITE: connecting to it succeeds — no 3D000, no manual CREATE DATABASE', async () => {
    // This is the exact connection the spike's `resetDbosState()` and candidate A's
    // `systemDatabaseUrl` make. Before the repair it raised
    // `3D000 database "acos_dbos_sys" does not exist` from a clean environment.
    const client = await connect(process.env['ACOS_DBOS_SYS_PG_URL']!);
    const result = await client.query<{ current_database: string }>('SELECT current_database()');
    expect(result.rows[0]?.current_database).toBe(DBOS_SYSTEM_DATABASE);
  });

  it('pg_database on the audit server lists it', async () => {
    const client = await connect(withDatabase(process.env['ACOS_AUDIT_PG_URL']!, 'postgres'));
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DBOS_SYSTEM_DATABASE,
    ]);
    expect(result.rowCount, `${DBOS_SYSTEM_DATABASE} is absent from pg_database`).toBe(1);
  });

  it('provisioning is idempotent — running it again is a no-op that returns the same URL', async () => {
    // globalSetup runs once per suite, but `db:up` on an environment that already has the
    // database, a re-run, and two concurrent runs must all be safe. `ensureDatabase`
    // checks `pg_database` first and tolerates 42P04 if it loses the race.
    const audit = process.env['ACOS_AUDIT_PG_URL']!;
    const first = await ensureDbosSystemDatabase(audit);
    const second = await ensureDbosSystemDatabase(audit);
    expect(first).toBe(second);
    expect(first).toBe(dbosSystemUrlFor(audit));
  });

  it('the target database name must be TRUSTED and static — an arbitrary name is refused', async () => {
    // The name is interpolated into `CREATE DATABASE` because PostgreSQL accepts no
    // parameter there. This is the check that makes that safe: only the three names this
    // repository declares are creatable, so a name reaching the helper from an edited
    // environment variable cannot become DDL.
    await expect(
      ensureDatabase(process.env['ACOS_AUDIT_PG_URL']!, 'acos_not_a_declared_database'),
    ).rejects.toThrow(/not a trusted S1A database name/);
  });
});
