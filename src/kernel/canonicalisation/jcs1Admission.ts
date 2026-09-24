import {
  verifiedJcs1Specification,
  type VerifiedControlArtifactBundle,
} from '../controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../controlArtifacts/registry.js';

/**
 * `50 §3g`'s CLASS-20 ADMISSION RULE — the binding between the verified specification
 * identity and the production canonicaliser.
 *
 * =================================================================================
 * THE RULE, VERBATIM
 *
 * `50 §3g`, "The class-20 special case":
 *
 *   "Because `ACOS-JCS-1` **is** class 20, **its signature envelope and its manifest
 *    verification MUST NOT REQUIRE `ACOS-JCS-1`.** They use only `SHA-256`, the fixed
 *    `ACOS-CAS-SIG-V1` framing, and Ed25519. **After class-20 artifact verification
 *    succeeds, the `ACOS-JCS-1` implementations may be admitted and used for journal
 *    canonicalisation.** That is the resolution of the circularity."
 *
 * `50 §3f`, the pre-authority gate: "`ACOS-JCS-1` consumers are bound to the **verified
 * class-20 specification identity**."
 *
 * So the binding is an ADMISSION GATE: the canonicaliser may run exactly when a verified
 * bundle is active and carries class 20 at the specification identity this implementation
 * was written against. Before that, it may not run at all.
 *
 * =================================================================================
 * WHAT THIS IS NOT, AND EACH ABSENCE IS DELIBERATE
 *
 * IT DOES NOT INTERPRET THE SPECIFICATION TEXT. `50 §2b`'s artifact is 13479 bytes of
 * English and tables. Nothing in the architecture asks a runtime to execute it, and a
 * runtime that tried would be inventing a conformance mechanism the architecture assigns
 * elsewhere.
 *
 * IT DOES NOT PROVE CONFORMANCE. `50 §2b`, verbatim: "A valid pair of owner signatures over
 * this content hash proves exactly one thing: **this is the owner-approved `ACOS-JCS-1`
 * specification.** **IT DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS TO IT.** Conformance
 * is proved by cross-implementation byte-identity validation — `36 §2`'s VC-A3 and
 * `36 §2.6`'s fixture — and **`I19` does not replace VC-A3, does not weaken it, and does not
 * discharge any of its obligations.**" VC-A3's tests are untouched by this slice and remain
 * the conformance mechanism.
 *
 * IT DOES NOT COMPARE A HARD-CODED DIGEST. The identity checked below is the
 * `artifact_version` the SIGNED MANIFEST bound — `50 §6` declares it to be the literal
 * `ACOS-JCS-1` — and the bundle's existence is what proves the bytes behind it hashed to the
 * manifest's `content_hash` under two valid owner signatures. A digest constant here would
 * be a second authority source for class 20, which `50 §3c` forbids.
 *
 * =================================================================================
 * WHY THE GATE SITS UNDER `canonicalBytes.ts` AND NOT AT ITS CALLERS
 *
 * `50 §6`'s class-20 row names the runtime consumer: "both journal chain implementations and
 * the TypeScript canonicaliser". `canonicalBytes.ts` IS the TypeScript canonicaliser — it is
 * the third production implementation of `30 §5.3`, as its own header records — so the gate
 * belongs at its entry points rather than at each of the dozen modules that hash something.
 * A gate at the callers would be a gate somebody forgets to add to the thirteenth.
 *
 * THERE IS NO CIRCULARITY IN PLACING IT THERE. `50 §3g` requires that manifest verification
 * not depend on `ACOS-JCS-1`, and it does not: `controlArtifacts/casSig.ts` imports nothing,
 * `ed25519.ts` imports only `node:crypto`, and no module on the bootstrap path reaches
 * `canonicalBytes.ts`. `tests/controlArtifacts/framing-independence.test.ts` asserts that
 * over the import graph.
 * =================================================================================
 */

/** `50 §6`: class 20's `artifact_version` is the literal `ACOS-JCS-1`. */
export const JCS1_SPECIFICATION_VERSION = 'ACOS-JCS-1';

/**
 * The bundle whose class-20 identity was last checked.
 *
 * It is a REFERENCE COMPARISON against an immutable capability, not a cached verdict about
 * bytes: `50 §3f`'s publication is a single assignment of a NEW sealed object, so a reload
 * — successful or not — cannot leave this pointing at an admission it did not earn. A failed
 * reload leaves the active bundle unchanged and this cache correct; a successful one
 * publishes a different object and the check runs again.
 */
let admittedUnder: VerifiedControlArtifactBundle | null = null;

/**
 * Admit the `ACOS-JCS-1` implementation, or refuse.
 *
 * Throws `ControlArtifactIntegrityFailure` with `NO_ACTIVE_VERIFIED_BUNDLE` when `50 §3f`
 * occasion 1 has not completed — which is the whole property: **journal and canonicalisation
 * must not operate as an authority mechanism under an unverified or wrong specification
 * identity.**
 */
export function assertJcs1SpecificationAdmitted(): void {
  const bundle = activeVerifiedControlArtifacts();
  if (bundle === admittedUnder) return;

  const specification = verifiedJcs1Specification(bundle);
  if (specification.artifactVersion !== JCS1_SPECIFICATION_VERSION) {
    throw new Error(
      `the active verified bundle carries class 20 at specification identity ` +
        `"${specification.artifactVersion}"; this ACOS-JCS-1 implementation is written ` +
        `against "${JCS1_SPECIFICATION_VERSION}" and does not canonicalise under another ` +
        '(50 §2b, 50 §3g)',
    );
  }
  admittedUnder = bundle;
}

/** The verified specification identity the canonicaliser is currently admitted under. */
export function admittedJcs1SpecificationIdentity(): {
  readonly artifactVersion: string;
  readonly contentHash: string;
} {
  assertJcs1SpecificationAdmitted();
  const specification = verifiedJcs1Specification(activeVerifiedControlArtifacts());
  return {
    artifactVersion: specification.artifactVersion,
    contentHash: specification.contentHash,
  };
}
