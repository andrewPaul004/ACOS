/**
 * The denial codes S1B can emit, and the deliberate absences.
 *
 * `26 §7`'s evaluation sequence, verbatim from the flowchart, for the steps S1B occupies:
 *
 *   B  "Schema valid? only 5 fields present?"  -> no -> "DENY: MALFORMED"
 *   C  "action_class in closed catalogue?"     -> no -> "DENY: UNKNOWN_ACTION"
 *   C2 "Registered canonical constructor for this class?"
 *                                              -> no -> "DENY: NOT_CANONICALISABLE
 *                                                        class not autonomy-eligible"
 *   C3 "selector does not index a live option" ->       "DENY: SELECTOR_INVALID"
 *
 * and the C′ row's v1.2 denial list, verbatim:
 *
 *   "SELECTOR_STALE if the option_id is absent from the live set;
 *    SELECTOR_ENUMERATION_STALE if enumeration_id.computed_at exceeds the class's max_age;
 *    SELECTOR_MALFORMED if the pair does not parse;
 *    NOT_CANONICALISABLE if no constructor is registered for the class."
 *
 * ---------------------------------------------------------------------------------
 * S1C ADDED THE TWO C′ CODES S1B RECORDED AS ABSENT
 *
 * S1B's version of this header said:
 *
 *   "SELECTOR_STALE and SELECTOR_ENUMERATION_STALE are properties of live re-enumeration
 *    under the step-C′ entity advisory lock. S1B does not enumerate and does not take that
 *    lock, so emitting either would claim a check that was not performed. They are added by
 *    the enumeration/selector increment together with I53 and the mandatory positional
 *    negative control."
 *
 * **S1C is that increment.** Both codes are added, and both are now emitted by code that
 * genuinely performs the check they name:
 *
 *   SELECTOR_STALE              `src/kernel/enumeration/liveSelector.ts` step 5, after the
 *                               live re-enumeration under a HELD entity execution lease
 *   SELECTOR_ENUMERATION_STALE  `liveSelector.ts` step 3, against the kernel's own recorded
 *                               `computed_at` and the class `max_age` fixture (S1C-C4)
 *
 * Neither code is invented: `26 §7`'s C′ row declares the set. S1C extends no category and
 * adds no model-visible distinction — see `enumeration/workerFacingDenial.ts`, where the
 * whole selector family collapses to the architecture's single `DENY: SELECTOR`.
 *
 * ---------------------------------------------------------------------------------
 * WHAT IS STILL DELIBERATELY ABSENT
 *
 * CONSTRUCTOR_SEMANTIC_CHANGE is the approval-resume denial (I61, `26 §7` step R′). There
 * is no approval state machine in S1A, S1B or S1C and it is emitted nowhere. An unverifiable
 * constructor version denies NOT_CANONICALISABLE instead — S1B-owner-clarifications.md
 * S1B-C2.
 *
 * PER_ACTION is a POLICY denial and no code path here can produce it. `36 §2` VC-C1's denial
 * half is open until the Cedar slice, and the S1C mandate excludes Cedar by name.
 * ---------------------------------------------------------------------------------
 */

export type DenyCode =
  | 'MALFORMED'
  | 'UNKNOWN_ACTION'
  | 'NOT_CANONICALISABLE'
  | 'SELECTOR_MALFORMED'
  | 'SELECTOR_INVALID'
  /** S1C. `26 §7` C′: the `option_id` is absent from the live set. `I53`. */
  | 'SELECTOR_STALE'
  /** S1C. `26 §7` C′: `computed_at` exceeds the class's `max_age`. */
  | 'SELECTOR_ENUMERATION_STALE';

/**
 * S1B.2 ADDITIONS, and why each denies under a code the flowchart already declares.
 *
 * `NOT_CANONICAL_TEXT` (finding 4) is a SCHEMA outcome. `30 §5.3`'s canonical text admits
 * neither U+0000 nor an unpaired UTF-16 surrogate, because at a nullable position the first
 * is byte-identical to the null sentinel and the second is byte-identical to every other
 * lone surrogate once Node substitutes U+FFFD. A wire value that cannot be canonicalised is
 * a malformed wire value, so it denies `MALFORMED` — or `SELECTOR_MALFORMED` inside the
 * selector, matching where the other selector-shape failures already deny.
 *
 * `REASON_CODE_SCOPE_MISMATCH` (finding 1D) denies `SELECTOR_INVALID`. `reason_code_scope`
 * is part of `refund.create`'s semantic option identity (`26 §2.2`), so a `reason_code`
 * outside the selected option's declared scope means the selector does not index a
 * permissible option FOR THIS INTENT. Both halves are individually well-formed — the reason
 * code is in the closed enum and the option is authoritative — and it is their combination
 * that is inadmissible, which is precisely what `SELECTOR_INVALID` says. No new denial code
 * was invented: `26 §7` declares the set and S1B.2 does not extend it.
 */

/**
 * The non-model-visible reason. `26 §7`, verbatim:
 *
 *   "Denial detail returned to the model is coarse. The audit record holds the full
 *    reason; the worker receives a category and no near-miss information."
 *
 * `code` is the worker-visible category. `detail` is for the audit record and is never
 * rendered to a model by any S1B code path.
 */
export type DenyDetail =
  | 'NOT_AN_OBJECT'
  | 'MISSING_FIELD'
  | 'EXTRA_FIELD'
  | 'WRONG_TYPE'
  | 'RATIONALE_TOO_LONG'
  | 'NOT_CANONICAL_TEXT'
  | 'REASON_CODE_NOT_IN_CLOSED_ENUM'
  | 'ACTION_CLASS_NOT_IN_CATALOGUE'
  | 'NO_REGISTERED_CONSTRUCTOR'
  | 'CONSTRUCTOR_VERSION_UNVERIFIABLE'
  | 'OPTION_ID_MISMATCH'
  | 'OPTION_ACTION_CLASS_MISMATCH'
  | 'OPTION_RESOURCE_MISMATCH'
  | 'REASON_CODE_SCOPE_MISMATCH'
  // --- S1C, audit-side only. None of these reaches a worker; see workerFacingDenial.ts ---
  /** The selector names an `enumeration_id` the kernel has no record of computing. */
  | 'ENUMERATION_UNKNOWN'
  /** The named enumeration was computed for another task, principal, class or resource. */
  | 'ENUMERATION_BINDING_MISMATCH'
  /** `26 §7` C′: `now - computed_at` exceeds the class's `max_age`. */
  | 'ENUMERATION_PAST_MAX_AGE'
  /** `I53`: the `option_id` is absent from the enumeration computed under the C′ lock. */
  | 'OPTION_ABSENT_FROM_LIVE_SET'
  /** The `option_id` is live, but was not among the options the named enumeration returned. */
  | 'OPTION_NOT_IN_NAMED_ENUMERATION';

export class CanonicalisationDenied extends Error {
  readonly code: DenyCode;
  readonly detail: DenyDetail;
  /** Free-text audit context. Never returned to a worker. */
  readonly auditNote: string;

  constructor(code: DenyCode, detail: DenyDetail, auditNote: string) {
    super(`DENY: ${code} (${detail}) — ${auditNote}`);
    this.name = 'CanonicalisationDenied';
    this.code = code;
    this.detail = detail;
    this.auditNote = auditNote;
  }
}

export function deny(code: DenyCode, detail: DenyDetail, auditNote: string): never {
  throw new CanonicalisationDenied(code, detail, auditNote);
}
