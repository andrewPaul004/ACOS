import { canonicalHash, hashConcat, hex } from './canonicalBytes.js';
import type { ActionClass } from './actionCatalogue.js';
import type { RefundParameters } from './types.js';

/**
 * The effect idempotency key.
 *
 * `25 §7`, the effect layer of the three-layer table, verbatim:
 *
 *   Effect | H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)
 *          | Two external effects for one intent.
 *
 * and, verbatim:
 *
 *   "The effect key is deterministic, not random. This is the whole point. A crash between
 *    journaling and adapter invocation, followed by a restart, must regenerate the same key
 *    so the adapter's own idempotency (or the reconciler's lookup) recognises it. A UUID
 *    minted at attempt time provides no protection against exactly the failure that
 *    matters."
 *
 *   "semantic_param_digest excludes non-semantic fields — timestamps, request ids, retry
 *    counters — so a functionally identical retry produces an identical key, while a
 *    genuinely different refund amount produces a different one."
 *
 * `24 §3` K4's invariant row, verbatim:
 *
 *   "Idempotency key is a deterministic function of (task_id, action_class, resource_id,
 *    semantic_parameter_digest) computed by the kernel over the canonicalised parameters —
 *    never a random UUID, and never including journal_seq, which is allocated after the key
 *    is computed (30 §5.2, SR-A4)."
 *
 * Registry `I42`'s test column, verbatim:
 *
 *   "v1.2: assert journal_seq is not an input to the key, so a serialisation-failure retry
 *    regenerates the same key (SR-A4)."
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS MODULE CANNOT REACH
 *
 * `rationale` is not an input and cannot be made one without a type change: its type is
 * `OpaqueRationale`, which no function here accepts. There is no clock read, no random
 * source, and no journal-sequence read anywhere in this file — asserted, not merely
 * intended, by tests/canonicalisation/idempotency-key.test.ts which reads this source.
 *
 * NOT implemented in S1B: dispatch, the outbox claim (`25 §7` layer 4), duplicate-send
 * reconciliation, and `I42`'s database unique constraint.
 * ---------------------------------------------------------------------------------
 */

/**
 * `semantic_param_digest` for `refund.create`, over the CANONICALISED computed parameters.
 *
 * Every field is kernel-computed and every field is semantic: a change to any of them is a
 * different refund. Field order is declared here, so the digest cannot move because an
 * object was built differently.
 */
export function refundSemanticParamDigest(parameters: RefundParameters): Buffer {
  return canonicalHash('acos.semantic_param_digest.refund.create.v1', [
    { kind: 'text', value: parameters.lineId },
    { kind: 'text', value: parameters.parentTransactionId },
    { kind: 'money', value: parameters.amount },
    { kind: 'text', value: parameters.instrument },
    { kind: 'text', value: parameters.reasonCodeScope },
    { kind: 'text', value: parameters.destinationInstrumentRef },
    { kind: 'text', value: parameters.currency },
  ]);
}

/** `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)`. */
export function computeIdempotencyKey(
  taskId: string,
  actionClass: ActionClass,
  resourceId: string,
  semanticParamDigest: Buffer,
): string {
  return hex(
    hashConcat('acos.effect_idempotency_key.v1', [
      taskId,
      actionClass,
      resourceId,
      semanticParamDigest,
    ]),
  );
}
