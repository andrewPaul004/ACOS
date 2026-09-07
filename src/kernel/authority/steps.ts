/**
 * `26 §7`'s step labels and their ORDER, transcribed once.
 *
 * `26 §7`, the opening sentence, verbatim:
 *
 *   "Deterministic, ordered, fail-closed. Every step can deny; only completion permits."
 *
 * ---------------------------------------------------------------------------------
 * WHY THE ORDER IS A DECLARED CONSTANT AND NOT AN ARTEFACT OF CALL-SITE SEQUENCING
 *
 * `26 §7`'s load-bearing property 1, verbatim: "**Prohibitions are evaluated before grants**
 * and are unappealable. No grant, no approval, no owner override at runtime can reach them."
 *
 * That is a statement about ORDER, and an order that exists only as the sequence of
 * statements in one function is an order a refactor can change without any test noticing.
 * Declaring it here makes "E precedes I" a value that a test can assert directly and that
 * `preReservation.ts` is checked against.
 *
 * The array below is transcribed from `26 §7`'s flowchart, reading the edges in order:
 *
 *   B -> C -> C2 -> C′ -> D -> E -> F -> G -> H -> H′ -> H″ -> I -> J -> K -> L -> M -> N -> P
 *
 * B, C, C2 and C′ are the ACCEPTED S1B/S1C path and are composed rather than reimplemented.
 * M is the ACCEPTED S1D Cedar path and is composed rather than reimplemented. D through L,
 * N and P are S1E's own.
 * ---------------------------------------------------------------------------------
 */

/** The steps `26 §7` names, in the order `26 §7` names them. */
export const AUTHORITY_STEPS = [
  /** Schema: only the five model-facing fields. S1B. */
  'B',
  /** `action_class` in the closed catalogue. S1B. */
  'C',
  /** A registered canonical constructor exists for the class. S1B. */
  'C2',
  /** Canonicalise under the entity advisory lock, re-enumerating live. S1C. */
  "C′",
  /** Principal authenticated, chain signature valid, depth ≤ 3. S1E. */
  'D',
  /** Categorical prohibition — unappealable. S1E. */
  'E',
  /** Agent profile / platform status OK, kill switch not set. S1E. */
  'F',
  /** Fetch preconditions from the state store; the proposer does not supply. S1E. */
  'G',
  /** All preconditions RECORD/OBSERVATION and within `max_age`. S1E. */
  'H',
  /** Contradiction check — `I29`. S1E. */
  "H′",
  /** Delegated-grade check — `I28`. S1E. */
  'H″',
  /** Matching grant exists after subset intersection. S1E. */
  'I',
  /** `recoverability ≤ grant.recoverability_max`. S1E. */
  'J',
  /** `counterparty.novelty ≤ grant limit`. S1E. */
  'K',
  /** Evidence requirements met. S1E. */
  'L',
  /** `per_action_max` satisfied — the real Cedar decision. S1D, composed. */
  'M',
  /** Autonomy ledger permits this key at this level. S1E. */
  'N',
  /** Channel set -> utterance policy `§9`. S1E: fail-closed, `§9` is not implemented. */
  'P',
] as const;

export type AuthorityStep = (typeof AUTHORITY_STEPS)[number];

const STEP_INDEX: ReadonlyMap<AuthorityStep, number> = new Map(
  AUTHORITY_STEPS.map((step, index) => [step, index] as const),
);

/**
 * Whether `earlier` is evaluated strictly before `later` in `26 §7`.
 *
 * Used by `preReservation.ts` to assert its own gate sequence against this declaration at
 * construction time, so a reordered pipeline fails to build rather than failing to deny.
 */
export function stepPrecedes(earlier: AuthorityStep, later: AuthorityStep): boolean {
  return STEP_INDEX.get(earlier)! < STEP_INDEX.get(later)!;
}

/** The step's position, for ordering assertions and for the audit record. */
export function stepOrdinal(step: AuthorityStep): number {
  return STEP_INDEX.get(step)!;
}

/**
 * The steps S1E's pre-reservation pipeline evaluates itself, in order.
 *
 * B, C, C2 and C′ happen inside the accepted S1C boundary; M happens inside the accepted
 * S1D boundary. This is the list of gates `preReservation.ts` owns, and the list a
 * reordering test compares against.
 */
export const S1E_GATE_STEPS = ['D', 'E', 'F', 'G', 'H', "H′", 'H″', 'I', 'J', 'K', 'L'] as const;

/** The steps that follow the accepted Cedar decision and still precede step R. */
export const S1E_POST_M_STEPS = ['N', 'P'] as const;
