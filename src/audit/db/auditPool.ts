import { auditUrl, createPool } from '../../db/pool.js';
import { validateRoleScopedUrl } from './roleScopedUrl.js';
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
/**
 * v1.3.8, `48 §8` — the PROVIDER-EVIDENCE INGRESS's credential into the audit store.
 *
 * INSERT and SELECT on the three `A0009` provider-evidence tables, and nothing else in this
 * store: no `audit_journal`, no incident, no quota ledger, no signal table. SELECT exists so a
 * redelivered provider event is acknowledged only after its ORIGINAL durable row is confirmed
 * present (ADR-027 decision 4a). Distinct from the evaluator: the process that WRITES provider
 * evidence is not the one that certifies anything over it.
 */
const EVIDENCE_INGRESS_ROLE = 'acos_audit_evidence_ingress';
const EVIDENCE_INGRESS_PASSWORD = 'acos_audit_ingress_dev';
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
/**
 * The evaluator's credential.
 *
 * S1P-WD — A URL THAT ALREADY NAMES `acos_audit_evaluator` IS THAT ROLE'S OWN DEPLOYMENT
 * CREDENTIAL. It is used verbatim ONLY if it passes `roleScopedUrl.ts` — host, database, password,
 * and exactly one `sslmode=verify-full` — and otherwise this THROWS: a role-specific credential
 * with weaker TLS is refused, never repaired. A live S1P validation run is therefore handed the
 * evaluator's rotated credential over verified TLS and never the audit OWNER URL.
 *
 * Any other user is the LOCAL DEVELOPMENT owner URL, from which the role is derived with its
 * committed development password exactly as before (no TLS requirement on 127.0.0.1).
 */
export function auditEvaluatorUrl(): string {
  const url = auditUrl();
  if (decodeURIComponent(new URL(url).username) === EVALUATOR_ROLE) return auditEvaluatorDeploymentUrl(url);
  return asRole(url, EVALUATOR_ROLE, EVALUATOR_PASSWORD);
}

/** The evaluator's role-specific deployment URL, validated and returned UNCHANGED, or a throw. */
export function auditEvaluatorDeploymentUrl(url: string): string {
  const checked = validateRoleScopedUrl(url, EVALUATOR_ROLE);
  if (!checked.ok) {
    throw new Error(`the evaluator's role-specific audit-store URL is refused: ${checked.refusal}`);
  }
  return checked.url;
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

/**
 * v1.3.8 — the provider-evidence ingress's own credential. `A0009`'s grants are the scope.
 *
 * LOCAL DEVELOPMENT AND TESTS ONLY (S1P-WD). The deployed ingress does not import this module:
 * it uses `src/audit/providerEvidence/evidenceIngressPool.ts`, which accepts only a supplied
 * role-specific URL and contains no password, so the development passwords above never enter
 * the ingress image.
 */
export function auditEvidenceIngressUrl(): string {
  return asRole(auditUrl(), EVIDENCE_INGRESS_ROLE, EVIDENCE_INGRESS_PASSWORD);
}

export function createAuditEvidenceIngressPool(): Pool {
  return createPool({
    connectionString: auditEvidenceIngressUrl(),
    max: 5,
    applicationName: 'acos-audit-evidence-ingress',
  });
}
