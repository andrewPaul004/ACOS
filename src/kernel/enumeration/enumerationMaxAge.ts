import {
  enumerationMaxAgeSecondsFor,
  type ActionClass,
} from '../canonicalisation/actionCatalogue.js';

/**
 * The per-class enumeration `max_age` — `50 §2a` RECORD 14, read from the SIGNED class-3
 * artifact.
 *
 * =================================================================================
 * WHAT IT WAS AT S1C, AND WHAT v1.3.6 MADE IT
 *
 * `26 §2.0.1` puts `computed_at` on the `EnumeratedOptionSet` "for the class's `max_age`
 * check at C′", and `26 §7`'s C′ row requires `SELECTOR_ENUMERATION_STALE` when it is
 * exceeded. Neither established a DURATION, so S1C declared 120 seconds as a control fixture
 * and recorded its provenance in `docs/implementation/S1C-owner-clarifications.md` **S1C-C4**
 * rather than claiming the architecture had chosen it.
 *
 * v1.3.6 gives the quantity an OWNER. `50 §2a` record 14: "`enumeration_max_age` | per action
 * class, the enumeration `max_age` checked at C′ (`26 §2.0.1`)" — inside class 3's CLOSED
 * content schema, which `50 §2a` states is "the WHOLE of class 3's signed content. There is
 * no `incl.`, no `etc.` and no open tail."
 *
 * So the table moved OUT of this file and INTO the signed artifact. S1C's 120 seconds is
 * still the deployed figure and it is now a figure an owner signs rather than a constant a
 * code change moves. S1C-C4's open question — who selects the production duration — is
 * answered structurally: whoever performs the signing ceremony.
 *
 * =================================================================================
 * WHY THE LOOKUP STILL CANNOT RETURN `undefined`
 *
 * The S1C comment this file replaced made the point and it is unchanged: "a lookup that
 * could return `undefined` would make the staleness check silently unbounded for a class
 * someone later registers, and 'the check was skipped because the table had no row' is the
 * shape of failure a staleness control must not have."
 *
 * The class-3 parser enforces record 14 as a TOTAL map over the artifact's declared classes
 * before a bundle can be sealed, and `enumerationMaxAgeSecondsFor` throws rather than
 * defaulting. The absence of a row is now a BOOTSTRAP failure instead of a silent skip.
 * =================================================================================
 */

/** The class's `max_age`, in seconds, from the verified class-3 artifact. */
export function maxAgeSecondsFor(actionClass: ActionClass): number {
  return enumerationMaxAgeSecondsFor(actionClass);
}
