/**
 * NEGATIVE — `irrecoverable_units` is not an argument anywhere on the reservation path.
 *
 * =================================================================================
 * `51 §2.3`'s DECLARATION, AND WHY IT NEEDS A TYPE-LEVEL FIXTURE
 *
 * "**THE VALUE IS KERNEL- AND CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.** It
 *  is a property of the action class in exactly the sense `26 §5`'s recoverability is [...]
 *  **There is no generic caller parameter for it, and no request field carries one.**"
 *
 * A RUNTIME test for this would have to open the seam first, and the seam would then BE the
 * defect — the argument the accepted `I21`, S1E, S1F, S1I and S1J boundary fixtures each
 * record. THE ABSENCE OF THE FIELD is the property, and a type error is how an absence is
 * asserted.
 *
 * `§4` of the S1J continuation mandate says it as an instruction: "Do not add a generic
 * `irrecoverableUnits` argument to worker-facing APIs. Required type/source negative tests."
 * =================================================================================
 *
 * =================================================================================
 * THE CONTRAST WITH `countUnits` IS THE POINT, AND IT IS DELIBERATE
 *
 * `WindowTarget.countUnits` IS a request field, because `51 §2`'s count ceilings count
 * effects and the accepted S1A/S1F shape already put the figure on the request. Copying that
 * shape for MIE units would have satisfied the type checker and broken the declaration.
 *
 * So the two are asymmetric ON PURPOSE, and the last case below asserts the asymmetry
 * directly: `countUnits` compiles and `irrecoverableUnits` does not.
 * =================================================================================
 */

import type { Client } from '../../src/db/pool.js';
import { authoriseRateClass, reserveOrdinary } from '../../src/kernel/exposure/stepR.js';
import type { WindowTarget } from '../../src/kernel/exposure/stepR.js';
import {
  applyIrrecoverableReservation,
  applyIrrecoverablePresumption,
} from '../../src/kernel/exposure/ledger.js';
import type { WindowInstance } from '../../src/kernel/exposure/windowInstance.js';
import type { Money } from '../../src/kernel/exposure/money.js';
import { dispatchAuthorisedEffect } from '../../src/kernel/gateway/effectGateway.js';
import type { DispatchEnvironment } from '../../src/kernel/gateway/effectGateway.js';
import type { AdapterOutcome } from '../../src/kernel/gateway/adapterPort.js';

declare const client: Client;
declare const instance: WindowInstance;
declare const zero: Money;
declare const at: Date;
declare const env: DispatchEnvironment;

// =====================================================================================
// THE REQUEST TYPES CARRY NO UNIT COUNT
// =====================================================================================

// EXPECT_ERROR: `reserveOrdinary` resolves the count from the closed catalogue by action
// class. A request field would let a caller reserve fewer units than its class declares,
// which is `26 §1` Corollary 3 — "the request must be built by the ceiling's enforcer, not
// by its subject" — with the subject holding the pen.
export const suppliedOnRequest = reserveOrdinary(client, {
  companyId: 'co',
  authorisationId: 'auth:1',
  reservationId: 'res:1',
  actionClass: 'fulfilment.reship',
  resourceRef: 'order:ORD-1',
  exposure: { vendorAmount: null, totalExposure: zero, forwardIntegral: null },
  windows: [{ instance, countUnits: 1n }],
  at,
  irrecoverableUnits: 0n, // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: nor per window. `25 §10.1` reserves the SAME catalogue-declared count
// "against **every** applicable MIE window instance", so a per-window figure would let one
// instance be under-reserved while the others were correct.
export const suppliedPerWindow: WindowTarget = {
  instance,
  countUnits: 1n,
  irrecoverableUnits: 1n, // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: and not on the rate branch either, which declares `0` and must move the
// ledger not at all.
export const suppliedOnRateRequest = authoriseRateClass(client, {
  companyId: 'co',
  authorisationId: 'auth:2',
  reservationId: 'res:2',
  actionClass: 'campaign.budget.set',
  resourceRef: 'campaign:CMP-1',
  exposure: { vendorAmount: null, totalExposure: zero, forwardIntegral: zero },
  standingAuthorizationId: 'sa:1',
  revocationAuthorityId: 'ra:1',
  revocationEffectClass: 'campaign.budget.set',
  adapter: 'mock_ads',
  rateAmount: zero,
  rateCurrency: 'USD',
  ratePeriod: 'DAY',
  createdAt: at,
  expiresAt: at,
  cessationGraceHours: 0,
  windows: [],
  irrecoverableUnits: 1n, // EXPECT_ERROR TS2353
});

// =====================================================================================
// NOR DOES ANY DISPATCH SURFACE CARRY ONE
// =====================================================================================

// EXPECT_ERROR: `25 §10.1`'s PRESUME row moves the units THAT WERE RESERVED, read from the
// immutable `reservation_window_instance` rows. A dispatch-time figure would let a caller
// choose how much of its own commitment to release.
export const suppliedAtDispatch = dispatchAuthorisedEffect(env, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  dispatchedBy: 'worker:1',
  now: at,
  irrecoverableUnits: 1n, // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: and an adapter cannot report one. `§33`: "The adapter [...] does not provide
// total exposure; reservation amount; retained fee; MIE limit; window ceiling; approval
// threshold." `25 §7.2` puts the release decision in the kernel's policy table.
export const adapterSuppliedUnits: AdapterOutcome = {
  kind: 'NOT_SENT_CONFIRMED',
  basis: 'PRE_SEND_FAILURE',
  irrecoverableUnits: 1n, // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: an adapter cannot name the basis freely either — it is a closed two-member
// enum, and `25 §7.2` forbids the classification being "made from arbitrary error-message
// strings".
export const adapterFreeFormBasis: AdapterOutcome = {
  kind: 'NOT_SENT_CONFIRMED',
  basis: 'connection refused before send', // EXPECT_ERROR TS2322
};

// =====================================================================================
// THE LEDGER MOVEMENTS TAKE A COUNT — AND THEY ARE NOT A CALLER SURFACE
// =====================================================================================
//
// `applyIrrecoverableReservation` and `applyIrrecoverablePresumption` DO take a `units`
// argument, and that is correct: they are the statements the movement is made of, called by
// step R and the outcome transaction with a value each read from an authoritative source.
// What makes them safe is not the signature but the caller set, which
// `tests/integration/exposure/lock-order.test.ts` and
// `tests/integration/gateway/no-real-transport-boundary.test.ts` both police.
//
// So the two cases below COMPILE, deliberately, and are here so a reader does not mistake
// their absence for an oversight.

export const ledgerMovementTakesUnits = applyIrrecoverableReservation(
  client,
  'co',
  'W_DAY_MIE',
  '2026-09',
  1n,
);

export const presumptionTakesUnits = applyIrrecoverablePresumption(
  client,
  'co',
  'W_DAY_MIE',
  '2026-09',
  1n,
);

// AND THE ASYMMETRY WITH `countUnits`, STATED AS A COMPILING CASE.
export const countUnitsIsARequestField: WindowTarget = { instance, countUnits: 1n };
