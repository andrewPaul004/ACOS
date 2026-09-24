import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { auditUrl, createPool } from '../../db/pool.js';
import type { Client } from '../../db/pool.js';

/**
 * The AUDIT plane's migration runner. S1G.
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A SECOND RUNNER AND NOT A PARAMETER ON THE FIRST
 *
 * `30 §5`: the audit store is a "distinct database instance". `24 §3` K11 puts the hash
 * and sequence computation "inside each instance, under roles the writing principal
 * cannot execute as" (I17d).
 *
 * A single runner taking a URL would make the two schemas one schema applied twice, and
 * the first accidental `import` of a control migration into the audit list would be
 * invisible. Two runners, two directories, two ledger tables, and nothing in this file
 * can reach `src/db/migrations/`:
 *
 *   control   src/db/migrate.ts        → src/db/migrations/       → schema_migration
 *   audit     src/audit/db/migrate.ts  → src/audit/db/migrations/ → audit_schema_migration
 *
 * `tests/integration/audit/plane-independence.test.ts` asserts the two directories are
 * disjoint and that neither runner can see the other's files.
 *
 * The one thing this file DOES borrow from `src/db/pool.ts` is `createPool` and
 * `auditUrl` — a connection factory and the audit plane's OWN url. It never imports
 * `controlUrl`, and no audit-plane module does.
 * ---------------------------------------------------------------------------------
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT_MIGRATIONS_DIR = join(HERE, 'migrations');

export interface AuditMigration {
  readonly id: string;
  readonly sql: string;
}

export async function loadAuditMigrations(): Promise<AuditMigration[]> {
  const files = (await readdir(AUDIT_MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: AuditMigration[] = [];
  for (const file of files) {
    migrations.push({ id: file, sql: await readFile(join(AUDIT_MIGRATIONS_DIR, file), 'utf8') });
  }
  return migrations;
}

/** The audit store's own ledger. Deliberately not named `schema_migration`. */
async function ensureAuditLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_schema_migration (
      id          TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function auditUp(client: Client): Promise<string[]> {
  await ensureAuditLedger(client);
  const applied = new Set(
    (
      await client.query<{ id: string }>('SELECT id FROM audit_schema_migration')
    ).rows.map((r) => r.id),
  );
  const ran: string[] = [];
  for (const migration of await loadAuditMigrations()) {
    if (applied.has(migration.id)) continue;
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO audit_schema_migration (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`audit migration ${migration.id} failed: ${String(error)}`, {
        cause: error,
      });
    }
    ran.push(migration.id);
  }
  return ran;
}

/**
 * Tear the audit schema down.
 *
 * The ROLES survive: they are cluster-global, the control plane's replication credential
 * is provisioned against them, and dropping them on every test reset would make the role
 * boundary a thing the suite recreates rather than a thing it tests.
 */
export async function auditDown(client: Client): Promise<void> {
  // RESIDUAL 13 — idempotent teardown, for the reason `src/db/migrate.ts` records.
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
}

export async function auditReset(client: Client): Promise<string[]> {
  await auditDown(client);
  return auditUp(client);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  const pool = createPool({ connectionString: auditUrl(), max: 1, applicationName: 'acos-audit' });
  const client = await pool.connect();
  try {
    if (command === 'up') {
      const ran = await auditUp(client);
      console.log(ran.length ? `audit applied: ${ran.join(', ')}` : 'audit already up to date');
    } else if (command === 'reset') {
      const ran = await auditReset(client);
      console.log(`audit reset, applied: ${ran.join(', ')}`);
    } else if (command === 'down') {
      await auditDown(client);
      console.log('audit dropped');
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
