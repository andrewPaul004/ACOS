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
 * S1H adds a FOURTH, and it is a read credential rather than an audit identity.
 *
 *   SIGNAL       `acos_audit_signal_reader`. `30 §5.7.1`, Transport: "HTTPS, control plane
 *   READER       → audit plane, PULL ONLY. The control plane authenticates with a
 *                READ-ONLY BEARER CREDENTIAL SCOPED TO THIS ENDPOINT and to V7. **The
 *                audit plane accepts no writes on this path**, so the fetch opens no new
 *                suppression channel."
 *
 *                The harness cannot provision an HTTPS host, so the scoped bearer
 *                credential is realised as a dedicated PostgreSQL role with SELECT on the
 *                two signal tables and NOTHING ELSE — no INSERT anywhere, no access to
 *                `audit_journal`, `audit_incident` or the quota ledger. `A0002`'s grants
 *                are the enforcement and `audit-signal-ownership.test.ts` attempts every
 *                forbidden operation as this role. `S1H-result.md §5` reports the HTTP
 *                endpoint itself OPEN.
 *
 *                IT IS DISTINCT FROM THE REPLICATION ROLE. The write direction and the
 *                read direction are two credentials, so a compromised pusher cannot read
 *                the corroboration it wants and a compromised fetcher cannot write.
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
const SIGNAL_READER_ROLE = 'acos_audit_signal_reader';
const SIGNAL_READER_PASSWORD = 'acos_audit_signal_dev';

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

/**
 * The CONTROL plane's read-only credential for the corroboration-signal fetch path.
 * `30 §5.7.1` Transport. SELECT on the two signal tables and nothing else.
 */
export function auditSignalReaderUrl(): string {
  return asRole(auditUrl(), SIGNAL_READER_ROLE, SIGNAL_READER_PASSWORD);
}

export function createAuditSignalReaderPool(): Pool {
  return createPool({
    connectionString: auditSignalReaderUrl(),
    max: 3,
    applicationName: 'acos-audit-signal-reader',
  });
}
