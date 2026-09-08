import { verify as verifyEd25519, type KeyObject } from 'node:crypto';

import {
  signalSigningBytes,
  type SignalWire,
} from '../../src/kernel/mirror/corroborationSignal.js';
import type {
  HeldCorroboration,
  MirrorState,
  MirrorStateOperands,
} from '../../src/kernel/mirror/mirrorState.js';

/**
 * TEST-ONLY VULNERABLE MIRROR STATE MACHINES. NOT REACHABLE FROM `src/`.
 *
 * =================================================================================
 * WHY THESE EXIST — `36 §0`, AND `§32`/`§33` OF THE S1H MANDATE
 *
 * `36 §0`: "Negative control, mandatory: [...] Without it, a pass is indistinguishable from
 * a test that does not exercise the race."
 *
 * The inversion (`30 §5.6`) and the freshness rule (`30 §5.7.1`) are both properties whose
 * production behaviour is a REFUSAL. A suite that only asserted the refusals would pass
 * identically against an implementation that refused for the wrong reason, or against one
 * that happened never to reach the relaxed state at all. These two deliberately unsafe
 * resolvers reach it, on the same fixtures, so each production refusal is shown to
 * DISCRIMINATE.
 *
 * `§33`: "Unsafe state machine: control declaration directly enters relaxed degraded mode."
 * `§32`: "Unsafe state machine: verifies signature; ignores `max_age`."
 *
 * NEITHER IS IMPORTED BY ANY FILE UNDER `src/`. This file has a `.ts` extension and no
 * `.test.ts`, so vitest does not collect it as a suite; it is imported by the two negative
 * controls that use it, and `no-dispatch-boundary.test.ts` asserts that nothing in `src/`
 * imports anything from `tests/`.
 * =================================================================================
 */

/**
 * UNSAFE #1 — SELF-DECLARED DEGRADATION.
 *
 * The v1.1 design `30 §5.6` names as the defect: "v1.1's degraded mode was **declared by the
 * control plane** and it **relaxed** the dispatch rule — clock-bearing COMPENSABLE effects
 * dispatch unmirrored. So a compromised control plane declares degradation and dispatches
 * refunds with no external record, which is a self-authorising escape from the audit plane.
 * `52 §1` Path B."
 *
 * Reproduced here EXACTLY: a declaration alone reaches `CORROBORATED_DEGRADED`. No signal is
 * consulted, no signature is verified, no freshness is tested. Production's
 * `resolveMirrorState` given the same operands reaches `UNCORROBORATED_STALL`, and
 * `vc-a2-self-declared-degradation.test.ts` shows the two dispositions differ for a
 * clock-bearing COMPENSABLE effect: the unsafe machine makes it future-dispatch eligible
 * and production suspends it.
 */
export function unsafeSelfDeclaredResolver(operands: MirrorStateOperands): MirrorState {
  if (!operands.declarationOpen) return 'NORMAL';
  // "Degraded mode was self-declared." The whole defect, in one line.
  return 'CORROBORATED_DEGRADED';
}

/**
 * UNSAFE #2 — SIGNATURE VERIFIED, `max_age` IGNORED.
 *
 * `30 §5.7.1` on what v1.2 was missing: "v1.2 said the control plane enters
 * `CORROBORATED_DEGRADED` on *'the audit plane's own signal'* and declared no endpoint, no
 * transport, no authentication, no signature and — **the load-bearing one — no freshness**.
 * Registry rule 6 applied to a state transition."
 *
 * This resolver is a faithful implementation of the repaired-but-one version: it does the
 * cryptography properly and then never asks how old the artifact is. It is the
 * implementation `§8` of the mandate requires as a discriminating control: "A TEST-ONLY state
 * machine that validates signature but ignores freshness. Use a replay fixture where the
 * vulnerable implementation enters `CORROBORATED_DEGRADED` and production refuses."
 *
 * Note what it DOES check, so the control is sharp rather than trivially broken: the
 * signature must verify, and the company must match. Only freshness is missing, so
 * `vc-a2d-signal-replay.test.ts`'s discrimination isolates that single operand.
 */
export function unsafeSignatureOnlyResolver(
  declarationOpen: boolean,
  signal: SignalWire | null,
  companyId: string,
  auditPublicKey: KeyObject,
): MirrorState {
  if (!declarationOpen) return 'NORMAL';
  if (signal === null) return 'UNCORROBORATED_STALL';
  if (signal.companyId !== companyId) return 'UNCORROBORATED_STALL';
  let valid: boolean;
  try {
    valid = verifyEd25519(null, signalSigningBytes(signal), auditPublicKey, signal.signature);
  } catch {
    valid = false;
  }
  if (!valid) return 'UNCORROBORATED_STALL';
  // AND HERE IS THE HOLE: no `now() − observed_at ≤ max_age`, no `now() < expires_at`, no
  // consumed-`signal_id` check. A signal issued during a genuine outage and replayed after
  // recovery unlocks the relaxed state indefinitely.
  return 'CORROBORATED_DEGRADED';
}

/**
 * A `HeldCorroboration` built with no freshness gate, for feeding the unsafe resolver's
 * result into the shared classifier.
 *
 * Exists so the two machines can be compared through ONE classifier — the difference under
 * test is the STATE, and running the unsafe machine's output through a second unsafe
 * classifier would confound the two.
 */
export function heldFrom(signal: SignalWire): HeldCorroboration {
  return {
    signalId: signal.signalId,
    companyId: signal.companyId,
    observedAt: signal.observedAt,
    expiresAt: signal.expiresAt,
    intervalStart: signal.intervalStart,
    reason: signal.reason,
  };
}
