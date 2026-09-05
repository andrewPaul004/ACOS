import { describe, expect, it } from 'vitest';

import { money, toDb } from '../../src/kernel/exposure/money.js';
import {
  authorizationRequestHash,
  dispatchPayloadHash,
} from '../../src/kernel/canonicalisation/canonicaliser.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { offerForReservation } from '../../src/kernel/canonicalisation/ports/reservationHandoff.js';
import type { AuthoritativeRetainedFee } from '../../src/kernel/canonicalisation/authoritativeCost.js';
import {
  FIXTURE_RETAINED_FEE,
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from '../support/canonicalisationFixture.js';
import {
  VC_C1,
  VC_C1_MUTATED_FEE,
  formatMinor,
  oracleMutatedTotalExposureMinor,
  oracleTotalExposureMinor,
} from '../support/canonicalisationOracle.js';

/**
 * S1B.1 — retained-fee provenance, and the distinction the mutation exposes.
 *
 * Owner clarification S1B-C3a. The withdrawn S1B-C3 asserted a universal
 * `round_half_away(amount × 2.9%) + $0.30` schedule on the strength of the architecture's
 * printed `$1.03`. The architecture establishes that a refund may carry a retained
 * processing fee, that the fee is an authoritative cost component, and that the fixture is
 * `$25.00 / $1.03 / $26.03`. It establishes no schedule. S1B therefore knows an AMOUNT.
 *
 * ---------------------------------------------------------------------------------
 * WHAT TEST B IS FOR
 *
 * Change nothing but the authoritative retained fee and two things must be true at once:
 *
 *   the IDENTITY of the vendor effect does not move — `option_id`, the semantic option
 *     digest, the dispatch payload, the monetary effect, the idempotency key;
 *
 *   the CURRENT AUTHORITATIVE ECONOMIC COST of performing it does move — `total_exposure`,
 *     the reservation handoff amount, and the authority commitment over exposure.
 *
 * `26 §2.2` declares the `refund.create` semantic option digest as
 * "line_id · parent_transaction_id · amount · instrument · reason_code_scope". The retained
 * fee is not a member, and S1B.1 does not modify that declaration.
 * ---------------------------------------------------------------------------------
 */

const option = makeRefundOption();
const { canonicaliser } = makeCanonicaliser();

function canonicaliseWithFee(fee: AuthoritativeRetainedFee) {
  return canonicaliser.canonicalise(
    parseProposedIntent(makeRawIntent(option)),
    makeContext({ retainedProcessingFee: fee }),
    option,
  );
}

/** $1.10 — the same record, a different authoritative figure. */
const MUTATED_FEE: AuthoritativeRetainedFee = {
  ...FIXTURE_RETAINED_FEE,
  amount: money(formatMinor(VC_C1_MUTATED_FEE.authoritativeRetainedFeeMinor)),
};

const base = canonicaliseWithFee(FIXTURE_RETAINED_FEE);
const mutated = canonicaliseWithFee(MUTATED_FEE);

describe('A — the fixture: amount $25.00, authoritative retained fee $1.03', () => {
  it('total_exposure is $26.03, and the oracle computed it without the constructor', () => {
    expect(formatMinor(oracleTotalExposureMinor())).toBe('26.03');
    expect(toDb(base.request.exposure.totalExposure)).toBe(
      formatMinor(VC_C1.expectedTotalExposureMinor),
    );
    expect(toDb(base.request.exposure.totalExposure)).toBe('26.03');
  });

  it('the cost component is the authoritative fee, naming the record it came from', () => {
    const [component] = base.request.exposure.costComponents;
    expect(component!.kind).toBe('RETAINED_PROCESSING_FEE');
    expect(toDb(component!.amount)).toBe('1.03');
    // The source is a RECORD reference, not a schedule identifier.
    expect(component!.sourceRef).toBe(FIXTURE_RETAINED_FEE.sourceRef);
  });
});

describe('B — the authoritative fee moves, the vendor effect does not', () => {
  it('the dispatched monetary effect is still $25.00', () => {
    expect(toDb(mutated.dispatchPayload.monetaryEffect!)).toBe('25.00');
    expect(toDb(mutated.request.exposure.vendorAmount!)).toBe('25.00');
  });

  it('the vendor payload is semantically unchanged, field for field', () => {
    expect({ ...mutated.dispatchPayload.vendorParameters }).toEqual({
      ...base.dispatchPayload.vendorParameters,
    });
    expect(mutated.dispatchPayload).toEqual(base.dispatchPayload);
    expect(dispatchPayloadHash(mutated.dispatchPayload)).toBe(
      dispatchPayloadHash(base.dispatchPayload),
    );
  });

  it('option_id and the semantic option digest are unchanged', () => {
    // `26 §2.2` does not include the retained fee in the refund semantic option digest, and
    // S1B.1 does not change that declaration. The same effect at a different cost is still
    // the same effect.
    expect(mutated.request.selectedOption.optionId).toBe(base.request.selectedOption.optionId);
    expect(mutated.request.selectedOption.semanticOptionDigest).toBe(
      base.request.selectedOption.semanticOptionDigest,
    );
  });

  it('the idempotency key is unchanged — a functionally identical refund', () => {
    expect(mutated.dispatchPayload.idempotencyKey).toBe(base.dispatchPayload.idempotencyKey);
  });

  it('total_exposure moves $26.03 -> $26.10', () => {
    expect(formatMinor(oracleMutatedTotalExposureMinor())).toBe('26.10');
    expect(toDb(mutated.request.exposure.totalExposure)).toBe(
      formatMinor(VC_C1_MUTATED_FEE.expectedTotalExposureMinor),
    );
    expect(toDb(mutated.request.exposure.totalExposure)).toBe('26.10');
    expect(toDb(mutated.request.exposure.costComponents[0]!.amount)).toBe('1.10');
  });

  it('the reservation-handoff amount moves with it — I18b', () => {
    expect(toDb(offerForReservation(base.request).offeredAmount)).toBe('26.03');
    expect(toDb(offerForReservation(mutated.request).offeredAmount)).toBe('26.10');
  });

  it('the authority commitment over exposure CHANGES', () => {
    // `dispatch_payload_hash` deliberately does not move: the vendor request is identical.
    // An authority hash that also did not move would mean the reserved quantity changed
    // with nothing committing to it.
    expect(mutated.request.dispatchPayloadHash).toBe(base.request.dispatchPayloadHash);
    expect(authorizationRequestHash(mutated.request)).not.toBe(
      authorizationRequestHash(base.request),
    );
    expect(authorizationRequestHash(base.request)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('and the authority commitment is stable for an identical fee', () => {
    expect(authorizationRequestHash(canonicaliseWithFee(FIXTURE_RETAINED_FEE).request)).toBe(
      authorizationRequestHash(base.request),
    );
  });

  it('rationale remains irrelevant to all of it', () => {
    const other = canonicaliser.canonicalise(
      parseProposedIntent(
        makeRawIntent(option, { rationale: 'The processor raised its fee, apparently.' }),
      ),
      makeContext({ retainedProcessingFee: MUTATED_FEE }),
      option,
    );
    expect(toDb(other.request.exposure.totalExposure)).toBe('26.10');
    expect(authorizationRequestHash(other.request)).toBe(authorizationRequestHash(mutated.request));
    expect(other.dispatchPayload).toEqual(mutated.dispatchPayload);
  });
});

describe('the fee is kernel-owned authoritative input, not a derivation', () => {
  it('a fee absent for a class the catalogue does not declare cost-component-free throws', () => {
    // Not a denial: no `ProposedIntent` can cause it, and driving `cost_components` to zero
    // is the defect `26 §2.1.1` names. It is a state-resolution defect upstream.
    expect(() =>
      canonicaliser.canonicalise(
        parseProposedIntent(makeRawIntent(option)),
        makeContext({ retainedProcessingFee: null }),
        option,
      ),
    ).toThrow(/retained processing fee is absent/);
  });

  it('a fee in another currency than the ledger currency throws', () => {
    expect(() =>
      canonicaliseWithFee({ ...FIXTURE_RETAINED_FEE, currency: 'EUR' }),
    ).toThrow(/not the ledger currency/);
  });

  it('a larger refund does NOT scale the fee, because S1B knows no rate', () => {
    // The clearest statement that the withdrawn schedule is gone. Under S1B-C3 a $40.00
    // refund produced $1.46 by arithmetic nobody authorised. Under S1B-C3a it produces
    // whatever the authoritative record says, which here is still $1.03.
    const bigger = makeRefundOption({ amount: money('40.00') });
    const result = canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(bigger)),
      makeContext(),
      bigger,
    );
    expect(toDb(result.request.exposure.vendorAmount!)).toBe('40.00');
    expect(toDb(result.request.exposure.costComponents[0]!.amount)).toBe('1.03');
    expect(toDb(result.request.exposure.totalExposure)).toBe('41.03');
  });
});
