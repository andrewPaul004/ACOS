import type { ActionClass } from '../canonicalisation/actionCatalogue.js';

/**
 * The per-class enumeration `max_age` — AN S1C IMPLEMENTATION FIXTURE.
 *
 * `26 §2.0.1` puts `computed_at` on the `EnumeratedOptionSet` "for the class's `max_age`
 * check at C′", and `26 §7`'s C′ row requires `SELECTOR_ENUMERATION_STALE` when it is
 * exceeded. Both establish that the class HAS a `max_age` and that C′ must check it.
 *
 * ---------------------------------------------------------------------------------
 * NEITHER ESTABLISHES A DURATION, AND S1C DOES NOT PRETEND OTHERWISE
 *
 * `51-limits-fixture.md` prints no enumeration `max_age`. `36 §2` VC-C3 requires "a stale
 * `enumeration_id` past the class `max_age` denies `SELECTOR_ENUMERATION_STALE`" without
 * naming the age. `26 §2.0.1`'s property table names the check and not the number.
 *
 * So the value below is a **control fixture declared by S1C**, exactly as S1B declared its
 * reason-code enum (S1B-C6) and its retained-fee amount (S1B-C3a) as fixtures rather than
 * as readings of the architecture. Its provenance is recorded in
 * docs/implementation/S1C-owner-clarifications.md **S1C-C4**.
 *
 * Selecting the production duration is a policy decision with a real trade-off — too long
 * and a model reasons about a world that has moved; too short and every proposal denies
 * behind ordinary latency — and it belongs to whoever owns `51-limits-fixture.md`, not to
 * this increment. Nothing in S1C claims the architecture chose 120 seconds.
 * ---------------------------------------------------------------------------------
 */
export const ENUMERATION_MAX_AGE_SECONDS: Readonly<Record<ActionClass, number>> = Object.freeze({
  // S1C fixture. The only class with a registered constructor at S1C.
  'refund.create': 120,

  // The other three catalogue members have no registered constructor, so `enumerate_effects`
  // denies `NOT_CANONICALISABLE` before a `max_age` is ever consulted. A value is declared
  // for each anyway, and deliberately: a lookup that could return `undefined` would make the
  // staleness check silently unbounded for a class someone later registers, and "the check
  // was skipped because the table had no row" is the shape of failure a staleness control
  // must not have.
  'campaign.pause': 120,
  'fulfilment.reship': 120,
  'campaign.budget.set': 120,
});

/** The class's `max_age`, in seconds. Total over the closed catalogue by construction. */
export function maxAgeSecondsFor(actionClass: ActionClass): number {
  return ENUMERATION_MAX_AGE_SECONDS[actionClass];
}
