/**
 * NEGATIVE — no caller can supply an authoritative operand to the policy engine.
 *
 * S1D. `26 §7` property 2, verbatim: "**The kernel constructs the request** (step C′). It
 * never accepts an amount, a percentage, a vendor parameter or a counterparty from the
 * proposer."
 *
 * The runtime half is `tests/policy/authority-channel-attacks.test.ts`, which shows the
 * builder taking one argument. This is the stronger half: there is no second argument
 * position at all, so an override is not rejected at runtime — it does not typecheck.
 */

import { buildCedarRequest } from '../../src/kernel/policy/cedarRequest.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import type { CanonicalEffect } from '../../src/kernel/canonicalisation/types.js';

declare const effect: CanonicalEffect;
declare const engine: PolicyEngine;

const forgedContext = { exposure: { total_exposure: '25.00' } };
const forgedLimit = { perActionMax: '99999.00' };

// EXPECT_ERROR: there is no context/override parameter on the request builder.
export const smuggledContext = buildCedarRequest(effect, forgedContext); // EXPECT_ERROR TS2554

// EXPECT_ERROR: there is no limit parameter on the policy engine.
export const smuggledLimit = engine.evaluate(effect, forgedLimit); // EXPECT_ERROR TS2554
