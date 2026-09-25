import type { KeyObject } from 'node:crypto';

import {
  verifiedConstructorSet,
  type VerifiedControlArtifactBundle,
} from '../controlArtifacts/bundle.js';
import { integrityFailure, quoted } from '../controlArtifacts/errors.js';
import {
  ConstructorVersionResolver,
  type ConstructorVersionRecord,
} from './constructorVersion.js';

/**
 * CLASS-19 ADMISSION — constructor resolution ROOTED IN THE VERIFIED ARTIFACT BYTES.
 *
 * =================================================================================
 * THE PROBLEM THIS CLOSES, STATED EXACTLY — `50 §3i`
 *
 *   "`ConstructorVersionResolver` takes the verifying public key **as a constructor
 *    argument** and holds no keystore, no rotation and no revocation list. [...] **A
 *    CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**, and it must not become the
 *    general S1K pattern."
 *
 * S1B's resolver decides TWO things at once, and they have different trust requirements:
 *
 *   1. WHICH constructor records exist — its `records` argument;
 *   2. WHETHER each record's Ed25519 signature verifies — its `publicKey` argument.
 *
 * With both supplied by a caller, a caller holding an attacker key and an attacker-signed
 * record could resolve a constructor version that appears in NO signed control artifact.
 * That is authority created outside the verified artifact bytes, and it is what `§12` of the
 * S1L mandate requires be impossible.
 *
 * =================================================================================
 * WHAT THIS MODULE DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * IT MAKES MEMBERSHIP ARTIFACT-ROOTED. The set of admissible `(constructor_id, action_class,
 * semantic_major, non_semantic_minor)` tuples is read from the VERIFIED class-19 artifact
 * carried by a `VerifiedControlArtifactBundle` — a capability `50 §3f` occasion 3 says only
 * verification can produce and "no caller and no model may manufacture". A record outside
 * that set is REFUSED, whatever key signed it and whatever key the caller offers.
 *
 * IT DOES NOT MOVE THE VERIFICATION KEY ONTO THE OWNER ROOTS. `50 §3i` declares that
 * migration "**DECLARED FUTURE WORK**", `37 §2` lists it as a follow-on and NOT a pre-live
 * blocker, and neither declares its mechanics. Inventing them would be inventing
 * key-management authority. The key argument therefore remains, is named
 * `legacyRecordVerifyingKey` so no reader mistakes it for a trust root, and its scope is now
 * strictly narrower than the artifact's: it can cause a REFUSAL and it can no longer cause an
 * ADMISSION of anything the owner did not sign.
 *
 * The residual is stated honestly in `docs/implementation/S1L-result.md`: class 19's key
 * migration remains open; class 19's ability to widen authority beyond the verified bytes
 * does not.
 *
 * =================================================================================
 * THE FOUR ATTACKS OF `§12`, AND WHERE EACH ONE STOPS
 *
 *   A. verified artifact holds version A; caller supplies an attacker key AND an
 *      attacker-signed version B  ->  B's tuple is not in the verified set: REFUSED HERE,
 *      before any signature is checked.
 *   B. verified artifact holds A; caller supplies a key that does not verify A  ->  the
 *      tuple is admitted, and `ConstructorVersionResolver.resolve` then fails the signature
 *      check and DENIES. Nothing is substituted: `admitConstructorVersionRecords` returns the
 *      records it was given, filtered by membership, and never supplies one of its own.
 *   C. caller supplies a correctly signed record for a constructor absent from the verified
 *      bytes  ->  REFUSED HERE.
 *   D. the class-19 artifact is edited and re-signed as a legitimate new owner-approved
 *      release  ->  after normal bundle publication the new tuple IS in the verified set and
 *      is admitted. Authority follows the signed bytes, which is the whole point.
 *
 * `tests/release/class19-admission.test.ts` runs all four against this module and against
 * the vulnerable control in `tests/negative-controls/unsafe-release-ceremony.ts`, which
 * makes the S1B mistake and admits B.
 * =================================================================================
 */

/**
 * The identity tuple, as a LENGTH-FRAMED key.
 *
 * `30 §5.3`'s framing argument applies to any key assembled from several strings: a bare
 * separator can be forged by content, so `("ab", "c")` and `("a", "bc")` would collide and a
 * caller could name a constructor that matched a manifested tuple it is not. Each text field
 * carries its own length, exactly as the canonicalisation rules require of a field, and the
 * two integers are unambiguous decimal.
 */
function tupleOf(record: {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
}): string {
  const framed = (value: string): string => `${String(value.length)}:${value}`;
  return [
    framed(record.constructorId),
    framed(record.actionClass),
    String(record.semanticMajor),
    String(record.nonSemanticMinor),
  ].join('|');
}

/**
 * Admit only the records the VERIFIED class-19 artifact declares.
 *
 * Both directions are checked, and both are refusals rather than warnings:
 *
 *   * a caller record outside the verified set is an attempt to create authority the owner
 *     did not sign;
 *   * a verified record the caller did not supply means the process is running a constructor
 *     set the owner's artifact does not describe, which is an incomplete deployment rather
 *     than an attack and fails closed on the same rule.
 */
export function admitConstructorVersionRecords(
  bundle: VerifiedControlArtifactBundle,
  records: readonly ConstructorVersionRecord[],
): readonly ConstructorVersionRecord[] {
  const verified = verifiedConstructorSet(bundle);
  const manifested = new Set(verified.records.map(tupleOf));
  const supplied = new Set<string>();

  for (const record of records) {
    const tuple = tupleOf(record);
    if (!manifested.has(tuple)) {
      integrityFailure(
        'CONSTRUCTOR_RECORD_NOT_MANIFESTED',
        `the constructor version record for ${quoted(record.constructorId)} at ` +
          `${String(record.semanticMajor)}.${String(record.nonSemanticMinor)} ` +
          `(${record.actionClass}) is not declared by the VERIFIED class-19 artifact ` +
          `${quoted(verified.artifactVersion)}. A caller-supplied verification key is not a ` +
          'trust root and cannot admit a record the owner did not sign (50 §3i)',
      );
    }
    if (supplied.has(tuple)) {
      integrityFailure(
        'CONSTRUCTOR_RECORD_DUPLICATED',
        `two records were supplied for ${quoted(record.constructorId)} at one version; ` +
          'registration order would otherwise decide which signed record wins',
      );
    }
    supplied.add(tuple);
  }

  for (const record of verified.records) {
    if (!supplied.has(tupleOf(record))) {
      integrityFailure(
        'MANIFESTED_CONSTRUCTOR_MISSING',
        `the verified class-19 artifact declares ${quoted(record.constructorId)} at ` +
          `${String(record.semanticMajor)}.${String(record.nonSemanticMinor)} and no such ` +
          'record was supplied; the deployment is running a constructor set the signed ' +
          'artifact does not describe',
      );
    }
  }

  return Object.freeze([...records]);
}

/**
 * THE ONLY PRODUCTION CONSTRUCTION SITE OF `ConstructorVersionResolver`.
 *
 * `tests/release/release-boundaries.test.ts` asserts that over the whole of `src/` against a
 * hand-authored allow-list naming this file and nothing else, so a later slice that wires
 * constructor resolution into a kernel path cannot reach the raw constructor by accident.
 *
 * `legacyRecordVerifyingKey` is `50 §3i`'s unmigrated argument and is named for what it is.
 * It verifies the S1B `ConstructorVersionRecord` signature — a SEPARATE signature over
 * `ACOS-JCS-1` canonical bytes, not an `ACOS-CAS-SIG-V1` owner artifact signature — and it
 * selects nothing: membership was already decided by the verified artifact above.
 */
export function verifiedConstructorVersionResolver(
  bundle: VerifiedControlArtifactBundle,
  records: readonly ConstructorVersionRecord[],
  legacyRecordVerifyingKey: KeyObject | Buffer,
): ConstructorVersionResolver {
  return new ConstructorVersionResolver(
    legacyRecordVerifyingKey,
    admitConstructorVersionRecords(bundle, records),
  );
}
