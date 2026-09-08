import { createPool, type Client, type Pool } from '../../src/db/pool.js';
import { auditUp, auditDown } from '../../src/audit/db/migrate.js';
import {
  auditEvaluatorUrl,
  auditReplicationUrl,
} from '../../src/audit/db/auditPool.js';

/**
 * The S1G AUDIT-PLANE harness.
 *
 * =================================================================================
 * FOUR CONNECTIONS, THREE ROLES, ONE SERVER THAT IS NOT THE CONTROL SERVER.
 *
 *   owner        `ACOS_AUDIT_PG_URL`, the migrating superuser. Schema only.
 *   replication  `acos_audit_replication`. What the CONTROL plane connects as.
 *   evaluator    `acos_audit_evaluator`. What the AUDIT plane's checks connect as.
 *   (control)    a DIFFERENT PostgreSQL server entirely — `tests/support/fixture.ts`.
 *
 * `docker-compose.yml` starts two servers on two ports; `tests/support/localPostgres.ts`
 * starts two clusters in two data directories on the binary-fallback path. Either way the
 * audit store is a distinct PostgreSQL INSTANCE, not a schema in the control database, and
 * `plane-independence.test.ts` asserts the distinctness against `pg_control_system()` and
 * the port rather than against the two URLs being different strings.
 *
 * WHAT THIS HARNESS IS NOT. `30 §5` requires a "different provider or, at minimum, a
 * separate account with a separate payment method and separate operator credentials".
 * Two containers on one laptop are not that, `docker-compose.yml` has said so since S1A,
 * and `S1G-result.md` reports that leg OPEN.
 * =================================================================================
 */

export interface AuditHarness {
  /** Owner. Migrations and direct-SQL oracles only. */
  readonly owner: Pool;
  /** The CONTROL plane's credential. INSERT-scoped. */
  readonly replication: Pool;
  /** The AUDIT plane's own credential. Reads holdings, writes findings. */
  readonly evaluator: Pool;
  readonly url: string;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createAuditHarness(): Promise<AuditHarness> {
  const url = process.env['ACOS_AUDIT_PG_URL'];
  if (!url) throw new Error('ACOS_AUDIT_PG_URL is not set; globalSetup did not run');

  const owner = createPool({
    connectionString: url,
    max: 8,
    applicationName: 'acos-s1g-audit-owner',
  });

  // The roles do not exist until the first migration runs, so the scoped pools are built
  // lazily — after `reset()` — and held here once created.
  let replication: Pool | null = null;
  let evaluator: Pool | null = null;

  const harness: AuditHarness = {
    owner,
    get replication(): Pool {
      if (replication === null) {
        replication = createPool({
          connectionString: auditReplicationUrl(),
          max: 8,
          applicationName: 'acos-s1g-audit-replication',
        });
      }
      return replication;
    },
    get evaluator(): Pool {
      if (evaluator === null) {
        evaluator = createPool({
          connectionString: auditEvaluatorUrl(),
          max: 8,
          applicationName: 'acos-s1g-audit-evaluator',
        });
      }
      return evaluator;
    },
    url,
    async reset() {
      const client = await owner.connect();
      try {
        await auditDown(client);
        await auditUp(client);
      } finally {
        client.release();
      }
    },
    async close() {
      await owner.end();
      if (replication !== null) await replication.end();
      if (evaluator !== null) await evaluator.end();
    },
  };
  return harness;
}

/** Direct SQL against the audit store, as the owner. For oracles, never for production. */
export async function auditSql<T extends Record<string, unknown>>(
  harness: AuditHarness,
  sql: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  const client: Client = await harness.owner.connect();
  try {
    const result = await client.query<T>(sql, [...params]);
    return result.rows;
  } finally {
    client.release();
  }
}
