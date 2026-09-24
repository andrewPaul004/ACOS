import * as cedar from '@cedar-policy/cedar-wasm/nodejs';

import { canonicalHash, hex } from '../canonicalisation/canonicalBytes.js';
import {
  bundleManifestId,
  verifiedPolicySet,
  type VerifiedControlArtifactBundle,
} from '../controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../controlArtifacts/registry.js';
import { policyDefect } from './errors.js';

/**
 * The Cedar schema and policy set, loaded FROM THE VERIFIED CLASS-2 BUNDLE — `50 §2e`.
 *
 * =================================================================================
 * O4'S RUNTIME RULE, VERBATIM (`50 §2e`, v1.3.6)
 *
 *   "**A Cedar policy bundle is admitted to the engine only after the verified manifest, its
 *    `content_hash`, its primary signature and its second-factor signature have all been
 *    checked.** A bundle presented with a matching hash and no valid signature pair is
 *    **REFUSED**."
 *
 * S1D built this module to read `.cedar` files from a directory and compute a digest over
 * them, and said so in its own header: "**It is not signing.** [...] The signature half is an
 * OPEN obligation, recorded in `S1D-result.md`."
 *
 * THAT OBLIGATION IS DISCHARGED HERE. The schema and every policy source now arrive from
 * `50 §2e`'s signed bundle, through the `VerifiedControlArtifactBundle` capability — so the
 * bytes Cedar is constructed from are bytes whose content hash matched an owner-signed
 * manifest entry and whose two Ed25519 signatures verified, before this function was
 * reachable.
 *
 * =================================================================================
 * VERIFICATION PRECEDES ADMISSION, AND THERE IS NO SECOND PATH
 *
 * `§25` of the S1K mandate: "**Do not load unsigned policy and compare digest afterward.
 * Verification must precede admission.**"
 *
 * This module no longer imports `node:fs`. There is no artifact root, no directory scan, no
 * `readFileSync`, and no overload that takes a path — so "load the files, then check" is not
 * an arrangement this file can express. `tests/controlArtifacts/cedar-o4.test.ts` asserts
 * the absence structurally, and
 * `tests/negative-controls/unsafe-cedar-and-class20.ts`'s digest-only loader is the
 * discriminating control: it accepts an attacker bundle that supplies its own digest, and
 * production cannot be handed one at all.
 *
 * =================================================================================
 * `policy_version` IS NOT THE CLASS-2 CONTENT HASH, AND BOTH ARE REQUIRED
 *
 * `50 §2e`, verbatim: "**`policy_version` is NOT the class-2 content hash, and neither
 * replaces the other.** `policy_version` is the content-derived Cedar-set digest the
 * production loader already computes over a length-framed structure of the schema and the
 * `(id, source)` pairs in sorted id order; **its accepted current value is
 * `47c2849b…c30ff6`** [...] It is recorded on every decision and it detects a policy id
 * renamed into another's text. The class-2 `content_hash` is `SHA-256` over the bundle's
 * exact deployed bytes and is what the owner signs. **Both are content-derived, both are
 * required, and the manifest entry carries the second.**"
 *
 * So `policySetDigest` stays exactly as S1D wrote it, computed over the VERIFIED sources,
 * and the manifest identity is carried alongside it.
 * =================================================================================
 */

/**
 * The complete, closed policy set.
 *
 * `50 §2e` makes the signed bundle the authority for the policy CONTENT. This list is a
 * STRUCTURAL EXPECTATION about which ids a deployment of this code is built to reason about
 * — `denialCategory.ts` maps one of them onto `26 §7` step M's `DENY: PER_ACTION` — and it
 * is diffed against the verified set in both directions. It carries no policy text and no
 * authority: a bundle whose ids differ fails closed rather than either side winning.
 */
export const EXPECTED_POLICY_IDS: readonly string[] = Object.freeze([
  'acos.refund.create.grant',
  'acos.refund.create.per_action_max',
]);

/**
 * The policy ids whose determination means `26 §7` step M denied.
 *
 * Exactly one member. A Cedar denial in which this policy is determining is
 * `DENY: PER_ACTION` and nothing else has to be inspected. See `denialCategory.ts`.
 */
export const PER_ACTION_POLICY_ID = 'acos.refund.create.per_action_max';

export interface LoadedPolicyArtifacts {
  /** The Cedar schema source, verbatim, from the verified bundle. */
  readonly schema: string;
  /** id -> policy source, in `EXPECTED_POLICY_IDS` order. Frozen. */
  readonly staticPolicies: Readonly<Record<string, string>>;
  /**
   * `26 §11`'s `policy_version`: the content hash over the schema and the whole policy set.
   *
   * Recorded on every decision this artifact set produces, so a decision is replayable
   * against the exact artifacts that produced it and a substituted artifact is visible in
   * the audit record without diffing the files.
   */
  readonly policyVersion: string;
  /**
   * `50 §3e`'s active manifest identity, for the audit record.
   *
   * It replaces S1D's `artifactRoot`. A directory path said where bytes were READ FROM; the
   * manifest id says WHICH SIGNED SET THEY BELONG TO, which is the fact a reader of a
   * decision record actually needs.
   */
  readonly manifestId: string;
  /** The class-2 bundle's declared version, as the manifest bound it. */
  readonly artifactVersion: string;
}

/**
 * Load, validate and digest the policy artifacts FROM THE VERIFIED BUNDLE.
 *
 * Throws `PolicyEvaluationDefect` on any defect; there is no partial success and no degraded
 * mode. Throws `ControlArtifactIntegrityFailure` when no verified bundle is active, which is
 * `50 §3f` occasion 3's refusal and not a policy defect.
 *
 * MALFORMED IS REFUSED BEFORE USE. `cedar.checkParseSchema` and `cedar.checkParsePolicySet`
 * run here, exactly as S1D ran them: a policy set that only fails at the first authorization
 * call is a policy set that fails at the worst moment. The owner having signed the bundle
 * does not make it parse, and `50 §5` is explicit that the manifest "says nothing about
 * whether signing it was a good idea".
 */
export function loadPolicyArtifacts(
  bundle: VerifiedControlArtifactBundle = activeVerifiedControlArtifacts(),
  expectedIds: readonly string[] = EXPECTED_POLICY_IDS,
): LoadedPolicyArtifacts {
  const verified = verifiedPolicySet(bundle);

  const schemaParse = cedar.checkParseSchema(verified.schema);
  if (schemaParse.type !== 'success') {
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the verified Cedar schema does not parse: ${describeErrors(schemaParse.errors)}`,
    );
  }

  // The exact-set diff, both directions, reported together so a reviewer sees the whole
  // discrepancy rather than the first half of it.
  const found = [...verified.policyIds].sort();
  const expected = [...expectedIds].sort();
  const missing = expected.filter((id) => !found.includes(id));
  const unexpected = found.filter((id) => !expected.includes(id));
  if (missing.length > 0 || unexpected.length > 0) {
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the verified policy set does not match the expected set — missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
    );
  }

  // In EXPECTED order, so the object's own key order is declared rather than incidental.
  const staticPolicies: Record<string, string> = {};
  for (const id of expected) staticPolicies[id] = verified.staticPolicies[id]!;

  const setParse = cedar.checkParsePolicySet({ staticPolicies });
  if (setParse.type !== 'success') {
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the verified Cedar policy set does not parse: ${describeErrors(setParse.errors)}`,
    );
  }

  return Object.freeze({
    schema: verified.schema,
    staticPolicies: Object.freeze(staticPolicies),
    policyVersion: policySetDigest(verified.schema, staticPolicies, expected),
    manifestId: bundleManifestId(bundle),
    artifactVersion: verified.artifactVersion,
  });
}

/**
 * `26 §11`'s `policy_version`, as a content hash. UNCHANGED FROM S1D.
 *
 * Length-framed through `canonicalBytes`, over the schema and then every (id, source) pair
 * in sorted id order. `30 §5.3`'s framing is what stops `("ab","c")` and `("a","bc")` from
 * digesting alike, so a policy id renamed into another policy's text cannot hold the digest
 * still.
 *
 * `50 §2e`'s accepted current value is `47c2849b…c30ff6`, and it "remains the accepted
 * current digest unless the actual policy bytes change" — which is why this computation is
 * transcribed rather than recomputed differently now that the bytes arrive from a bundle.
 */
function policySetDigest(
  schema: string,
  staticPolicies: Readonly<Record<string, string>>,
  orderedIds: readonly string[],
): string {
  return hex(
    canonicalHash('acos.policy_set.v1', [
      { kind: 'bytes', value: Buffer.from(schema, 'utf8') },
      { kind: 'integer', value: BigInt(orderedIds.length) },
      ...orderedIds.flatMap(
        (id) =>
          [
            { kind: 'text', value: id },
            { kind: 'bytes', value: Buffer.from(staticPolicies[id]!, 'utf8') },
          ] as const,
      ),
    ]),
  );
}

export function describeErrors(errors: readonly { readonly message: string }[]): string {
  return errors.map((error) => error.message).join(' | ');
}
