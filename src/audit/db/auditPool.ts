import { auditUrl, createPool } from '../../db/pool.js';
import type { Pool } from '../../db/pool.js';

/**
 * The audit store's connection identities. S1G.
 *
 * ---------------------------------------------------------------------------------
 * THREE ROLES, THREE URLS, AND WHY THE DISTINCTION IS NOT COSMETIC
 *
 * `30 §5`: "the control plane holds INSERT and nothing else, under a per-principal
 * insert quota (I17c)"; "the audit writer identity is not reachable from any operating
 * principal (B5)"; and `I17d`: hash and sequence "under roles the writing principal
 * cannot execute as."
 *
 *   OWNER        `ACOS_AUDIT_PG_URL` — migrations only. Owns the tables, the triggers and
 *                the SECURITY DEFINER functions. Never used by the replication path.
 *   REPLICATION  `acos_audit_replication`. What the CONTROL plane connects as. INSERT on
 *                `audit_journal` and EXECUTE on the ingest entry point. It cannot UPDATE
 *                or DELETE an accepted row, cannot choose a chain value, cannot write or
 *                read an incident, and cannot touch the quota ledger.
 *   EVALUATOR    `acos_audit_evaluator`. What the AUDIT plane's own checks connect as.
 *                SELECT on the holdings, INSERT on findings, and NO INSERT on the
 *                holdings — so the evaluator cannot manufacture what it then certifies.
 *
 * The passwords are the local development values `A0001__audit_store.sql` creates the
 * roles with, for the same reason `docker-compose.yml`'s are committed: the environment
 * must be reproducible from a clean clone. No production credential exists in this
 * repository, and `.env.example` says so.
 * ---------------------------------------------------------------------------------
 */

const REPLICATION_ROLE = 'acos_audit_replication';
const REPLICATION_PASSWORD = 'acos_audit_repl_dev';
const EVALUATOR_ROLE = 'acos_audit_evaluator';
const EVALUATOR_PASSWORD = 'acos_audit_eval_dev';

function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

/** The CONTROL plane's credential into the audit store. INSERT-scoped. */
export function auditReplicationUrl(): string {
  return asRole(auditUrl(), REPLICATION_ROLE, REPLICATION_PASSWORD);
}

/** The AUDIT plane's own credential. Read the holdings, write findings. */
export function auditEvaluatorUrl(): string {
  return asRole(auditUrl(), EVALUATOR_ROLE, EVALUATOR_PASSWORD);
}

export function createAuditReplicationPool(): Pool {
  return createPool({
    connectionString: auditReplicationUrl(),
    max: 5,
    applicationName: 'acos-audit-replication',
  });
}

export function createAuditEvaluatorPool(): Pool {
  return createPool({
    connectionString: auditEvaluatorUrl(),
    max: 5,
    applicationName: 'acos-audit-evaluator',
  });
}
