import { describe, expect, it } from 'vitest';

import { normaliseAuthenticatedBatch } from '../../src/audit/providerEvidence/eventPayload.js';
import { bodyOf, correlationTag, processedEvent } from '../support/providerEvidenceFixture.js';

/**
 * ADR-027 decision 4 — A VALID SIGNATURE AUTHENTICATES THE BATCH; IT DOES NOT MAKE MALFORMED DATA
 * USABLE. The whole batch is COMPLETE, or it is INCOMPLETE and yields no event at all.
 */

const ACCEPTED = ['processed'] as const;

function normalise(events: unknown) {
  return normaliseAuthenticatedBatch(
    Buffer.from(`${JSON.stringify(events)}\r\n`, 'utf8'),
    ACCEPTED,
  );
}

function reasonOf(events: unknown): string {
  const batch = normalise(events);
  return batch.status === 'COMPLETE' ? 'COMPLETE' : batch.reason;
}

describe('the accepted `processed` event', () => {
  it('a valid processed event is normalised to EXACTLY five operands', () => {
    const tag = correlationTag();
    const event = processedEvent(tag, { sg_event_id: 'evt-1', sg_message_id: 'msg-1' });
    const batch = normaliseAuthenticatedBatch(bodyOf([event]), ACCEPTED);
    expect(batch.status).toBe('COMPLETE');
    if (batch.status !== 'COMPLETE') return;
    expect(batch.acceptedEvents).toEqual([
      {
        sgEventId: 'evt-1',
        sgMessageId: 'msg-1',
        eventClass: 'processed',
        correlationTag: tag,
        providerEventTimestamp: 1_760_000_000,
      },
    ]);
    // DATA MINIMISATION: nothing else the provider sent survives normalisation.
    const serialised = JSON.stringify(batch);
    for (const leaked of ['email', 'sink-owner@example.test', 'smtp-id', 'category']) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it('the CUSTOM ARGUMENT is the correlation source; the category is never read', () => {
    const tag = correlationTag();
    const other = correlationTag();
    const event = processedEvent(tag, { category: [other] });
    const batch = normalise([event]);
    expect(batch.status === 'COMPLETE' && batch.acceptedEvents[0]!.correlationTag).toBe(tag);
    // A processed event carrying the tag ONLY as a category is not normalisable.
    const categoryOnly = processedEvent(tag);
    delete categoryOnly.acos_correlation_tag;
    expect(reasonOf([categoryOnly])).toBe('ACCEPTED_EVENT_CORRELATION_INVALID');
  });

  it.each([
    ['missing sg_event_id', { sg_event_id: undefined }, 'ACCEPTED_EVENT_IDENTITY_INVALID'],
    ['empty sg_event_id', { sg_event_id: '' }, 'ACCEPTED_EVENT_IDENTITY_INVALID'],
    ['numeric sg_event_id', { sg_event_id: 7 }, 'ACCEPTED_EVENT_IDENTITY_INVALID'],
    ['missing sg_message_id', { sg_message_id: undefined }, 'ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID'],
    ['spaced sg_message_id', { sg_message_id: 'a b' }, 'ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID'],
    ['missing timestamp', { timestamp: undefined }, 'ACCEPTED_EVENT_TIMESTAMP_INVALID'],
    ['string timestamp', { timestamp: '1760000000' }, 'ACCEPTED_EVENT_TIMESTAMP_INVALID'],
    ['fractional timestamp', { timestamp: 1.5 }, 'ACCEPTED_EVENT_TIMESTAMP_INVALID'],
    ['zero timestamp', { timestamp: 0 }, 'ACCEPTED_EVENT_TIMESTAMP_INVALID'],
    ['missing correlation', { acos_correlation_tag: undefined }, 'ACCEPTED_EVENT_CORRELATION_INVALID'],
    ['email as correlation', { acos_correlation_tag: 'owner@example.test' }, 'ACCEPTED_EVENT_CORRELATION_INVALID'],
    ['non-v4 correlation', { acos_correlation_tag: 'acos-corr-00000000-0000-1000-8000-000000000000' }, 'ACCEPTED_EVENT_CORRELATION_INVALID'],
  ])('%s makes the observation INCOMPLETE', (_label, override, reason) => {
    expect(reasonOf([processedEvent(correlationTag(), override)])).toBe(reason);
  });
});

describe('the batch, as a whole', () => {
  it('the body must be a JSON ARRAY — an object or scalar is never silently wrapped', () => {
    expect(reasonOf(processedEvent(correlationTag()))).toBe('BODY_NOT_ARRAY');
    expect(reasonOf('processed')).toBe('BODY_NOT_ARRAY');
    expect(normaliseAuthenticatedBatch(Buffer.from('{not json', 'utf8'), ACCEPTED)).toMatchObject({
      status: 'INCOMPLETE',
      reason: 'BODY_NOT_JSON',
    });
    expect(normaliseAuthenticatedBatch(Buffer.from([0xff, 0xfe, 0x5b]), ACCEPTED)).toMatchObject({
      status: 'INCOMPLETE',
      reason: 'BODY_NOT_JSON',
    });
  });

  it('an element that is not an object, or whose type cannot be established, is INCOMPLETE', () => {
    expect(reasonOf([processedEvent(correlationTag()), 'x'])).toBe('ELEMENT_NOT_OBJECT');
    expect(reasonOf([processedEvent(correlationTag(), { event: 7 })])).toBe('EVENT_TYPE_UNESTABLISHED');
    expect(reasonOf([processedEvent(correlationTag(), { event: 'Processed' })])).toBe(
      'EVENT_TYPE_UNESTABLISHED',
    );
    expect(reasonOf([{ sg_event_id: 'x' }])).toBe('EVENT_TYPE_UNESTABLISHED');
  });

  it('a clearly valid NON-accepted event type is ignored for counting, and the batch stays COMPLETE', () => {
    const tag = correlationTag();
    const batch = normalise([
      processedEvent(tag),
      { event: 'delivered', sg_event_id: 'd-1', sg_message_id: 'm', timestamp: 1, email: 'x@example.test' },
      { event: 'open' },
    ]);
    expect(batch.status).toBe('COMPLETE');
    if (batch.status !== 'COMPLETE') return;
    expect(batch.elementCount).toBe(3);
    expect(batch.acceptedEvents).toHaveLength(1);
  });

  it('A MALFORMED SECOND PROCESSED EVENT MAKES THE WHOLE OBSERVATION INCOMPLETE — the readable sibling is NOT returned', () => {
    const tag = correlationTag();
    const batch = normalise([processedEvent(tag), processedEvent(tag, { sg_message_id: undefined })]);
    expect(batch).toEqual({
      status: 'INCOMPLETE',
      reason: 'ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID',
      elementCount: 2,
      acceptedClassEventCount: 2,
    });
    expect('acceptedEvents' in batch).toBe(false);
  });

  it('one event identity twice in one batch: identical collapses, different is INCOMPLETE', () => {
    const tag = correlationTag();
    const event = processedEvent(tag, { sg_event_id: 'evt-dup' });
    const same = normalise([event, { ...event }]);
    expect(same.status === 'COMPLETE' && same.acceptedEvents).toHaveLength(1);
    expect(reasonOf([event, { ...event, sg_message_id: 'other' }])).toBe(
      'EVENT_IDENTITY_REPEATED_IN_BATCH',
    );
  });

  it('an empty array is a COMPLETE observation of nothing — evidence of no message, never of none sent', () => {
    expect(normalise([])).toEqual({ status: 'COMPLETE', elementCount: 0, acceptedEvents: [] });
  });
});
