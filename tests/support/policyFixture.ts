import { money, type Money } from '../../src/kernel/exposure/money.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import type { CanonicalEffect } from '../../src/kernel/canonicalisation/types.js';
import type { AuthoritativeRetainedFee } from '../../src/kernel/canonicalisation/authoritativeCost.js';
import type { ReasonCode } from '../../src/kernel/canonicalisation/actionCatalogue.js';

import {
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from './canonicalisationFixture.js';

/**
 * Kernel-side fixtures for the S1D policy suite: real canonical effects at chosen
 * authoritative economics.
 *
 * ---------------------------------------------------------------------------------
 * THESE ARE REAL CANONICAL EFFECTS, NOT HAND-BUILT REQUEST OBJECTS
 *
 * Every effect below comes out of the accepted S1B `EffectCanonicaliser`, through the real
 * `refund.create` constructor, with a real signed `ConstructorVersionRecord`. Nothing here
 * hand-assembles an `AuthorizationRequest`.
 *
 * That matters for the boundary suite specifically. If the fixture built an
 * `AuthorizationRequest` directly it could set `total_exposure` to any figure it liked,
 * including one no constructor would ever produce, and the boundary test would then be a
 * test of Cedar's decimal comparator rather than of the money path. Here the only way to
 * move `total_exposure` is to move an authoritative input — the option's amount, or the
 * authoritative retained fee — and let the constructor add them, which is what
 * `26 §12`'s separation says must happen.
 *
 * `PolicyEngine` is deliberately NOT constructed here. Each suite constructs its own, so a
 * suite that wants a different artifact root gets one without a shared mutable engine.
 * ---------------------------------------------------------------------------------
 */

/** `51 §3.1`'s per-action bound, as the ORACLE holds it. Never imported from `src/`. */
export const PER_ACTION_MAX_LITERAL = '25.00';

/**
 * The VC-C1 fixture, unchanged from S1B and from `36 §2`.
 *
 * `26 §2.1.1`, verbatim: "a $25.00 line refund carrying a $1.03 retained fee computes
 * `total_exposure = $26.03` and **denies `PER_ACTION`**."
 */
export const VC_C1_VENDOR_AMOUNT = '25.00';
export const VC_C1_RETAINED_FEE = '1.03';
export const VC_C1_TOTAL_EXPOSURE = '26.03';

export interface EffectShape {
  /** The option's amount — becomes `exposure.vendor_amount` and the dispatched money. */
  readonly vendorAmount: string;
  /** The authoritative retained processing fee amount. */
  readonly retainedFee: string;
  /** `26 §8`'s `line_refundable_remaining`. Defaults high enough not to bind. */
  readonly lineRefundableRemaining?: string;
  readonly instrument?: string;
  readonly reasonCode?: ReasonCode | string;
  readonly rationale?: string;
  readonly grade?: 'RECORD' | 'OBSERVATION' | 'CLAIM' | 'DECISION_DELEGATED';
  readonly principalRole?: string;
  readonly ledgerCurrency?: string;
}

const FEE_SOURCE_REF = 'record:processor_settlement_terms:mock_processor:ORD-123';

function feeOf(amount: string, currency: string): AuthoritativeRetainedFee {
  return { amount: money(amount), sourceRef: FEE_SOURCE_REF, currency };
}

/**
 * Canonicalise one effect at the requested authoritative economics.
 *
 * The retained fee travels on the kernel-owned context and the amount on the kernel-owned
 * option, exactly as S1B's clarification S1B-C3a requires: the fixture states the figures
 * and the constructor adds them. No fee is derived from a rate anywhere.
 */
export function canonicalEffectAt(shape: EffectShape): CanonicalEffect {
  const currency = shape.ledgerCurrency ?? 'USD';
  const { canonicaliser } = makeCanonicaliser();
  const option = makeRefundOption({
    amount: money(shape.vendorAmount),
    ...(shape.instrument === undefined ? {} : { instrument: shape.instrument }),
    lineRefundableRemaining: money(shape.lineRefundableRemaining ?? '1000.00'),
    currency,
  });
  const context = makeContext({
    retainedProcessingFee: feeOf(shape.retainedFee, currency),
    ledgerCurrency: currency,
    ...(shape.principalRole === undefined ? {} : { principalRole: shape.principalRole }),
    ...(shape.grade === undefined
      ? {}
      : {
          resource: {
            resourceRef: 'order:ORD-123',
            resourceId: 'ORD-123',
            grade: shape.grade,
          },
        }),
  });
  const intent = parseProposedIntent(
    makeRawIntent(option, {
      ...(shape.reasonCode === undefined ? {} : { reasonCode: shape.reasonCode }),
      ...(shape.rationale === undefined ? {} : { rationale: shape.rationale }),
    }),
  );
  return canonicaliser.canonicalise(intent, context, option);
}

/**
 * An effect whose `total_exposure` is exactly `total`, carrying a real non-zero retained fee.
 *
 * The split is `total − fee` vendor plus `fee` retained. The fee is held at VC-C1's $1.03
 * throughout the boundary suite so the ONLY thing moving across the boundary is the total,
 * and the vendor amount moves the OTHER way — which is what makes the boundary suite
 * discriminating rather than a restatement of the vendor amount under another name.
 *
 * The subtraction happens HERE, in the fixture, and never in `src/kernel/policy/`. The
 * production path only ever adds authoritative components; the test arithmetic that chooses
 * a fixture is not production arithmetic.
 */
export function effectWithTotalExposure(
  total: string,
  fee: string = VC_C1_RETAINED_FEE,
  extra: Partial<EffectShape> = {},
): CanonicalEffect {
  const vendorMinor = minorOf(total) - minorOf(fee);
  if (vendorMinor <= 0n) {
    throw new Error(`fixture: a total of ${total} leaves no positive vendor amount after ${fee}`);
  }
  return canonicalEffectAt({
    vendorAmount: renderMinor(vendorMinor),
    retainedFee: fee,
    ...extra,
  });
}

/** Hand arithmetic for the fixture, in minor units. Not a money primitive from `src/`. */
function minorOf(literal: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(literal);
  if (match === null) throw new Error(`fixture: ${literal} is not a 2-place decimal`);
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function renderMinor(minor: bigint): string {
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}

/** Read a `Money` back as a literal, for assertions. */
export function asLiteral(value: Money): string {
  return renderMinor(value);
}
