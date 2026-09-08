import type { Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. A clock-bearing classifier that trusts a caller-supplied `case_ref`.
 *
 * =================================================================================
 * WHAT `§8` OF THE S1I OWNER-RESOLUTION MANDATE REQUIRES:
 *
 *   "Implement a TEST-ONLY unsafe classifier that derives clock-bearing status from a
 *    caller-supplied `case_ref`. Fixture: effect authoritatively belongs to case A; case A
 *    has no live statutory clock; attacker supplies case B; case B has a valid live clock.
 *    Unsafe: row 3 / clock-bearing path becomes reachable. Production: does not. Must
 *    discriminate."
 *
 * And the reverse: "effect bound to case A with a real live clock; caller tries to
 * remove/change the case; production still sees the real clock."
 * =================================================================================
 *
 * =================================================================================
 * THE DEFECT IS THE PARAMETER, AND IT IS NOT REACHABLE IN PRODUCTION.
 *
 * `30 §9.2.1` names this exact shape among the forbidden sources of a case binding: "a
 * caller-supplied claim-time argument", and states the consequence — "a `case_ref`
 * parameter on a claim surface is a defect of the same class as a caller-supplied
 * `clockBearing` boolean."
 *
 * Production's `clockBearingAtClaim` DOES take a `caseRef`, and that is not a
 * contradiction: the only value ever passed to it is `effect.case_ref`, read from the
 * committed row inside the claim transaction, in `claimForExternalDispatchOn`'s own
 * operand query. `claimForExternalDispatch`'s INPUT TYPE — the public surface — has no
 * `caseRef`, no `clockBearing` and no `clockId` field, so there is no way for a caller to
 * reach the parameter at all. This file models the surface production does not have.
 *
 * `30 §9.2` states the attack in one sentence: "a model that can make the kernel look up
 * the WRONG clock obtains the exemption without needing to create one." `I56` closed
 * clock CREATION and this is the other end of the same lever.
 * =================================================================================
 *
 * WHAT IS THE SAME: real PostgreSQL, the real `statutory_clock` and
 * `retained_source_record` tables, the same liveness and `I56` provenance predicate, the
 * same instant.
 *
 * WHAT IS DIFFERENT: exactly one thing. Production reads the case from the committed
 * `effect` row; this reads it from an argument.
 *
 * IT WRITES NOTHING. It is a read-only classifier, so a test can run it and then assert
 * production's outbox row is still `ENQUEUED` and production's own answer is unchanged.
 */
export async function unsafeClockBearingFromCallerCase(
  control: Pool,
  input: {
    readonly companyId: string;
    /**
     * THE WHOLE DEFECT. Production has no such parameter on any caller-facing surface;
     * here it is whatever the caller says, and the caller is the attacker.
     */
    readonly callerSuppliedCaseRef: string | null;
    readonly now: Date;
  },
): Promise<boolean> {
  // A caller who supplies nothing gets nothing. The unsafe path is not MORE permissive
  // about absence than production is — it is permissive about SUBSTITUTION, which is the
  // one difference under test, and a control that differed in two ways would not
  // discriminate.
  if (input.callerSuppliedCaseRef === null) return false;

  const client = await control.connect();
  try {
    const result = await client.query<{ live: string }>(
      `SELECT count(*)::TEXT AS live
         FROM statutory_clock c
         JOIN retained_source_record r
           ON r.company_id = c.company_id AND r.source_record_id = c.source_record_ref
        WHERE c.company_id = $1 AND c.case_ref = $2
          AND c.closed_at IS NULL AND c.deadline_at > $3
          AND r.provenance = 'RECORD'`,
      [input.companyId, input.callerSuppliedCaseRef, input.now],
    );
    return BigInt(result.rows[0]!.live) > 0n;
  } finally {
    client.release();
  }
}

/**
 * TEST-ONLY. The same substitution, taken one step further: a classifier that resolves a
 * case by looking at the effect's RESOURCE rather than at its authoritative binding.
 *
 * `30 §9.2.1` forbids this by name too — "inference from a customer identifier; inference
 * from a similar order; or an arbitrary resource lookup selected at claim time" — and it
 * is the shape a well-meaning implementation reaches for when no binding is declared,
 * which is precisely what v1.3.3 left open. `S1I-C1`'s own words: "a claim-time `case_ref`
 * chosen by a caller — **or guessed by the kernel from `resource_ref`** — is the same
 * lever."
 *
 * It resolves the case of ANY effect sharing this effect's `resource_ref`, which is how a
 * "reasonable" resource-based lookup behaves when two effects touch one order.
 */
export async function unsafeClockBearingFromResourceLookup(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly effectId: string;
    readonly now: Date;
  },
): Promise<boolean> {
  const client = await control.connect();
  try {
    const result = await client.query<{ live: string }>(
      `SELECT count(*)::TEXT AS live
         FROM effect subject
         JOIN effect sibling
           ON sibling.company_id = subject.company_id
          AND sibling.resource_ref = subject.resource_ref
         JOIN statutory_clock c
           ON c.company_id = sibling.company_id AND c.case_ref = sibling.case_ref
         JOIN retained_source_record r
           ON r.company_id = c.company_id AND r.source_record_id = c.source_record_ref
        WHERE subject.company_id = $1 AND subject.effect_id = $2
          AND c.closed_at IS NULL AND c.deadline_at > $3
          AND r.provenance = 'RECORD'`,
      [input.companyId, input.effectId, input.now],
    );
    return BigInt(result.rows[0]!.live) > 0n;
  } finally {
    client.release();
  }
}
