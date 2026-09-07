import type { CanonicalEffect } from '../canonicalisation/types.js';

/**
 * Runtime immutability for the canonical effect, for the span S1E carries it across.
 *
 * ---------------------------------------------------------------------------------
 * WHY `readonly` WAS SUFFICIENT AT S1B AND IS NOT AT S1E
 *
 * `authorise.ts`, the accepted S1D file, states the problem in its own words: "TypeScript's
 * `readonly` prevents the assignment at compile time and prevents nothing at runtime, so the
 * honest defence is to remove the gap rather than to document it." S1D removed the gap by
 * making C′ and step M one call with no caller-visible object between them.
 *
 * S1E cannot use that device, because the effect now has to survive eleven more gates, two
 * of which read its exposure and its catalogue-derived attributes. The object exists, in a
 * local, across `await` points at which other code runs. So S1E freezes it.
 *
 * The freeze is DEEP and it covers every nested authority operand: the exposure block, the
 * cost components, the parameters, the selected option, the principal, the resource, the
 * counterparty and the window and evidence ref arrays. A shallow freeze would leave
 * `request.exposure.totalExposure` writable, which is the one field the whole model bounds.
 *
 * `Money` is a `bigint` and `Date` is frozen as an object without freezing its internal
 * slots — `Date.prototype.setTime` still mutates a frozen Date. The two `Date`s S1E's
 * authority operands reach are `enumerationRef.computedAt` and nothing else, and it is not an
 * authority operand at any S1E gate; the assertion the mutation test makes is about the
 * operands the gates actually read.
 * ---------------------------------------------------------------------------------
 */

/**
 * Freeze `value` and everything reachable from it, in place, and return it.
 *
 * Cycles are handled by the `Object.isFrozen` check: a frozen object is not revisited.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  // `Object.getOwnPropertyNames` rather than an indexed read through a generic record type.
  // The authority tree carries no `Record<string, unknown>` anywhere, declared or asserted —
  // `tests/authority/authority-channel-attacks.test.ts` rule 1 — and a freeze helper is not a
  // good reason to make the one exception, because an exception is what a later reader
  // widens.
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return value;
}

/**
 * Freeze a canonical effect and both of its halves.
 *
 * Applied by `preReservation.ts` immediately after C′ returns, BEFORE the first authority
 * gate runs, so every gate in the sequence reads an object that cannot have changed since it
 * was constructed. `26 §7`'s C′ row is the reason: "**Everything downstream of C′ evaluates
 * kernel-computed operands only.**" An operand a later component could overwrite is not the
 * operand C′ computed.
 */
export function freezeCanonicalEffect(effect: CanonicalEffect): CanonicalEffect {
  deepFreeze(effect.request);
  deepFreeze(effect.dispatchPayload);
  return deepFreeze(effect);
}
