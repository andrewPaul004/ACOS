import { canonicalHash, hex } from './canonicalBytes.js';
import type { ProposedIntent } from './intent.js';
import { rationaleCommitment } from './rationale.js';

/**
 * `intent_hash` — the full-intent lineage commitment.
 *
 * `26 §2.1`, as a field of `AuthorizationRequest`, verbatim:
 *
 *   "intent_hash          // hash of the ProposedIntent, for lineage"
 *
 * ---------------------------------------------------------------------------------
 * THE ONE PLACE `rationale` IS ADMITTED, AND WHY IT IS NOT AN `I21` BREACH
 *
 * Registry `I21`, verbatim: "No AuthorizationRequest field is populated from ProposedIntent
 * other than action_class, resource_ref, selector and reason_code." Read at maximum
 * literalness that is in tension with `intent_hash`, which is a hash OF the ProposedIntent
 * and the ProposedIntent contains `rationale`.
 *
 * The owner clarification (docs/implementation/S1B-owner-clarifications.md S1B-C1) resolves
 * it: rationale may participate ONLY in an opaque lineage/audit commitment such as this
 * one. It may not affect parameters, exposure, the selected effect, the counterparty,
 * recoverability, value direction, the dispatch payload, the idempotency key, any policy
 * operand or the constructor version.
 *
 * So:
 *   changing only rationale MAY change this hash — and in this implementation it does;
 *   changing only rationale MUST leave every economic/dispatch/authority output
 *     byte-identical.
 *
 * `I21`'s property is that no AUTHORITY-BEARING field takes a value the model chose. A
 * one-way commitment to what the model submitted is the opposite of that: it is what makes
 * the submission auditable. The commitment is a 32-byte digest, so it is not comparable
 * for meaning and is not an operand anything can branch on.
 *
 * This module is one of exactly two in `src/` permitted to name `rationale`; the other is
 * `intent.ts`, which seals it. `tests/canonicalisation/no-rationale-parser.test.ts` reads
 * the source tree and fails if a third appears.
 * ---------------------------------------------------------------------------------
 */
export function intentHash(intent: ProposedIntent): string {
  return hex(
    canonicalHash('acos.lineage.intent.v1', [
      { kind: 'text', value: intent.actionClass },
      { kind: 'text', value: intent.resourceRef },
      { kind: 'text', value: intent.selector.enumerationId },
      { kind: 'text', value: intent.selector.optionId },
      { kind: 'text', value: intent.reasonCode },
      // Opaque. A digest of a digest; nothing here can read prose.
      { kind: 'bytes', value: rationaleCommitment(intent.rationale) },
    ]),
  );
}
