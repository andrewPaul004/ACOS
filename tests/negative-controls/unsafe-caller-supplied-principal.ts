import type { Client } from '../../src/db/pool.js';
import type { PrincipalKind, ResolvedPrincipal } from '../../src/kernel/canonicalisation/types.js';
import type { AuthoritativePrincipal } from '../../src/kernel/authority/principal.js';

/**
 * INTENTIONALLY VULNERABLE — TEST ONLY. NEVER IMPORTED FROM `src/`.
 *
 * `26 §7` step D's defect: a principal the CALLER asserts.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS IMPLEMENTS, AND WHY IT HAS TO EXIST
 *
 * `26 §2.1` requires the request's principal to be "resolved, signed, chain-verified —
 * **stamped by the kernel, never a parameter**". The production resolver honours that
 * structurally: `PrincipalResolver.resolve` takes a `RuntimeSessionRef` and a task id and has
 * no argument position for a principal.
 *
 * A test asserting "production denies the spoof" against production alone proves nothing,
 * because production has no spoof to reject — the attack is inexpressible. So the attack is
 * expressed HERE, in an implementation that accepts it, and the discriminating test runs the
 * SAME fixture through both:
 *
 *   this file      accepts `assertedPrincipalId` and resolves THAT principal
 *   production     resolves the principal the SESSION names, and denies
 *
 * The two disagree on one fixture, which is what makes the production property observable.
 *
 * ---------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY THE SAME
 *
 * Everything except the identity source. It reads the same `principal` table, produces the
 * same `AuthoritativePrincipal` shape and performs the same session-expiry check, so the
 * discriminating difference is the trust boundary rather than a missing feature. It does NOT
 * verify the delegation chain, because a caller-asserted principal has no chain to verify —
 * which is itself the point.
 */

export interface UnsafeAssertedIdentity {
  readonly companyId: string;
  readonly sessionId: string;
  /** THE DEFECT. A caller-supplied principal id, trusted. */
  readonly assertedPrincipalId: string;
}

export async function unsafeResolvePrincipalFromAssertion(
  client: Client,
  asserted: UnsafeAssertedIdentity,
): Promise<AuthoritativePrincipal | null> {
  // The session is looked up — and then IGNORED for identity, which is the whole bug. A
  // reviewer skimming this would see a session check and assume the identity came from it.
  const session = await client.query<{ principal_id: string }>(
    `SELECT principal_id FROM principal_session WHERE company_id = $1 AND session_id = $2`,
    [asserted.companyId, asserted.sessionId],
  );
  if (session.rows.length === 0) return null;

  const rows = await client.query<{
    principal_id: string;
    kind: string;
    role: string;
    model_binding: string | null;
  }>(
    `SELECT principal_id, kind, role, model_binding
       FROM principal
      WHERE company_id = $1 AND principal_id = $2`,
    [asserted.companyId, asserted.assertedPrincipalId],
  );
  const row = rows.rows[0];
  if (row === undefined) return null;

  const resolved: ResolvedPrincipal = {
    id: row.principal_id,
    kind: row.kind as PrincipalKind,
    role: row.role,
    modelBinding: row.model_binding,
    delegationDepth: 0,
  };
  return { resolved, chain: [], effectiveActionClasses: null };
}
