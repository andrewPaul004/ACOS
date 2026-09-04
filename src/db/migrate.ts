import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { controlUrl, createPool } from './pool.js';
import type { Client } from './pool.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');

/**
 * A deliberately small forward-only migration runner over plain SQL files.
 *
 * The S1A mandate prefers "PostgreSQL-native constraints; SQL migrations; explicit
 * transactions; explicit locking [...] over ORM abstractions that obscure concurrency
 * semantics." A migration tool that rewrites DDL, wraps it in its own transaction
 * semantics, or reorders statements would obscure exactly the thing under test, so
 * there is not one. Each file is applied verbatim in one transaction.
 */

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    migrations.push({
      id: file,
      sql: await readFile(join(MIGRATIONS_DIR, file), 'utf8'),
    });
  }
  return migrations;
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id          TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function up(client: Client): Promise<string[]> {
  await ensureLedger(client);
  const applied = new Set(
    (await client.query<{ id: string }>('SELECT id FROM schema_migration')).rows.map(
      (r) => r.id,
    ),
  );
  const ran: string[] = [];
  for (const migration of await loadMigrations()) {
    if (applied.has(migration.id)) continue;
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migration (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${migration.id} failed: ${String(error)}`, {
        cause: error,
      });
    }
    ran.push(migration.id);
  }
  return ran;
}

/**
 * Tear the schema down completely. The S1A repository quality gate requires that
 * "migrations can be torn down/recreated in test infrastructure", and the integration
 * suite exercises this on every run: an empty database, migrated up, is the only state
 * the tests ever start from.
 */
export async function down(client: Client): Promise<void> {
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
}

export async function reset(client: Client): Promise<string[]> {
  await down(client);
  return up(client);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  const pool = createPool({ connectionString: controlUrl(), max: 1 });
  const client = await pool.connect();
  try {
    if (command === 'up') {
      const ran = await up(client);
      console.log(ran.length ? `applied: ${ran.join(', ')}` : 'already up to date');
    } else if (command === 'reset') {
      const ran = await reset(client);
      console.log(`reset, applied: ${ran.join(', ')}`);
    } else if (command === 'down') {
      await down(client);
      console.log('dropped');
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
