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
 * WHAT IS DELIBERATELY ABSENT
 *
 * SELECTOR_STALE and SELECTOR_ENUMERATION_STALE are properties of live re-enumeration
 * under the step-C′ entity advisory lock. S1B does not enumerate and does not take that
 * lock, so emitting either would claim a check that was not performed. They are added by
 * the enumeration/selector increment together with I53 and the mandatory positional
 * negative control. See S1B-owner-clarifications.md S1B-C7.
 *
 * CONSTRUCTOR_SEMANTIC_CHANGE is the approval-resume denial (I61, `26 §7` step R′). S1B
 * has no approval state machine and emits it nowhere. An unverifiable constructor version
 * denies NOT_CANONICALISABLE instead — S1B-owner-clarifications.md S1B-C2.
 *
 * PER_ACTION is a POLICY denial and no S1B code path can produce it. `36 §2` VC-C1's
 * denial half is open until the Cedar slice.
 * ---------------------------------------------------------------------------------
 */

export type DenyCode =
  | 'MALFORMED'
  | 'UNKNOWN_ACTION'
  | 'NOT_CANONICALISABLE'
  | 'SELECTOR_MALFORMED'
  | 'SELECTOR_INVALID';

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
  | 'REASON_CODE_NOT_IN_CLOSED_ENUM'
  | 'ACTION_CLASS_NOT_IN_CATALOGUE'
  | 'NO_REGISTERED_CONSTRUCTOR'
  | 'CONSTRUCTOR_VERSION_UNVERIFIABLE'
  | 'OPTION_ID_MISMATCH'
  | 'OPTION_ACTION_CLASS_MISMATCH'
  | 'OPTION_RESOURCE_MISMATCH';

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
