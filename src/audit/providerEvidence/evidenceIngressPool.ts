import { createPool, type Pool } from '../../db/pool.js';
import { ROLE_SCOPED_URL_REFUSALS, validateRoleScopedUrl } from '../db/roleScopedUrl.js';

/**
 * S1P-WD — THE PROVIDER-EVIDENCE INGRESS'S DATABASE CONNECTION, AND NOTHING ELSE.
 *
 * =================================================================================
 * WHY THIS IS NOT `src/audit/db/auditPool.ts`
 *
 * `auditPool.ts` derives every audit role's URL from a local OWNER URL and therefore carries the
 * repository's committed development passwords. That is right for local development and tests,
 * and wrong for a deployed process: an image built from it would contain database password
 * literals, and a process using it would need the audit OWNER credential.
 *
 * The deployed ingress imports THIS module instead. It holds no password, derives none, and has
 * no owner fallback: the deployment supplies `ACOS_AUDIT_PG_URL` as the ingress ROLE's own URL
 * (a platform secret), and it is used VERBATIM — after `roleScopedUrl.ts` has checked it: the
 * exact role, a host, a database, a password, and EXACTLY ONE `sslmode=verify-full` with no
 * competing TLS or host parameter. A URL naming any other role — the owner, the evaluator, the
 * replication or signal-reader role — or weaker TLS is REFUSED at startup, never rewritten: the
 * ingress may only ever hold its own role's credential, whose scope is `A0009`'s INSERT+SELECT
 * on the three provider-evidence tables, over verified TLS.
 * =================================================================================
 */

/** The only database role the ingress may connect as. */
export const EVIDENCE_INGRESS_ROLE = 'acos_audit_evidence_ingress';

/** The deployment variable carrying the ingress role's own audit-store URL. */
export const EVIDENCE_INGRESS_URL_VARIABLE = 'ACOS_AUDIT_PG_URL';

/**
 * The ingress's closed refusal set: the shared role-scoped-URL refusals, with a role mismatch
 * named for what it means here.
 */
export const EVIDENCE_INGRESS_URL_REFUSALS = [
  ...ROLE_SCOPED_URL_REFUSALS.filter((refusal) => refusal !== 'AUDIT_STORE_ROLE_MISMATCH'),
  'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS',
] as const;

export type EvidenceIngressUrlRefusal =
  | Exclude<(typeof ROLE_SCOPED_URL_REFUSALS)[number], 'AUDIT_STORE_ROLE_MISMATCH'>
  | 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS';

/**
 * The ingress's audit-store URL from the deployment environment, or a refusal. Read from the SAME
 * environment record the ingress takes every other deployment input from.
 */
export function evidenceIngressUrl(
  environment: Readonly<Record<string, string | undefined>>,
): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly refusal: EvidenceIngressUrlRefusal } {
  const checked = validateRoleScopedUrl(environment[EVIDENCE_INGRESS_URL_VARIABLE], EVIDENCE_INGRESS_ROLE);
  if (checked.ok) return checked;
  return {
    ok: false,
    refusal: checked.refusal === 'AUDIT_STORE_ROLE_MISMATCH' ? 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS' : checked.refusal,
  };
}

/** A pool over exactly the URL the deployment supplied. Callers obtain it from `evidenceIngressUrl`. */
export function createEvidenceIngressPool(url: string): Pool {
  return createPool({
    connectionString: url,
    max: 5,
    applicationName: 'acos-audit-evidence-ingress',
  });
}
