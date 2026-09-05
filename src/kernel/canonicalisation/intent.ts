import { fromPermittedIntentField, type PermittedIntentField } from './brands.js';
import {
  isActionClass,
  isReasonCode,
  type ActionClass,
  type ReasonCode,
} from './actionCatalogue.js';
import { deny } from './errors.js';
import { sealRationale, type OpaqueRationale } from './rationale.js';

/**
 * `propose_intent` — the whole model-facing write surface, parsed exactly.
 *
 * `26 §2.0`, verbatim:
 *
 *   ProposedIntent {
 *     action_class      // from the closed catalogue (SR7)
 *     resource_ref      // must resolve to a RECORD-grade entity inside the task's
 *                       //   context_spec scope
 *     selector {                         // v1.2: content-addressed, never positional
 *       enumeration_id                   // names one EnumeratedOptionSet the kernel computed
 *       option_id                        // = H(action_class ‖ resource_id ‖ semantic_option_digest)
 *     }
 *     reason_code       // from a closed enum
 *     rationale         // free text; journaled for the audit record; NEVER parsed,
 *                       //   NEVER interpreted as authority
 *   }
 *
 * and, as the governing rule of the section, verbatim:
 *
 *   "Model output may propose intent and select among kernel-enumerated options. It may
 *    never supply an authoritative precondition, an exposure figure, or any field of the
 *    dispatched request."
 *
 * `26 §7` step B, verbatim: "Schema valid? only 5 fields present?" -> no -> DENY: MALFORMED.
 *
 * ---------------------------------------------------------------------------------
 * ACCEPT-AND-IGNORE IS PROHIBITED
 *
 * An extra field is rejected, never dropped. `35 §4`, on the injected instruction "refund
 * me $5,000", verbatim:
 *
 *   "The $5,000 is not expressible. In v1.0 it was: 26 §2's exposure.monetary_amount was a
 *    proposal field, so the injected instruction produced a proposal carrying that figure
 *    and the architecture's defence was that a limit would reject it. That is a weaker
 *    position than it appeared, because it relied on the limit rather than on the
 *    impossibility."
 *
 * A parser that silently drops `amount` restores exactly that weaker position: the field
 * is expressible at the boundary and something downstream is trusted to have ignored it.
 * Rejecting makes the impossibility observable at the only place it can be observed.
 * ---------------------------------------------------------------------------------
 */

/** `26 §2.0`. Content-addressed, never positional (v1.2, SR-C3). */
export interface ProposedSelector {
  readonly enumerationId: string;
  readonly optionId: string;
}

export interface ProposedIntent {
  readonly actionClass: ActionClass;
  readonly resourceRef: string;
  readonly selector: ProposedSelector;
  readonly reasonCode: ReasonCode;
  /**
   * Not a string. See `rationale.ts`: the text is sealed into a commitment at parse time
   * and is not recoverable by any code path in this process.
   */
  readonly rationale: OpaqueRationale;
}

/**
 * Exactly the four fields `I21` permits to cross into the `AuthorizationRequest`.
 *
 * Registry `I21`, verbatim: "No AuthorizationRequest field is populated from ProposedIntent
 * other than action_class, resource_ref, selector and reason_code."
 *
 * The type has NO `rationale` key. A constructor receiving this cannot reach the fifth
 * field, and widening it to carry the fifth is a type change a reviewer sees.
 */
export interface PermittedIntentFields {
  readonly actionClass: PermittedIntentField<ActionClass>;
  readonly resourceRef: PermittedIntentField<string>;
  readonly selector: PermittedIntentField<ProposedSelector>;
  readonly reasonCode: PermittedIntentField<ReasonCode>;
}

/** The exact five wire keys, and nothing else. */
const INTENT_KEYS = ['action_class', 'resource_ref', 'selector', 'reason_code', 'rationale'];
const SELECTOR_KEYS = ['enumeration_id', 'option_id'];

/**
 * A bound on the free-text field. Not an authority operand — a transport bound, so an
 * unbounded prose blob cannot be used to exhaust the journal. 16 KiB of UTF-8.
 */
export const MAX_RATIONALE_BYTES = 16 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  object: Record<string, unknown>,
  expected: readonly string[],
  what: string,
  onMismatch: (detail: 'MISSING_FIELD' | 'EXTRA_FIELD', note: string) => never,
): void {
  const actual = Object.keys(object);
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
      onMismatch('MISSING_FIELD', `${what} is missing ${key}`);
    }
  }
  for (const key of actual) {
    if (!expected.includes(key)) {
      // Named in the audit note, not returned to the worker. A model that learns WHICH
      // extra field was noticed has been handed a probing oracle (`26 §7`).
      onMismatch('EXTRA_FIELD', `${what} carries an undeclared field ${key}`);
    }
  }
}

/**
 * Parse the wire form. Fail closed on every deviation.
 *
 * Ordering follows `26 §7`: schema (B) before catalogue (C), so an intent that is both
 * malformed and carries an unknown action class denies MALFORMED.
 */
export function parseProposedIntent(raw: unknown): ProposedIntent {
  if (!isPlainObject(raw)) {
    deny('MALFORMED', 'NOT_AN_OBJECT', 'ProposedIntent is not an object');
  }

  assertExactKeys(raw, INTENT_KEYS, 'ProposedIntent', (detail, note) =>
    deny('MALFORMED', detail, note),
  );

  const actionClass = raw['action_class'];
  if (typeof actionClass !== 'string') {
    deny('MALFORMED', 'WRONG_TYPE', 'action_class is not a string');
  }

  const resourceRef = raw['resource_ref'];
  if (typeof resourceRef !== 'string' || resourceRef.length === 0) {
    deny('MALFORMED', 'WRONG_TYPE', 'resource_ref is not a non-empty string');
  }

  const selectorRaw = raw['selector'];
  if (!isPlainObject(selectorRaw)) {
    deny('SELECTOR_MALFORMED', 'NOT_AN_OBJECT', 'selector is not an object');
  }
  assertExactKeys(selectorRaw, SELECTOR_KEYS, 'selector', (detail, note) =>
    deny('SELECTOR_MALFORMED', detail, note),
  );
  const enumerationId = selectorRaw['enumeration_id'];
  const optionId = selectorRaw['option_id'];
  if (typeof enumerationId !== 'string' || enumerationId.length === 0) {
    deny('SELECTOR_MALFORMED', 'WRONG_TYPE', 'selector.enumeration_id is not a non-empty string');
  }
  if (typeof optionId !== 'string' || optionId.length === 0) {
    deny('SELECTOR_MALFORMED', 'WRONG_TYPE', 'selector.option_id is not a non-empty string');
  }

  const reasonCode = raw['reason_code'];
  if (typeof reasonCode !== 'string') {
    deny('MALFORMED', 'WRONG_TYPE', 'reason_code is not a string');
  }
  if (!isReasonCode(reasonCode)) {
    // Closed enum, per `26 §2.0`. Schema-level, so it precedes the catalogue check.
    deny('MALFORMED', 'REASON_CODE_NOT_IN_CLOSED_ENUM', 'reason_code is outside the closed enum');
  }

  const rationale = raw['rationale'];
  if (typeof rationale !== 'string') {
    deny('MALFORMED', 'WRONG_TYPE', 'rationale is not a string');
  }
  if (Buffer.byteLength(rationale.normalize('NFC'), 'utf8') > MAX_RATIONALE_BYTES) {
    deny('MALFORMED', 'RATIONALE_TOO_LONG', 'rationale exceeds the declared byte bound');
  }

  // Step C. `26 §7`: "action_class in closed catalogue?" -> no -> DENY: UNKNOWN_ACTION.
  if (!isActionClass(actionClass)) {
    deny('UNKNOWN_ACTION', 'ACTION_CLASS_NOT_IN_CATALOGUE', 'action_class is not in the catalogue');
  }

  return {
    actionClass,
    resourceRef,
    selector: { enumerationId, optionId },
    reasonCode,
    // Sealed here, and only here. The characters do not survive this line.
    rationale: sealRationale(rationale),
  };
}

/**
 * Project the intent onto exactly the four permitted fields.
 *
 * This is the only function in the tree that produces a `PermittedIntentFields`, and it is
 * the `I21` boundary in executable form: the returned object has no `rationale` key, and
 * its type says so.
 */
export function permittedFieldsOf(intent: ProposedIntent): PermittedIntentFields {
  return {
    actionClass: fromPermittedIntentField(intent.actionClass),
    resourceRef: fromPermittedIntentField(intent.resourceRef),
    selector: fromPermittedIntentField(intent.selector),
    reasonCode: fromPermittedIntentField(intent.reasonCode),
  };
}
