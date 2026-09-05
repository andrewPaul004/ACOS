import { provision } from './localPostgres.js';

/**
 * Vitest global setup. Brings up real PostgreSQL once for the whole run and publishes
 * its URLs into the environment the suite reads.
 *
 * Every S1A test starts from an EMPTY database migrated up. The repository quality gate
 * requires "migrations apply from an empty database" and "migrations can be torn
 * down/recreated in test infrastructure"; running that on every file is how the gate is
 * exercised rather than asserted.
 *
 * S1A-H1. Provisioning also creates the DBOS SYSTEM database and publishes its URL as
 * `ACOS_DBOS_SYS_PG_URL`. The spike must READ that variable and must not derive an
 * infrastructure URL of its own: deriving one is how the original S1A run came to depend
 * on a database created by hand.
 */
export default async function setup(): Promise<void> {
  const result = await provision();
  process.env['ACOS_CONTROL_PG_URL'] = result.controlUrl;
  process.env['ACOS_AUDIT_PG_URL'] = result.auditUrl;
  process.env['ACOS_DBOS_SYS_PG_URL'] = result.dbosSystemUrl;
  process.env['ACOS_PG_SERVER_VERSION'] = result.serverVersion;
  const redact = (url: string): string => url.replace(/:[^:@]*@/, ':***@');
  console.log(
    `[S1A] PostgreSQL ${result.serverVersion} via provider "${result.provider}"\n` +
      `[S1A] control:  ${redact(result.controlUrl)}\n` +
      `[S1A] dbos sys: ${redact(result.dbosSystemUrl)} (provisioned, S1A-H1)`,
  );
}
