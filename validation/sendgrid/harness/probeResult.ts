/**
 * THE SANITIZED RESULTS A ONE-SHOT CREDENTIAL PROCESS MAY RETURN.
 *
 * =================================================================================
 * THIS FILE HOLDS SHAPES AND NOTHING ELSE, AND THAT IS ITS JOB
 *
 * `§5` of the S1P correction mandate requires the coordinator to hold ZERO vendor credential
 * material while still LEARNING things a credential-holding process measured. The coordinator
 * therefore needs the RESULT types, and it must not acquire the capability along with them.
 *
 * So the shapes live here, in a module with no `fetch`, no secret source, no filesystem read
 * and no import of either provider client. `probeRuntime.ts` — which does hold a credential —
 * imports it, and so does `probeClient.ts` — which does not. Putting these types in
 * `scopeProbes.ts` would have pulled a real vendor HTTP client into the coordinator's import
 * closure for the sake of a type name, and `tests/sendgrid/credential-process-isolation.test.ts`
 * asserts that closure directly.
 *
 * **NO MEMBER OF ANY TYPE BELOW CAN CARRY A SECRET.** Every field is a number, a boolean, a
 * closed enum member, or a NON-SECRET credential identity — `50 §2g` field 1's own
 * definition of a value that is not the material.
 * =================================================================================
 */

/** What one capability probe concluded. A closed set; there is no "probably". */
export const PROBE_OUTCOMES = [
  /** The provider performed the operation. The credential HOLDS the capability. */
  'CAPABILITY_CONFIRMED',
  /** The provider refused on authorisation/scope. The credential LACKS the capability. */
  'CAPABILITY_REFUSED_BY_PROVIDER',
  /** The provider answered, and the answer settles neither. Recorded, never rounded. */
  'INCONCLUSIVE',
  /** The provider was not reached. NOT a refusal, and never reported as one. */
  'PROVIDER_UNREACHABLE',
  /** The probe did not run. NEVER a pass. */
  'NOT_RUN',
] as const;

export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

/** One probe's sanitized record. NO MEMBER CAN CARRY A SECRET. */
export interface ProbeRecord {
  /** e.g. `POST /v3/mail/send`. The operation attempted, verbatim. */
  readonly operation: string;
  /** The NON-SECRET credential identity. `§8.7`: "credential identity, never secret". */
  readonly credentialIdentity: string;
  /** Which plane's credential performed it. Evidence of the isolation, from the child. */
  readonly plane: 'INTEGRATION' | 'AUDIT';
  /** The provider's own HTTP status, or `null` when it did not answer. */
  readonly httpStatus: number | null;
  readonly outcome: ProbeOutcome;
  /** Why the outcome is what it is, in words a reviewer can check. Never a provider body. */
  readonly note: string;
}

/**
 * What an `IDENTITY` probe established. **THE STAGE-2 PREFLIGHT'S ONLY INPUT.**
 *
 * The material is resolved in the child, read once, and never crosses: there is no member
 * here it could occupy. `identityProvenance` is the value the SOURCE MECHANISM assigned —
 * correction 3 — and is what the preflight's material-binding gate evaluates.
 */
export interface CredentialIdentityFacts {
  readonly plane: 'INTEGRATION' | 'AUDIT';
  /** Whether the source produced material at all. */
  readonly resolved: boolean;
  /** `50 §2g` field 1, as the source named it. `null` when nothing resolved. */
  readonly resolvedIdentity: string | null;
  /** The provenance the MECHANISM assigned. `null` when nothing resolved. */
  readonly identityProvenance: string | null;
  /** The signed expectation this child was launched with, echoed back for comparison. */
  readonly expectedCredentialId: string;
  /** Whether the child itself found the two equal. The coordinator re-checks; this is evidence. */
  readonly identityMatchedExpectation: boolean;
  /** `§24`: the source answered `CREDENTIAL_REVOKED`. */
  readonly revoked: boolean;
  /**
   * `Object.keys(process.env)` AS THE CHILD SAW IT. KEYS ONLY.
   *
   * `§17` of the S1O mandate's pattern, for the same reason: what the parent passed is the
   * thing under test and is therefore not evidence about itself. This is how
   * `credential-process-isolation.test.ts` proves no probe process held two locators.
   */
  readonly environmentKeys: readonly string[];
  /** The child's own PID. Distinct from the coordinator's, and asserted to be. */
  readonly pid: number;
}

/** The single line a one-shot probe writes to stdout, and the only thing it writes. */
export type ProbeReply =
  | { readonly kind: 'IDENTITY_FACTS'; readonly facts: CredentialIdentityFacts }
  | { readonly kind: 'PROBE_RECORD'; readonly record: ProbeRecord }
  /** The child could not even reach its own role. A code, never a path or a message. */
  | { readonly kind: 'PROBE_REFUSED'; readonly reason: ProbeRefusal };

export const PROBE_REFUSALS = [
  'PROTOCOL_VERSION_MISMATCH',
  'ROLE_UNKNOWN',
  'PLANE_UNKNOWN',
  'SOURCE_MODULE_UNLOADABLE',
  'SOURCE_MODULE_SHAPE_INVALID',
  'OPERANDS_MALFORMED',
  /** A `SEND_PROBE` was asked for on the INTEGRATION plane. `36 §13` is the audit key's test. */
  'ROLE_NOT_PERMITTED_ON_PLANE',
] as const;

export type ProbeRefusal = (typeof PROBE_REFUSALS)[number];

/** The stdout marker the parent scans for. One line, one reply, nothing else on stdout. */
export const PROBE_REPLY_PREFIX = 'ACOS_S1P_PROBE_REPLY ';
