import { describe, expect, it } from 'vitest';

import { money, toDb } from '../../src/kernel/exposure/money.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { offerForReservation } from '../../src/kernel/canonicalisation/ports/reservationHandoff.js';
import {
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from '../support/canonicalisationFixture.js';
import {
  VC_C1,
  VC_C1_EXPECTED_ADAPTER,
  VC_C1_EXPECTED_METHOD,
  VC_C1_EXPECTED_VENDOR_PARAMETERS,
  VC_C1_EXPECTED_WINDOW_REFS,
  VC_C1_ORDER,
  formatMinor,
} from '../support/canonicalisationOracle.js';

/**
 * VC-C1 — the construction half.
 *
 * `36 §2`, verbatim:
 *
 *   "VC-C1 additionally asserts the negative case the retirement was about: a $25.00 line
 *    refund with a $1.03 retained fee computes total_exposure = $26.03 and denies
 *    PER_ACTION against a $25.00 cap. Under v1.1's I18 the same fixture was unsatisfiable
 *    in both readings."
 *
 * `26 §2.1.1`, on why the fixture discriminates, verbatim:
 *
 *   | monetary_effect = $26.03 | Not the dispatched amount — the vendor request says
 *   |                          | $25.00. Vacuous, in exactly the way 36 §0 forbids.
 *   | monetary_effect = $25.00 | ≠ exposure. I18 is violated by every correctly
 *   |                          | constructed refund.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS FILE PROVES, AND WHAT IT EXPLICITLY DOES NOT
 *
 * PROVEN here: the construction half. $25.00 + $1.03 = $26.03; I18a; I18c; and that the
 * quantity offered to the reservation layer is $26.03.
 *
 * NOT PROVEN here, and NOT CLAIMED: `DENY: PER_ACTION`. That is a POLICY result and S1B
 * implements no policy engine. The oracle shows $26.03 > the $25.00 cap, which is an
 * arithmetic fact about the constructed exposure and is reported as exactly that. No
 * temporary policy engine was built to make a test say DENY. Full VC-C1 is PARTIAL after
 * S1B — see docs/implementation/S1B-result.md.
 *
 * Every expected value comes from tests/support/canonicalisationOracle.ts, which imports
 * nothing from `src/`.
 * ---------------------------------------------------------------------------------
 */

const option = makeRefundOption();
const { canonicaliser } = makeCanonicaliser();
const { request, dispatchPayload } = canonicaliser.canonicalise(
  parseProposedIntent(makeRawIntent(option)),
  makeContext(),
  option,
);

describe('the fixture: $25.00 refund, $1.03 retained processing fee', () => {
  it('the retained fee is a cost component of $1.03, sourced from an authoritative record', () => {
    const components = request.exposure.costComponents;
    expect(components).toHaveLength(1);
    expect(components[0]!.kind).toBe('RETAINED_PROCESSING_FEE');
    expect(toDb(components[0]!.amount)).toBe(formatMinor(VC_C1.expectedRetainedFeeMinor));
    expect(toDb(components[0]!.amount)).toBe('1.03');
    // S1B-C3a: the source is the RECORD the figure was read from, never a fee schedule.
    // S1B derives no fee and knows no rate — see retained-fee-provenance.test.ts.
    expect(components[0]!.sourceRef).toContain('record:');
    expect(components[0]!.sourceRef).not.toContain('fee_schedule');
  });

  it('vendor_amount is $25.00', () => {
    expect(toDb(request.exposure.vendorAmount!)).toBe(formatMinor(VC_C1.expectedVendorAmountMinor));
    expect(toDb(request.exposure.vendorAmount!)).toBe('25.00');
  });

  it('total_exposure is $26.03', () => {
    expect(toDb(request.exposure.totalExposure)).toBe(
      formatMinor(VC_C1.expectedTotalExposureMinor),
    );
    expect(toDb(request.exposure.totalExposure)).toBe('26.03');
  });
});

describe('I18a — the dispatched monetary effect equals vendor_amount', () => {
  it('dispatch monetary_effect == vendor_amount == $25.00', () => {
    // Registry I18a, verbatim: "Where the dispatched vendor request carries a monetary
    // field, dispatch_payload.monetary_effect == exposure.vendor_amount."
    expect(toDb(dispatchPayload.monetaryEffect!)).toBe('25.00');
    expect(dispatchPayload.monetaryEffect).toBe(request.exposure.vendorAmount);
  });

  it('and it is NOT the total exposure', () => {
    // `26 §2.1.1` calls monetary_effect = $26.03 "vacuous, in exactly the way 36 §0
    // forbids", because it compares a kernel figure to a copy of itself.
    expect(toDb(dispatchPayload.monetaryEffect!)).not.toBe('26.03');
  });
});

describe('I18b construction half — what is offered to the reservation layer', () => {
  it('the offered amount is total_exposure == $26.03', () => {
    // Registry I18b, verbatim: "reservation.amount == exposure.total_exposure, exactly, in
    // the single ledger currency. No tolerance."
    //
    // S1B takes NO reservation: the money transaction has not been entered, and faking one
    // would be claiming the second arrow this increment does not prove. The port states the
    // quantity that WILL be offered.
    const offer = offerForReservation(request);
    expect(toDb(offer.offeredAmount)).toBe(formatMinor(VC_C1.expectedTotalExposureMinor));
    expect(toDb(offer.offeredAmount)).toBe('26.03');
    expect(offer.currency).toBe('USD');
    expect(offer.windowRefs).toEqual(VC_C1_EXPECTED_WINDOW_REFS);
  });

  it('the offered amount is not the vendor amount', () => {
    expect(toDb(offerForReservation(request).offeredAmount)).not.toBe('25.00');
  });
});

describe('I18c — total_exposure >= vendor_amount', () => {
  it('$26.03 >= $25.00', () => {
    expect(request.exposure.totalExposure >= request.exposure.vendorAmount!).toBe(true);
  });

  it('and strictly greater, because the catalogue does not declare this class cost-component-free', () => {
    // Registry I18c, verbatim: "with equality only for action classes declaring an empty
    // cost_components[] in the catalogue."
    expect(request.exposure.totalExposure > request.exposure.vendorAmount!).toBe(true);
  });
});

describe('the arithmetic fact about the per-action cap — reported, not enforced', () => {
  it('$26.03 exceeds the $25.00 per-action cap, so a correct policy must deny PER_ACTION', () => {
    // `51 §3.1`: refund.create per_action_max is $25.00.
    // `26 §8`'s refund policy tests `context.exposure.total_exposure <= 25.00`.
    //
    // This assertion is arithmetic over an independently authored cap and an independently
    // authored expected exposure. It is NOT a policy result: nothing in `src/` evaluates a
    // cap, and VC-C1's denial half stays OPEN until the Cedar slice.
    expect(VC_C1.expectedTotalExposureMinor > VC_C1.perActionCapMinor).toBe(true);

    // And the discriminating point of the whole fixture: comparing the WRONG operand
    // would have permitted.
    expect(VC_C1.expectedVendorAmountMinor > VC_C1.perActionCapMinor).toBe(false);
  });

  it('no hidden policy engine was added — the S1B tree evaluates no cap and no grant', async () => {
    /**
     * Scoped to `src/kernel/canonicalisation/`, which is everything S1B added. S1A's
     * accepted tree is untouched by S1B and is deliberately not re-litigated here: it
     * legitimately carries a `per_action_max_monetary` column, because `24 §3` K5 prints
     * `per_action_max { monetary: 0.00 }` on the `StandingRevocationAuthority`, and that
     * column is a signed authority bound, not a policy evaluation.
     */
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    const banned = ['PER_ACTION', 'per_action_max', 'permit(', 'cedar', 'Cedar', 'WINDOW_EXHAUSTED'];
    for (const file of walk('src/kernel/canonicalisation')) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const needle of banned) {
        expect(code, `${file} contains ${needle}`).not.toContain(needle);
      }
    }
  });
});

describe('the dispatch payload is final and adapter-consumable verbatim', () => {
  it('matches the hand-authored expected payload field for field', () => {
    expect(dispatchPayload.adapter).toBe(VC_C1_EXPECTED_ADAPTER);
    expect(dispatchPayload.method).toBe(VC_C1_EXPECTED_METHOD);
    expect({ ...dispatchPayload.vendorParameters }).toEqual({
      ...VC_C1_EXPECTED_VENDOR_PARAMETERS,
    });
  });

  it('carries no vendor optimistic-concurrency token, and records why', () => {
    // `26 §2.1` (v1.2, CAN-10): "NULL and recorded as unsupported per class where it does
    // not [support conditional writes]." The S1 adapter is a mock and exposes none.
    expect(dispatchPayload.preconditionToken).toBeNull();
  });
});

describe('every authority field is kernel-derived, none from the intent', () => {
  it('recoverability and value_direction come from the catalogue', () => {
    // `26 §5`: refund.create is COMPENSABLE.  `26 §11.2` row 3: INBOUND_ORIGINAL_INSTRUMENT.
    expect(request.recoverability).toBe('COMPENSABLE');
    expect(request.valueDirection).toBe('INBOUND_ORIGINAL_INSTRUMENT');
  });

  it('window_refs come from the authoritative grant/window boundary, NOT the catalogue', () => {
    // S1B-C5a. The catalogue declares no windows at all — see
    // window-ref-provenance.test.ts, which proves the four properties this repair requires.
    expect(request.windowRefs).toEqual(VC_C1_EXPECTED_WINDOW_REFS);
  });

  it('counterparty is null and the destination is a computed parameter', () => {
    // `26 §11.2` row 3, counterparty column, verbatim: "n/a — destination derived by the
    // canonicaliser from the RECORD-grade transaction, never from the intent."
    // S1B-owner-clarifications.md S1B-C4.
    expect(request.counterparty).toBeNull();
    expect(request.parameters.destinationInstrumentRef).toBe(
      VC_C1_ORDER.destinationInstrumentRef,
    );
  });

  it('customer_novelty comes from the authoritative customer record', () => {
    expect(request.customerNovelty).toBe('RETURNING');
  });

  it('parameters are computed from the selected option, not supplied', () => {
    expect(request.parameters.amount).toBe(option.amount);
    expect(request.parameters.lineId).toBe(option.lineId);
    expect(request.parameters.parentTransactionId).toBe(option.parentTransactionId);
    expect(request.parameters.instrument).toBe('original');
    expect(request.parameters.currency).toBe('USD');
  });

  it('this is not a rate class, so there is no forward integral', () => {
    // `26 §2.1.3` — forward_integral is the rate-class field and has no referent here.
    expect(request.exposure.forwardIntegral).toBeNull();
    expect(request.exposure.irrecoverableUnits).toBe(0);
  });

  it('single ledger currency, so no FX rate is bound', () => {
    expect(request.exposure.currency).toBe('USD');
    expect(request.exposure.fxRateRef).toBeNull();
  });
});

describe('a different authoritative amount produces different economics', () => {
  it('$40.00 refund -> the SAME authoritative $1.03 fee -> $41.03 total', () => {
    // Hand-computed, independently: $40.00 + $1.03 = $41.03.
    //
    // S1B.1: the fee does NOT scale, because S1B knows no rate. Under the withdrawn
    // S1B-C3 this fixture read `$1.46`, produced by a 2.9% + $0.30 schedule the
    // architecture never established. The vendor amount is authoritative and so is the
    // fee; neither is derived from the other.
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
