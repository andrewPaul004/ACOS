/**
 * THE AUTHENTICATED BODY, NORMALISED — AND ONLY AFTER IT AUTHENTICATED.
 *
 * =================================================================================
 * WHAT MAY CALL THIS
 *
 * The receiver, after `verifySendGridEventWebhookV1` returned `verified: true` for these exact
 * octets. ADR-027 decision 4: "**only after successful verification may the body be parsed**".
 * Nothing in this module verifies anything, and nothing in it is reachable from the request
 * path before verification — `receiver.ts` is the only caller and it calls this on the
 * verified branch only.
 *
 * =================================================================================
 * A VALID SIGNATURE AUTHENTICATES THE BATCH; IT DOES NOT MAKE MALFORMED DATA USABLE
 *
 * ADR-027 decision 4: "**A valid signature over malformed evidence does not create an
 * accepted-count operand**". And: "If a signed batch carries an accepted-class event that
 * cannot be normalised to event identity, message identity, timestamp and correlation, **the
 * observation is INCOMPLETE/UNRESOLVED**. An unreadable second event is never allowed to vanish
 * while its readable sibling becomes a trusted count of one."
 *
 * So the outcome is ONE of two shapes for the WHOLE batch:
 *
 *   COMPLETE     every element is an object with an established event type; every
 *                accepted-class element carries all four operands. Its accepted events are
 *                returned. Non-accepted event types are counted and dropped.
 *   INCOMPLETE   the first reason the batch cannot be fully read, as a closed code. NO event
 *                is returned — not the readable siblings, not a partial list.
 *
 * =================================================================================
 * DATA MINIMISATION IS A PROPERTY OF THE RETURN TYPE
 *
 * `NormalisedAcceptedEvent` has five members and none of them can carry an email address, a
 * subject, a body, an arbitrary custom argument or arbitrary provider JSON. Everything the
 * provider sent that is not one of those five operands is discarded here, in memory, and
 * reaches no store and no log.
 *
 * The correlation operand is the CUSTOM ARGUMENT `acos_correlation_tag` (ADR-027 decision 4a,
 * "**Under push evidence the CUSTOM ARGUMENT is authoritative**"). The category the adapter
 * also emits is NOT read: a category is a flat label an account may use for its own purposes.
 * =================================================================================
 */

/** `requestMapping.ts`'s custom-argument key, transcribed. The existing key; not renamed. */
export const CORRELATION_CUSTOM_ARGUMENT = 'acos_correlation_tag';

/**
 * The kernel's correlation-tag shape, TRANSCRIBED rather than imported: this plane imports
 * nothing from `src/kernel/`. `acos-corr-` and an RFC 4122 v4 UUID — an opaque identifier with
 * no room for personal data.
 */
const CORRELATION_TAG = /^acos-corr-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A provider identity: printable ASCII, no space, bounded. Never parsed further. */
const PROVIDER_IDENTITY = /^[\x21-\x7e]{1,256}$/;

/** An event-type token. Anything else is an event type that cannot be ESTABLISHED. */
const EVENT_TYPE = /^[a-z][a-z_]{0,63}$/;

/** The closed incompleteness reasons. Each is a migration-checked value in `A0009`. */
export const INCOMPLETE_REASONS = [
  'BODY_NOT_JSON',
  'BODY_NOT_ARRAY',
  'ELEMENT_NOT_OBJECT',
  'EVENT_TYPE_UNESTABLISHED',
  'ACCEPTED_EVENT_IDENTITY_INVALID',
  'ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID',
  'ACCEPTED_EVENT_TIMESTAMP_INVALID',
  'ACCEPTED_EVENT_CORRELATION_INVALID',
  'EVENT_IDENTITY_REPEATED_IN_BATCH',
  'EVENT_IDENTITY_INCONSISTENT',
] as const;

export type IncompleteReason = (typeof INCOMPLETE_REASONS)[number];

/** One accepted-class event, reduced to exactly the operands the architecture names. */
export interface NormalisedAcceptedEvent {
  readonly sgEventId: string;
  readonly sgMessageId: string;
  readonly eventClass: string;
  readonly correlationTag: string;
  /** The provider's own event timestamp, Unix seconds. */
  readonly providerEventTimestamp: number;
}

export type NormalisedBatch =
  | {
      readonly status: 'COMPLETE';
      readonly elementCount: number;
      readonly acceptedEvents: readonly NormalisedAcceptedEvent[];
    }
  | {
      readonly status: 'INCOMPLETE';
      readonly reason: IncompleteReason;
      readonly elementCount: number;
      readonly acceptedClassEventCount: number;
    };

function incomplete(
  reason: IncompleteReason,
  elementCount: number,
  acceptedClassEventCount: number,
): NormalisedBatch {
  return Object.freeze({ status: 'INCOMPLETE' as const, reason, elementCount, acceptedClassEventCount });
}

function sameEvent(a: NormalisedAcceptedEvent, b: NormalisedAcceptedEvent): boolean {
  return (
    a.sgMessageId === b.sgMessageId &&
    a.eventClass === b.eventClass &&
    a.correlationTag === b.correlationTag &&
    a.providerEventTimestamp === b.providerEventTimestamp
  );
}

/**
 * Normalise ONE authenticated body. The whole array is examined; the first defect decides.
 *
 * `acceptedEventClasses` is the signed class-28 field 7 — an event outside it is "**not
 * evidence**, whatever its signature", and is counted as an element and otherwise dropped.
 */
export function normaliseAuthenticatedBatch(
  rawBody: Buffer,
  acceptedEventClasses: readonly string[],
): NormalisedBatch {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  } catch {
    return incomplete('BODY_NOT_JSON', 0, 0);
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return incomplete('BODY_NOT_JSON', 0, 0);
  }
  // A scalar or an object is NOT silently wrapped into a one-element array.
  if (!Array.isArray(document)) return incomplete('BODY_NOT_ARRAY', 0, 0);

  const elements = document as unknown[];
  const accepted: NormalisedAcceptedEvent[] = [];
  const byEventId = new Map<string, NormalisedAcceptedEvent>();
  let acceptedClassCount = 0;
  let firstDefect: IncompleteReason | null = null;

  for (const element of elements) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) {
      firstDefect ??= 'ELEMENT_NOT_OBJECT';
      continue;
    }
    const record = element as Record<string, unknown>;
    const eventType = record.event;
    if (typeof eventType !== 'string' || !EVENT_TYPE.test(eventType)) {
      // An event whose type cannot itself be established might be an accepted-class event.
      firstDefect ??= 'EVENT_TYPE_UNESTABLISHED';
      continue;
    }
    if (!acceptedEventClasses.includes(eventType)) continue;
    acceptedClassCount += 1;

    const sgEventId = record.sg_event_id;
    if (typeof sgEventId !== 'string' || !PROVIDER_IDENTITY.test(sgEventId)) {
      firstDefect ??= 'ACCEPTED_EVENT_IDENTITY_INVALID';
      continue;
    }
    const sgMessageId = record.sg_message_id;
    if (typeof sgMessageId !== 'string' || !PROVIDER_IDENTITY.test(sgMessageId)) {
      firstDefect ??= 'ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID';
      continue;
    }
    const timestamp = record.timestamp;
    if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
      firstDefect ??= 'ACCEPTED_EVENT_TIMESTAMP_INVALID';
      continue;
    }
    const correlation = record[CORRELATION_CUSTOM_ARGUMENT];
    if (typeof correlation !== 'string' || !CORRELATION_TAG.test(correlation)) {
      firstDefect ??= 'ACCEPTED_EVENT_CORRELATION_INVALID';
      continue;
    }

    const event: NormalisedAcceptedEvent = Object.freeze({
      sgEventId,
      sgMessageId,
      eventClass: eventType,
      correlationTag: correlation,
      providerEventTimestamp: timestamp,
    });
    const earlier = byEventId.get(sgEventId);
    if (earlier !== undefined) {
      // The same event identity twice in ONE batch: identical is one event; different is a
      // provider inconsistency the batch cannot resolve.
      if (!sameEvent(earlier, event)) firstDefect ??= 'EVENT_IDENTITY_REPEATED_IN_BATCH';
      continue;
    }
    byEventId.set(sgEventId, event);
    accepted.push(event);
  }

  if (firstDefect !== null) return incomplete(firstDefect, elements.length, acceptedClassCount);
  return Object.freeze({
    status: 'COMPLETE' as const,
    elementCount: elements.length,
    acceptedEvents: Object.freeze(accepted),
  });
}

/** Whether two normalised events carry the same semantic fields. Exported for the store. */
export function semanticallyEqual(a: NormalisedAcceptedEvent, b: NormalisedAcceptedEvent): boolean {
  return a.sgEventId === b.sgEventId && sameEvent(a, b);
}
