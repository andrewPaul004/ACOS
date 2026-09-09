/**
 * NEGATIVE — no caller-supplied authority reaches the Effect Gateway's dispatch path.
 *
 * =================================================================================
 * WHY THESE ATTACKS HAVE NO HONEST RUNTIME FORM.
 *
 * `§8` of the S1J mandate: "Do not accept `adapter` or `adapterId` as a caller/model-
 * provided execution authority." `§17`: no caller-supplied `recoverability`. `§34`: "No
 * worker/model surface may: obtain adapter instance; call adapter port; supply fresh claim
 * capability; submit adapter outcome; select outcome; mutate outbox." `§32`: the envelope is
 * immutable. `§33`: "The adapter [...] does not provide total exposure; reservation amount;
 * retained fee; MIE limit; window ceiling; approval threshold."
 *
 * A RUNTIME test for any of them would have to open the seam first, and the seam would then
 * BE the defect — the argument the accepted `I21`, S1E, S1F and S1I boundary fixtures each
 * record. THE ABSENCE OF THE FIELD is the property.
 *
 * The runtime half is `tests/negative-controls/gateway-controls.test.ts`, which exhibits
 * dispatch functions that DO take an adapter, a recoverability and a caller-chosen target,
 * and shows what each does.
 * =================================================================================
 */

import type { Pool } from '../../src/db/pool.js';
import { dispatchAuthorisedEffect } from '../../src/kernel/gateway/effectGateway.js';
import { processAdapterOutcome } from '../../src/kernel/gateway/outcomeTransaction.js';
import type {
  DispatchAttestation,
  FreshDispatchCapability,
} from '../../src/kernel/gateway/dispatchCapability.js';
import type { AdapterRegistry } from '../../src/kernel/gateway/adapterRegistry.js';
import type {
  AdapterOutcome,
  DispatchEnvelope,
  ExternalEffectAdapter,
} from '../../src/kernel/gateway/adapterPort.js';

declare const control: Pool;
declare const registry: AdapterRegistry;
declare const now: Date;
declare const envelope: DispatchEnvelope;
declare const someAdapter: ExternalEffectAdapter;

// =====================================================================================
// `§8` — THE ADAPTER IS NOT A DISPATCH PARAMETER
// =====================================================================================

// EXPECT_ERROR: `26 §5` assigns the adapter "per action class in the catalogue, not per
// request, and never by a model". The gateway resolves it from the identity the committed
// outbox row carries, so there is no field for a caller to name one in.
export const chosenAdapter = dispatchAuthorisedEffect(control, registry, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  dispatchedBy: 'worker:1',
  now,
  adapter: someAdapter, // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: nor by identity. `25 §7`: the execution metadata is "a property of the
// catalogue that a model cannot choose and a caller cannot pass".
export const chosenAdapterId = dispatchAuthorisedEffect(control, registry, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  dispatchedBy: 'worker:1',
  now,
  adapterId: 'mock_ads', // EXPECT_ERROR TS2353
});

// =====================================================================================
// `§17` — RECOVERABILITY IS NOT A DISPATCH PARAMETER EITHER
// =====================================================================================

// EXPECT_ERROR: `24 §3` K4's "What AI may not do" names "a recoverability class". The
// outcome transaction reads it from the committed `effect` row inside its own transaction.
export const spoofedRecoverability = dispatchAuthorisedEffect(control, registry, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  dispatchedBy: 'worker:1',
  now,
  recoverability: 'REVERSIBLE', // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: and neither is the outcome. `§14`: "The adapter is part of the TCB. The
// model must not choose the outcome."
export const chosenOutcome = dispatchAuthorisedEffect(control, registry, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  dispatchedBy: 'worker:1',
  now,
  outcome: { kind: 'ADAPTER_RETURNED' }, // EXPECT_ERROR TS2353
});

// =====================================================================================
// `§5` AND `§34` — A CAPABILITY AND AN ATTESTATION CANNOT BE FABRICATED
// =====================================================================================

// EXPECT_ERROR: the capability is branded with a module-private `unique symbol`, so no
// object literal inhabits the type. `§5`: "not reconstructable by loading a CLAIMED row;
// not accepted from user/model input."
export const fabricatedCapability: FreshDispatchCapability = {}; // EXPECT_ERROR TS2741

// EXPECT_ERROR: nor can a structurally plausible one be assembled from persisted values.
export const derivedCapability: FreshDispatchCapability = { // EXPECT_ERROR TS2741
  outboxId: 'outbox:1',
  claimId: 'claim:1',
} as unknown as { outboxId: string; claimId: string };

// EXPECT_ERROR: the attestation is branded the same way, so a caller cannot submit an
// outcome by asserting that an adapter produced one.
export const fabricatedAttestation: DispatchAttestation = {}; // EXPECT_ERROR TS2741

// EXPECT_ERROR: and `processAdapterOutcome` has no arm that takes a raw outcome instead of
// an attestation. There is no "trust me, the adapter said this" surface.
export const submittedOutcome = processAdapterOutcome(control, {
  identity: {
    companyId: 'co',
    idempotencyKey: 'idem:1',
    outboxId: 'outbox:1',
    effectId: 'effect:1',
    claimId: 'claim:1',
  },
  now,
  outcome: { kind: 'OUTCOME_UNKNOWN', reason: 'TIMEOUT' }, // EXPECT_ERROR TS2353
});

// =====================================================================================
// `§32` — THE ENVELOPE IS IMMUTABLE
// =====================================================================================

// EXPECT_ERROR: `§32`'s alias attack, at compile time. Every scalar on the envelope is
// `readonly`, so an adapter cannot even write the assignment.
envelope.correlationTag = 'tag:forged'; // EXPECT_ERROR TS2540

// EXPECT_ERROR: including the degraded-state requirement `30 §5.7.2` item 5 carries.
envelope.requiresUnmirroredTag = false; // EXPECT_ERROR TS2540

// EXPECT_ERROR: and the recoverability `26 §5` assigns.
envelope.recoverability = 'REVERSIBLE'; // EXPECT_ERROR TS2540

// =====================================================================================
// `§33` — AN ADAPTER OUTCOME CARRIES NO ECONOMIC QUANTITY
// =====================================================================================

// EXPECT_ERROR: `§33`: "No generic `adapterResult.exposure` field." `26 §1` Corollary 3
// puts the economics with the ceiling's enforcer, and an adapter is its subject.
export const outcomeWithExposure: AdapterOutcome = {
  kind: 'ADAPTER_RETURNED',
  providerReference: null,
  rawResponseHash: null,
  totalExposure: '10.00', // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: nor an MIE quantity, which is what `S1J-C1` is about.
export const outcomeWithMie: AdapterOutcome = {
  kind: 'OUTCOME_UNKNOWN',
  reason: 'TIMEOUT',
  irrecoverableUnits: 1, // EXPECT_ERROR TS2353
};

// =====================================================================================
// `§9` — THE ENVELOPE IS NOT A VENDOR REQUEST, AND CARRIES NO TRANSPORT
// =====================================================================================

interface VendorRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

// EXPECT_ERROR: `48 §4`'s perimeter has one vendor client per adapter and the kernel holds
// none. There is no endpoint, header set, credential or method URL on a dispatch envelope.
export const asVendorRequest: VendorRequest = envelope; // EXPECT_ERROR TS2739
