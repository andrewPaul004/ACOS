import { randomUUID } from 'node:crypto';

/**
 * The provider-visible correlation identity.
 *
 * =================================================================================
 * `25 §7`, verbatim: one outbox row per intended message, "carrying a **provider-visible
 * correlation tag** (custom header, metadata or tag)".
 *
 * `34` ADR-026 decision item 1, verbatim: "carrying a unique **correlation tag in a
 * provider-visible field** (custom header, metadata, tag)".
 *
 * ADR-026 decision item 4 is what the tag is FOR: "Delivery-event reconciliation **on the
 * correlation tag** resolves `PRESUMED_EXECUTED` to `VERIFIED` or `NEVER_SENT`."
 * `35 §4`: the provider's delivery event is "matched on the correlation tag".
 * =================================================================================
 *
 * =================================================================================
 * WHY RANDOM IS CORRECT HERE, AND WHY IT WOULD BE WRONG ONE FIELD OVER — `§43`.
 *
 * `§43` of the S1I mandate draws the line precisely: "The outbox/effect identity and
 * exclusive claim identity must not be derived from journal_seq, retry attempt, timestamp,
 * process ID or random retry UUID [...] Correlation tag may be unique/random if
 * architecture permits, but must be persisted once and reused."
 *
 * THE SEMANTIC EFFECT IDENTITY IS `25 §7`'s DETERMINISTIC KEY and it is not this value.
 * `25 §7`: "The effect key is deterministic, not random. This is the whole point. A crash
 * between journaling and adapter invocation, followed by a restart, must regenerate the
 * SAME key [...] A UUID minted at attempt time provides no protection against exactly the
 * failure that matters." That key is `H(task_id ‖ action_class ‖ resource_id ‖
 * semantic_param_digest)`, it is computed by the accepted S1B/S1F path, it is the outbox's
 * PRIMARY KEY, and nothing in this file participates in it.
 *
 * The correlation tag answers a different question — "which of my intended effects is this
 * provider event about?" — and the architecture requires only that it be UNIQUE and
 * provider-visible. A deterministic tag would additionally leak the effect's semantics into
 * a vendor-visible field, which is a worse property, and it would buy nothing: the tag is
 * generated ONCE and persisted with the row, so a restart reuses the stored value rather
 * than regenerating anything.
 *
 * THE PERSISTENCE IS WHAT MAKES IT SAFE, AND IT IS ENFORCED IN THE DATABASE. The tag is
 * written at enqueue, `dispatch_outbox_correlation_tag_unique` makes it unique across the
 * store, and `dispatch_outbox_state_machine` refuses any UPDATE that moves it — including
 * the claim transition. So "persisted once and reused" is not a convention of this module;
 * it is a property of the schema. A retry of the enqueue for an already-enqueued identity
 * returns `ALREADY_ENQUEUED` and the FIRST tag, so a retry never mints a second one.
 * =================================================================================
 *
 * =================================================================================
 * WHAT THIS MODULE IS NOT.
 *
 * It does not name a provider field. `§11` of the mandate: "Do not invent vendor-specific
 * headers. S1I stores the correlation value. Future adapters determine how to place it in
 * a provider-visible field." There is no header name, no metadata key and no tag namespace
 * anywhere in `src/kernel/outbox/`, and the outbox table carries no column for one.
 *
 * It takes no parameter. A `correlationTag` argument on `enqueueDispatch` would be exactly
 * `§11`'s "caller cannot override it" defect, so the value is minted here and the enqueue
 * API has no field a caller could put one in — which is a type-level property and is
 * asserted as one in `tests/type-negative/`.
 * =================================================================================
 */

/**
 * The tag's declared prefix. Present so a value found in a future provider log is
 * recognisable as an ACOS correlation tag rather than as an opaque UUID, and so the format
 * is one declared thing rather than an implicit convention.
 */
export const CORRELATION_TAG_PREFIX = 'acos-corr-';

/**
 * Mint one correlation tag.
 *
 * `node:crypto`'s `randomUUID` is a CSPRNG-backed RFC 4122 v4 value. Uniqueness is
 * ENFORCED by the unique index rather than assumed from the generator: `§11` of the mandate
 * requires collision handling, and the handling is that a colliding INSERT fails and the
 * enqueue's own retry mints a fresh tag — which `outbox-enqueue.test.ts` drives directly
 * by seeding a colliding value rather than by waiting 2^61 draws for one.
 */
export function mintCorrelationTag(): string {
  return `${CORRELATION_TAG_PREFIX}${randomUUID()}`;
}

/** Whether a string is shaped like a tag this kernel minted. Used by the schema tests. */
export function isCorrelationTag(value: string): boolean {
  return (
    value.startsWith(CORRELATION_TAG_PREFIX) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.slice(CORRELATION_TAG_PREFIX.length),
    )
  );
}
