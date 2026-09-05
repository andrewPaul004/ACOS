import { describe, expect, it } from 'vitest';

import { money } from '../../src/kernel/exposure/money.js';
import { computed } from '../../src/kernel/canonicalisation/brands.js';
import { dispatchPayloadHash } from '../../src/kernel/canonicalisation/canonicaliser.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import type { DispatchPayload } from '../../src/kernel/canonicalisation/types.js';
import {
  REFUND_VERSION_1_0,
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
  newTestSigner,
  signConstructorVersion,
} from '../support/canonicalisationFixture.js';

/**
 * The request/payload binding, and the six hash properties S1B must prove.
 *
 * `26 §2.1`, verbatim:
 *
 *   "AuthorizationRequest and DispatchPayload are emitted together and hashed together."
 *   "dispatch_payload_hash   // binds this request to exactly one dispatch payload"
 *
 * `30 §5.3` supplies the rules; `canonical-bytes.test.ts` asserts them at the primitive
 * level. This file asserts them at the level of the structures the canonicaliser emits.
 */

const option = makeRefundOption();
const signer = newTestSigner();
const { canonicaliser } = makeCanonicaliser({ signer });
const baseline = canonicaliser.canonicalise(
  parseProposedIntent(makeRawIntent(option)),
  makeContext(),
  option,
);

describe('1 — the same semantic request produces the same bytes and hash', () => {
  it('two independent canonicalisations agree', () => {
    const again = makeCanonicaliser({ signer }).canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option)),
      makeContext(),
      option,
    );
    expect(again.request.dispatchPayloadHash).toBe(baseline.request.dispatchPayloadHash);
    expect(dispatchPayloadHash(again.dispatchPayload)).toBe(
      dispatchPayloadHash(baseline.dispatchPayload),
    );
  });

  it('the request records the hash of the payload it was emitted with', () => {
    expect(baseline.request.dispatchPayloadHash).toBe(
      dispatchPayloadHash(baseline.dispatchPayload),
    );
    expect(baseline.request.dispatchPayloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('2 — object property insertion order does not change the hash', () => {
  /**
   * Registry `I41`'s test column, verbatim: "Round-trip a row with a structured field whose
   * keys were inserted in two different orders and assert an identical row_hash."
   *
   * The payload's `vendor_parameters` is the structured field. Rebuilding it with keys
   * inserted in reverse must not move the hash — which is true because the serialiser uses
   * a declared field order and RFC 8785 for JSON values, not `JSON.stringify`.
   */
  it('a vendor_parameters object rebuilt in reverse key order hashes identically', () => {
    const original = { ...baseline.dispatchPayload.vendorParameters };
    const reversed: Record<string, string> = {};
    for (const key of Object.keys(original).reverse()) {
      reversed[key] = original[key]!;
    }
    expect(Object.keys(reversed)).not.toEqual(Object.keys(original));

    const rebuilt: DispatchPayload = {
      ...baseline.dispatchPayload,
      vendorParameters: computed(reversed),
    };
    expect(dispatchPayloadHash(rebuilt)).toBe(dispatchPayloadHash(baseline.dispatchPayload));
  });

  it('a payload object literal built with its own keys in another order hashes identically', () => {
    const p = baseline.dispatchPayload;
    const reordered: DispatchPayload = {
      authorisationRef: p.authorisationRef,
      preconditionToken: p.preconditionToken,
      monetaryEffect: p.monetaryEffect,
      idempotencyKey: p.idempotencyKey,
      vendorParameters: p.vendorParameters,
      method: p.method,
      adapter: p.adapter,
    };
    expect(dispatchPayloadHash(reordered)).toBe(dispatchPayloadHash(p));
  });
});

describe('3 — a semantic vendor parameter change changes the dispatch hash', () => {
  it('changing the destination instrument moves the hash', () => {
    const tampered: DispatchPayload = {
      ...baseline.dispatchPayload,
      vendorParameters: computed({
        ...baseline.dispatchPayload.vendorParameters,
        destination_instrument_ref: 'instrument:pm_attacker_9999',
      }),
    };
    expect(dispatchPayloadHash(tampered)).not.toBe(dispatchPayloadHash(baseline.dispatchPayload));
  });

  it('adding a vendor parameter moves the hash', () => {
    const tampered: DispatchPayload = {
      ...baseline.dispatchPayload,
      vendorParameters: computed({
        ...baseline.dispatchPayload.vendorParameters,
        note: 'extra',
      }),
    };
    expect(dispatchPayloadHash(tampered)).not.toBe(dispatchPayloadHash(baseline.dispatchPayload));
  });
});

describe('4 — a monetary amount change changes the dispatch hash', () => {
  it('a different authoritative refund amount produces a different payload hash', () => {
    const cheaper = makeRefundOption({ amount: money('20.00') });
    const result = canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(cheaper)),
      makeContext(),
      cheaper,
    );
    expect(result.request.dispatchPayloadHash).not.toBe(baseline.request.dispatchPayloadHash);
  });

  it('mutating only monetary_effect moves the hash', () => {
    const tampered: DispatchPayload = {
      ...baseline.dispatchPayload,
      monetaryEffect: computed(money('26.03')),
    };
    expect(dispatchPayloadHash(tampered)).not.toBe(dispatchPayloadHash(baseline.dispatchPayload));
  });
});

describe('5 — constructor version changes are represented in the lineage', () => {
  /**
   * `26 §2.1.2`, verbatim: "constructor_version is recorded on the AuthorizationRequest,
   * the AuthorizationDecision, the journal row, the approval binding alongside
   * dispatch_payload_hash, and the replay context."
   *
   * So the version travels on the REQUEST, alongside the payload hash — not inside the
   * payload. A non-semantic bump must therefore leave the dispatched bytes alone while
   * still being recorded, which is precisely what makes a `non_semantic_minor` resume
   * replay-compatible in the later slice.
   */
  it('a non-semantic bump changes the recorded version identity', () => {
    const bumped = makeCanonicaliser({
      signer,
      records: [
        signConstructorVersion(signer, {
          ...REFUND_VERSION_1_0,
          nonSemanticMinor: 1,
          changedFields: ['logging'],
        }),
      ],
    }).canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option)),
      makeContext(),
      option,
    );
    expect(bumped.request.constructorVersion.nonSemanticMinor).toBe(1);
    expect(bumped.request.constructorVersion.recordHash).not.toBe(
      baseline.request.constructorVersion.recordHash,
    );
  });

  it('and leaves the dispatched bytes identical', () => {
    const bumped = makeCanonicaliser({
      signer,
      records: [
        signConstructorVersion(signer, {
          ...REFUND_VERSION_1_0,
          nonSemanticMinor: 1,
          changedFields: ['logging'],
        }),
      ],
    }).canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option)),
      makeContext(),
      option,
    );
    expect(bumped.request.dispatchPayloadHash).toBe(baseline.request.dispatchPayloadHash);
  });
});

describe('6 — a rationale-only change cannot change the dispatch payload hash', () => {
  it('two rationales, one payload hash', () => {
    const other = canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option, { rationale: 'A completely different story.' })),
      makeContext(),
      option,
    );
    expect(other.request.dispatchPayloadHash).toBe(baseline.request.dispatchPayloadHash);
    expect(other.dispatchPayload).toEqual(baseline.dispatchPayload);
  });
});
