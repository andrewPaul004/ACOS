import { createPublicKey, verify as verifySignature } from 'node:crypto';

import type { Client } from '../../db/pool.js';
import { canonicalBytes } from '../canonicalisation/canonicalBytes.js';
import type { PrincipalKind, ResolvedPrincipal } from '../canonicalisation/types.js';
import type { Clock } from '../enumeration/clock.js';
import { authorityDefect, denyAuthority } from './errors.js';

/**
 * Step D — "Principal authenticated, chain signature valid, depth ≤ 3?"
 *
 * `26 §7`'s flowchart edge, verbatim: `D -->|no| D3[DENY: PRINCIPAL]`.
 *
 * ---------------------------------------------------------------------------------
 * THE CALLER NAMES A SESSION. IT DOES NOT NAME A PRINCIPAL.
 *
 * `26 §2.1`, on the request's principal field, verbatim: "resolved, signed, chain-verified —
 * **stamped by the kernel, never a parameter**."
 *
 * `resolvePrincipal` takes a `company_id` and a `session_id` and returns the principal it
 * finds. There is NO parameter for a principal id, a kind, a role, a model binding or a
 * depth, no overload that accepts one and no optional argument. A caller wishing to act as
 * another principal has no argument position in which to say so; it would have to forge a
 * row in `principal_session`, which is kernel state.
 *
 * That distinction is what
 * `tests/negative-controls/unsafe-caller-supplied-principal.ts` makes visible: the
 * vulnerable implementation takes `assertedPrincipalId` and trusts it, and the same fixture
 * that lets it through is denied here because the SESSION resolves to the unauthorised
 * principal.
 *
 * ---------------------------------------------------------------------------------
 * THE THREE CHAIN RULES, AND WHY DEPTH IS COUNTED
 *
 * `26 §3`'s chain rules, verbatim:
 *
 *   "1. Each hop is signed by the delegating principal's key, held by the kernel, not by
 *       the model.
 *    2. **Capability-subset validation:** a delegate's effective grants are the intersection
 *       of its own role grants and the delegator's held grants. A delegation can only
 *       narrow.
 *    3. `delegation_depth ≤ 3`. Beyond that, deny."
 *
 * Rule 3 is evaluated against `count(delegation_hop)`, never against a stored integer. A cap
 * compared to a figure its subject wrote is `26 §1` Corollary 3's defect wearing a different
 * hat, and the `principal` table deliberately has no `delegation_depth` column for exactly
 * that reason.
 *
 * Rule 2 produces the EFFECTIVE CAPABILITY SET, which step I intersects the matching grant's
 * `action_class_selector` against. Without that hand-off, rule 2 would be a check that
 * nothing consumed.
 *
 * ---------------------------------------------------------------------------------
 * RULE 4 IS STRUCTURAL AND NEEDS NO CODE
 *
 * `26 §3` rule 4, verbatim: "**The principal on the request is the agent, not the owner.**
 * […] An owner approval is an *attribute of the request*, not a substitution of principal —
 * otherwise an approved action inherits owner authority, which is exactly the
 * confused-deputy escalation."
 *
 * S1E has no approval object and no substitution path, so there is nothing to check: the
 * principal is whatever the session resolves to, once, and no later step can replace it.
 * ---------------------------------------------------------------------------------
 */

/**
 * The ONLY thing a caller supplies about identity.
 *
 * One field. `26 §7` step D reads it, resolves everything else, and there is no second
 * field through which anything about the principal could arrive.
 */
export interface RuntimeSessionRef {
  readonly companyId: string;
  readonly sessionId: string;
}

/** One verified hop of `26 §3`'s `delegation_chain[]`. */
export interface VerifiedDelegationHop {
  readonly hopIndex: number;
  readonly delegatingPrincipalId: string;
  readonly grantedActionClasses: readonly string[];
}

/**
 * `26 §3`'s Principal, resolved, with the chain verified.
 *
 * `effectiveActionClasses` is rule 2's intersection. It is `null` when the chain is empty —
 * a root principal delegated from nobody, whose authority is bounded by its grants alone.
 * `null` is NOT "everything": step I treats `null` as "no delegated narrowing applies",
 * which is only reachable for a principal with no hops at all.
 */
export interface AuthoritativePrincipal {
  readonly resolved: ResolvedPrincipal;
  readonly chain: readonly VerifiedDelegationHop[];
  readonly effectiveActionClasses: ReadonlySet<string> | null;
}

/** `26 §3` rule 3, verbatim: "`delegation_depth ≤ 3`. Beyond that, deny." */
export const MAX_DELEGATION_DEPTH = 3;

interface PrincipalRow {
  readonly principal_id: string;
  readonly kind: string;
  readonly role: string;
  readonly model_binding: string | null;
  readonly status: string;
}

interface SessionRow {
  readonly principal_id: string;
  readonly expires_at: Date;
}

interface HopRow {
  readonly hop_index: number;
  readonly delegating_principal_id: string;
  readonly granted_action_classes: string[];
  readonly signature: Buffer;
}

const PRINCIPAL_KINDS: ReadonlySet<string> = new Set<PrincipalKind>([
  'OWNER',
  'KERNEL_SERVICE',
  'AI_ROLE',
  'ADAPTER',
  'AUDIT_REVIEWER',
]);

/**
 * The bytes a delegating principal signs for one hop.
 *
 * The same framing discipline `constructorVersion.ts` uses, for the same reason: the granted
 * subset is a list of strings and a naive concatenation would let `['a.b', 'c']` and
 * `['a', 'b.c']` produce one signature between them. `canonicalBytes` applies 4-byte
 * big-endian length framing per field and RFC 8785 to the JSON array.
 *
 * Exported so the test signer signs over EXACTLY what the verifier reads. A fixture that
 * built its own preimage would be testing two implementations of a hash rather than a
 * signature check.
 */
export function delegationHopSigningBytes(hop: {
  readonly companyId: string;
  readonly principalId: string;
  readonly hopIndex: number;
  readonly delegatingPrincipalId: string;
  readonly grantedActionClasses: readonly string[];
}): Buffer {
  return canonicalBytes('acos.delegation_hop.v1', [
    { kind: 'text', value: hop.companyId },
    { kind: 'text', value: hop.principalId },
    { kind: 'integer', value: BigInt(hop.hopIndex) },
    { kind: 'text', value: hop.delegatingPrincipalId },
    // Sorted, so the signature commits to a SET rather than to one ordering of it.
    { kind: 'json', value: [...hop.grantedActionClasses].sort() },
  ]);
}

export interface PrincipalResolverOptions {
  readonly clock: Clock;
}

export class PrincipalResolver {
  readonly #clock: Clock;

  constructor(options: PrincipalResolverOptions) {
    this.#clock = options.clock;
  }

  /**
   * `26 §7` step D, evaluated on the LEASE'S OWN CLIENT.
   *
   * `client` is the connection holding the entity execution lease. Every authoritative read
   * S1E performs runs on it, which is what makes "the same session held the lease from C′
   * through the final gate" a property of the code rather than of the call site's
   * discipline — a resolver reading from an unrelated pool connection would observe state
   * the lease does not protect.
   */
  async resolve(
    client: Client,
    session: RuntimeSessionRef,
    taskId: string,
  ): Promise<AuthoritativePrincipal> {
    const now = this.#clock.now();

    // --- 1. the session ------------------------------------------------------------------
    const sessionRow = await client.query<SessionRow>(
      `SELECT principal_id, expires_at
         FROM principal_session
        WHERE company_id = $1 AND session_id = $2`,
      [session.companyId, session.sessionId],
    );
    const found = sessionRow.rows[0];
    if (found === undefined) {
      denyAuthority(
        'D',
        'PRINCIPAL',
        'SESSION_UNKNOWN',
        'the runtime session does not resolve to a principal',
      );
    }
    if (found.expires_at.getTime() <= now.getTime()) {
      denyAuthority('D', 'PRINCIPAL', 'SESSION_EXPIRED', 'the runtime session has expired');
    }

    // --- 2. the principal ----------------------------------------------------------------
    const principalRow = await client.query<PrincipalRow>(
      `SELECT principal_id, kind, role, model_binding, status
         FROM principal
        WHERE company_id = $1 AND principal_id = $2`,
      [session.companyId, found.principal_id],
    );
    const principal = principalRow.rows[0];
    if (principal === undefined) {
      // The session's FK guarantees the row exists, so its absence is corruption rather
      // than a proposal. It is still denied rather than thrown, because the safe behaviour
      // for a missing identity is refusal.
      denyAuthority(
        'D',
        'PRINCIPAL',
        'SESSION_UNKNOWN',
        'the session names a principal with no authoritative row',
      );
    }
    if (principal.status !== 'ACTIVE') {
      denyAuthority('D', 'PRINCIPAL', 'PRINCIPAL_SUSPENDED', 'the principal is not ACTIVE');
    }
    if (!PRINCIPAL_KINDS.has(principal.kind)) {
      authorityDefect('D', `principal ${principal.principal_id} has undeclared kind`);
    }
    if (principal.role.length === 0) {
      // `36 §3` layer 2, and the accepted S1D fail-closed suite: "an EMPTY principal role is
      // a DEFECT, not a silent no-grant".
      authorityDefect('D', `principal ${principal.principal_id} has an empty role`);
    }

    // --- 3. the principal must be the one this task runs as -------------------------------
    //
    // `24 §3` K7 owns tasks. A session for principal X proposing inside a task belonging to
    // principal Y is a confused deputy even when both are legitimate, so it denies.
    const taskRow = await client.query<{ principal_id: string }>(
      `SELECT principal_id FROM authority_task WHERE company_id = $1 AND task_id = $2`,
      [session.companyId, taskId],
    );
    const task = taskRow.rows[0];
    if (task === undefined || task.principal_id !== principal.principal_id) {
      denyAuthority(
        'D',
        'PRINCIPAL',
        'PRINCIPAL_NOT_ON_TASK',
        'the session principal is not the principal the task runs as',
      );
    }

    // --- 4. the chain ---------------------------------------------------------------------
    const chain = await this.#verifyChain(client, session.companyId, principal.principal_id);

    return Object.freeze({
      resolved: Object.freeze({
        id: principal.principal_id,
        kind: principal.kind as PrincipalKind,
        role: principal.role,
        modelBinding: principal.model_binding,
        // COUNTED. `26 §3` rule 3's operand is the number of hops that actually exist.
        delegationDepth: chain.hops.length,
      }),
      chain: chain.hops,
      effectiveActionClasses: chain.effective,
    });
  }

  async #verifyChain(
    client: Client,
    companyId: string,
    principalId: string,
  ): Promise<{
    readonly hops: readonly VerifiedDelegationHop[];
    readonly effective: ReadonlySet<string> | null;
  }> {
    const rows = await client.query<HopRow>(
      `SELECT hop_index, delegating_principal_id, granted_action_classes, signature
         FROM delegation_hop
        WHERE company_id = $1 AND principal_id = $2
        ORDER BY hop_index ASC`,
      [companyId, principalId],
    );
    const hops = rows.rows;
    if (hops.length === 0) {
      return { hops: [], effective: null };
    }

    // `26 §3` rule 3. Counted, then compared.
    if (hops.length > MAX_DELEGATION_DEPTH) {
      denyAuthority(
        'D',
        'PRINCIPAL',
        'DELEGATION_DEPTH_EXCEEDED',
        `delegation depth ${hops.length} exceeds the declared maximum ${MAX_DELEGATION_DEPTH}`,
      );
    }

    // Contiguity from 1. A chain missing hop 2 is a chain whose hop-2 narrowing was never
    // applied, and rule 2's intersection would silently be over a shorter chain.
    for (const [index, hop] of hops.entries()) {
      if (hop.hop_index !== index + 1) {
        denyAuthority(
          'D',
          'PRINCIPAL',
          'DELEGATION_CHAIN_NOT_CONTIGUOUS',
          'the delegation chain is not contiguous from hop 1',
        );
      }
    }

    let effective: ReadonlySet<string> | null = null;
    const verified: VerifiedDelegationHop[] = [];

    for (const hop of hops) {
      // --- rule 1: signed by the DELEGATING principal's kernel-held key -------------------
      const keyRow = await client.query<{ public_key: Buffer }>(
        `SELECT public_key FROM principal_key WHERE company_id = $1 AND principal_id = $2`,
        [companyId, hop.delegating_principal_id],
      );
      const keyBytes = keyRow.rows[0]?.public_key;
      if (keyBytes === undefined) {
        denyAuthority(
          'D',
          'PRINCIPAL',
          'DELEGATION_HOP_KEY_ABSENT',
          'the delegating principal has no verification key in kernel state',
        );
      }
      const granted = hop.granted_action_classes;
      const bytes = delegationHopSigningBytes({
        companyId,
        principalId,
        hopIndex: hop.hop_index,
        delegatingPrincipalId: hop.delegating_principal_id,
        grantedActionClasses: granted,
      });
      let ok = false;
      try {
        ok = verifySignature(
          null,
          bytes,
          createPublicKey({ key: keyBytes, format: 'der', type: 'spki' }),
          hop.signature,
        );
      } catch {
        // A malformed key or signature verifies as false rather than throwing outward. The
        // safe reading of "we could not verify this hop" is "this hop is not verified".
        ok = false;
      }
      if (!ok) {
        denyAuthority(
          'D',
          'PRINCIPAL',
          'DELEGATION_HOP_SIGNATURE_INVALID',
          `hop ${hop.hop_index} is not signed by ${hop.delegating_principal_id}'s kernel-held key`,
        );
      }

      // --- rule 2: a delegation can only NARROW -------------------------------------------
      const grantedSet: ReadonlySet<string> = new Set(granted);
      if (effective !== null) {
        for (const actionClass of grantedSet) {
          if (!effective.has(actionClass)) {
            // The hop conveys authority its delegator did not hold. `26 §3` rule 2 forbids
            // it outright, and silently intersecting it away would turn a forged chain into
            // a merely ineffective one — which is a compromise signal the audit path must
            // see, not a no-op.
            denyAuthority(
              'D',
              'PRINCIPAL',
              'DELEGATION_SUBSET_WIDENED',
              `hop ${hop.hop_index} conveys ${actionClass}, which the delegating principal does not hold`,
            );
          }
        }
      }
      effective = grantedSet;

      verified.push(
        Object.freeze({
          hopIndex: hop.hop_index,
          delegatingPrincipalId: hop.delegating_principal_id,
          grantedActionClasses: Object.freeze([...granted]),
        }),
      );
    }

    return { hops: Object.freeze(verified), effective };
  }
}
