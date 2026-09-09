/**
 * TEST-ONLY. THREE DEFECTIVE OUTCOME POLICIES — `§40` ITEMS 7, 8 AND 9.
 *
 * =================================================================================
 * THIS FILE IMPORTS NOTHING. `§41`.
 *
 * A control that imported `outcomePolicy.ts` to decide what to do differently would be
 * judged against the thing it is meant to discriminate from. Every string below is written
 * out by hand.
 * =================================================================================
 */

/** What a defective policy decides. Deliberately shaped like production's, so they compare. */
export interface UnsafePolicyDecision {
  readonly effectStatus: string | null;
  /** What the defective policy does to the held reservation. */
  readonly reservation: 'HELD' | 'RELEASED';
  /** Whether the defective policy would allow another dispatch attempt. */
  readonly redispatchPermitted: boolean;
  /** What the defective policy moves in the irrecoverable ledger, if anything. */
  readonly mieMovement: 'NONE' | 'RESERVED_TO_PRESUMED';
}

/**
 * CONTROL A — RECOVERABILITY TAKEN FROM THE CALLER OR THE ADAPTER RESULT (`§17`).
 *
 * =================================================================================
 * `§17`'s FIXTURE, BOTH DIRECTIONS
 *
 *   "authoritative effect = IRRECOVERABLE; attacker says REVERSIBLE.
 *    Unsafe: uses hold/reconcile policy. Production: uses IRRECOVERABLE policy.
 *
 *    And reverse: authoritative money effect; attacker says IRRECOVERABLE.
 *    Production must not consume an MIE unit."
 *
 * The parameter is named `claimedRecoverability` rather than `recoverability`, because that
 * is what it is: a claim, from whoever called. `26 §5` says where the real value lives —
 * "Assigned per action class in the catalogue, not per request, and **never by a model**" —
 * and `24 §3` K4's "What AI may not do" names "a recoverability class" explicitly.
 *
 * WHAT EACH DIRECTION COSTS:
 *
 *   IRRECOVERABLE relabelled REVERSIBLE. The hold-and-resolve policy applies, so the effect
 *   sits waiting for a reconciler that, for an irrecoverable send, has nothing to query.
 *   `25 §10`: "for irrecoverable classes there is nothing to query synchronously". The
 *   effect eventually ages past `I9`'s SLA and the operational pressure is to retry — and
 *   the retry is the duplicate storm `35 §12.3` calls "a permanent domain-reputation event"
 *   because Gmail bulk-sender status "has no expiration".
 *
 *   Money relabelled IRRECOVERABLE. Assume-executed applies to a refund: the effect is
 *   marked presumed-executed, an irrecoverable unit is consumed for an effect that consumes
 *   none (`I30`'s ledger separation inverted), and the reconciler never queries the
 *   processor — so `35 §4`'s three-outcome resolution never runs and the bank line, which
 *   `35 §4` calls "the arbiter", is never reconciled against.
 *
 * PRODUCTION HAS NO SUCH PARAMETER. `processAdapterOutcomeOn` joins `effect` and reads
 * `e.recoverability` inside the outcome transaction.
 * =================================================================================
 */
export function unsafePolicyFromClaimedRecoverability(
  claimedRecoverability: string,
  outcomeKind: string,
): UnsafePolicyDecision {
  if (outcomeKind !== 'OUTCOME_UNKNOWN') {
    return {
      effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
      reservation: 'HELD',
      redispatchPermitted: false,
      mieMovement: 'NONE',
    };
  }
  if (claimedRecoverability === 'IRRECOVERABLE') {
    return {
      effectStatus: 'PRESUMED_EXECUTED',
      reservation: 'HELD',
      redispatchPermitted: false,
      // The invented movement. See CONTROL C's note on why inventing it is the defect.
      mieMovement: 'RESERVED_TO_PRESUMED',
    };
  }
  return {
    effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
    reservation: 'HELD',
    redispatchPermitted: false,
    mieMovement: 'NONE',
  };
}

/**
 * CONTROL B — THE MONEY UNKNOWN RELEASES THE RESERVATION (`§40` item 8).
 *
 * =================================================================================
 * WHY IT IS THE OBVIOUS THING TO DO, AND WHY `35 §4` FORBIDS IT
 *
 * A timeout looks like a failure. A failed refund reserved headroom it did not spend, so
 * releasing it returns headroom to the company and unblocks the next refund. Every
 * operational instinct says release.
 *
 * `35 §4`, verbatim: "The exposure reservation **remains held**. It is not released on
 * timeout, **because releasing it would let a retry plus a concurrent proposal collectively
 * exceed the window.**"
 *
 * That sentence is the whole argument. The unknown outcome may have MOVED THE MONEY. If the
 * reservation is released and the effect is later resolved as settled, the window has
 * already re-lent the same headroom to a concurrent proposal, and `I3`'s bound — "no
 * commitment is admitted that would breach the bound" — was broken by an accounting
 * decision rather than by an attack.
 *
 * `25 §12` and `I32` state the cost of the correct answer rather than hiding it: "Holding a
 * reservation across an unknown outcome is correct for correctness and **exploitable for
 * availability**: an adversary able to induce vendor timeouts — including the vendor —
 * exhausts headroom at zero spend, after which refunds deny with `WINDOW_EXHAUSTED` while
 * the FTC clock runs." S1J holds, and the reaper/override remedy (`I32`, `26 §10.3`) is a
 * separate later mechanism.
 * =================================================================================
 */
export function unsafePolicyReleasingReservationOnUnknown(
  recoverability: string,
  outcomeKind: string,
): UnsafePolicyDecision {
  if (outcomeKind === 'OUTCOME_UNKNOWN' && recoverability !== 'IRRECOVERABLE') {
    return {
      effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
      // THE DEFECT. One word.
      reservation: 'RELEASED',
      redispatchPermitted: false,
      mieMovement: 'NONE',
    };
  }
  return {
    effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
    reservation: 'HELD',
    redispatchPermitted: false,
    mieMovement: 'NONE',
  };
}

/**
 * CONTROL C — THE UNKNOWN BECOMES A RETRYABLE `FAILED` / `READY` (`§40` item 9, `§15`).
 *
 * =================================================================================
 * THE SINGLE MOST IMPORTANT DEFECT IN THE ARCHITECTURE'S OWN ACCOUNT
 *
 * `35 §11`: "**The distinct `OUTCOME_UNKNOWN` state does more work than any single
 * control.** Scenarios 4 and 8 both turn on refusing to collapse 'unknown' into 'failed'.
 * **Every double-execution bug in this class comes from that collapse.**"
 *
 * `35 §4`: "This is a distinct state, not an error — conflating 'failed' with 'unknown' is
 * what produces double execution." `25 §5`: "**Blind retry here is how you double-refund.**"
 *
 * This policy performs the collapse: unknown becomes `FAILED`, the reservation is released,
 * and redispatch is permitted. It also invents the MIE movement for the IRRECOVERABLE case,
 * which is `§40` item 10's control — and the invention is the point. v1.3.4 requires
 * `PRESUMED_EXECUTED` and a unit consumption as one act and declares no ledger transition
 * for the consumption; a decrement of `reserved_irrecoverable` and an increment of
 * `presumed_irrecoverable` is a PLAUSIBLE GUESS AT AN UNDECLARED RULE, and production
 * refuses to make it rather than making it quietly (`S1J-C1`).
 *
 * Note what a released reservation plus a permitted redispatch means together: the outbox
 * row is `CLAIMED`, so the redispatch has no row to claim — which is why a policy shaped
 * like this ends up either reclaiming (impossible under `0010`'s trigger) or dispatching
 * from the persisted `CLAIMED` row without a claim at all, which is
 * `unsafe-dispatch-claimed.ts`. The three defects compose into one duplicate send.
 * =================================================================================
 */
export function unsafePolicyCollapsingUnknownToFailed(
  recoverability: string,
  outcomeKind: string,
): UnsafePolicyDecision {
  if (outcomeKind !== 'OUTCOME_UNKNOWN') {
    return {
      effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
      reservation: 'HELD',
      redispatchPermitted: false,
      mieMovement: 'NONE',
    };
  }
  if (recoverability === 'IRRECOVERABLE') {
    return {
      effectStatus: 'PRESUMED_EXECUTED',
      reservation: 'HELD',
      redispatchPermitted: false,
      mieMovement: 'RESERVED_TO_PRESUMED',
    };
  }
  return {
    // THE COLLAPSE.
    effectStatus: 'FAILED',
    reservation: 'RELEASED',
    redispatchPermitted: true,
    mieMovement: 'NONE',
  };
}
