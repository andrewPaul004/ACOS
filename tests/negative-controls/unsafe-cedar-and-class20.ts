import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEST-ONLY VULNERABLE CONTROLS 15 AND 16 — Cedar admitted on a digest, and class 20 signed
 * as an implementation.
 *
 * =================================================================================
 * 15. CEDAR DIGEST-ONLY AUTHENTICATION
 *
 * `50 §2e`, O4's runtime rule, verbatim: "**A Cedar policy bundle is admitted to the engine
 * only after the verified manifest, its `content_hash`, its primary signature and its
 * second-factor signature have all been checked.** A bundle presented with a matching hash
 * and no valid signature pair is **REFUSED**."
 *
 * The unsafe loader takes the policy bytes AND a digest from the same place, checks that
 * they agree, and loads. A digest supplied alongside the thing it describes authenticates
 * nothing: an attacker who can replace the policy can replace the digest in the same edit.
 * This is `consistency-v1.3.6-negative-control-cedar-hash-only` as running code.
 *
 * =================================================================================
 * 16. CLASS 20 AS AN IMPLEMENTATION HASH
 *
 * `50 §2b`: "**Class 20 signs THE SPECIFICATION, never an implementation.**" and
 * `phase2-v1.3.6-errata.md §8`: "Signing an implementation signs a conformant instance, not
 * the specification, and `50 §3` property 2 requires the audit plane to recompute the same
 * hash from a **different** implementation, which by construction does not hash alike."
 *
 * The unsafe class-20 identity is the digest of the TypeScript canonicaliser's source. It
 * has three consequences the test asserts: it is not the frozen specification digest; it
 * moves when an implementation is refactored with no semantic change; and the audit plane's
 * independent PL/pgSQL implementation cannot produce it at all, so the two planes can never
 * agree on one identity.
 * =================================================================================
 */

// ---------------------------------------------------------------------------------
// 15 — the digest-only Cedar loader.
// ---------------------------------------------------------------------------------

export interface UnsafeCedarLoadInput {
  readonly schema: string;
  readonly policies: readonly { readonly id: string; readonly source: string }[];
  /** Supplied ALONGSIDE the bytes it describes. That is the defect. */
  readonly declaredDigest: string;
}

export interface UnsafeCedarLoadResult {
  readonly loaded: boolean;
  readonly reason?: string;
  readonly policyIds?: readonly string[];
}

function unsafeBundleDigest(input: UnsafeCedarLoadInput): string {
  const hash = createHash('sha256');
  hash.update(input.schema, 'utf8');
  for (const policy of [...input.policies].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    hash.update(policy.id, 'utf8');
    hash.update(policy.source, 'utf8');
  }
  return hash.digest('hex');
}

/** Loads whenever the bytes match the digest that arrived with them. No signature at all. */
export function unsafeLoadCedarByDigest(input: UnsafeCedarLoadInput): UnsafeCedarLoadResult {
  const computed = unsafeBundleDigest(input);
  if (computed !== input.declaredDigest) {
    return { loaded: false, reason: 'DIGEST_MISMATCH' };
  }
  return { loaded: true, policyIds: input.policies.map((policy) => policy.id) };
}

/**
 * An attacker's replacement bundle: a permissive policy set, and the digest OF THAT SET
 * supplied alongside it. The unsafe loader accepts it because it is self-consistent.
 */
export function unsafeAttackerCedarBundle(): UnsafeCedarLoadInput {
  const schema = 'namespace Acos { entity Role; }';
  const policies = [
    { id: 'acos.attacker.permit_everything', source: 'permit(principal, action, resource);' },
  ];
  const partial: UnsafeCedarLoadInput = { schema, policies, declaredDigest: '' };
  return { schema, policies, declaredDigest: unsafeBundleDigest(partial) };
}

// ---------------------------------------------------------------------------------
// 16 — class 20 as the hash of an implementation.
// ---------------------------------------------------------------------------------

/**
 * "Class 20's content hash" taken over the TypeScript canonicaliser's source files.
 *
 * It is a real digest over real files, which is exactly why it is dangerous: it looks like a
 * content hash and it authenticates the wrong object.
 */
export function unsafeClass20ImplementationDigest(canonicalisationDir: string): string {
  const files = readdirSync(canonicalisationDir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(readFileSync(join(canonicalisationDir, file)));
  return hash.digest('hex');
}
