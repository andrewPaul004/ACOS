import { describe, expect, it } from 'vitest';

import { ADAPTER_RESOLUTION_CAPABILITIES } from '../../src/kernel/gateway/adapterPort.js';
import {
  CORRELATION_TAG_PREFIX,
  isCorrelationTag,
  mintCorrelationTag,
} from '../../src/kernel/outbox/correlationTag.js';
import {
  EM6_PRIMITIVES,
  OBSERVATION_BASES,
  POSTMARK_CAPABILITY_RECORD,
  RETRIEVED_ON,
  em6Qualifies,
} from '../../tools/postmark-sandbox/capabilityRecord.js';
import { unsafeCapabilityRecord } from '../negative-controls/unsafe-postmark-sandbox-gate.js';

/**
 * `§14`, `§36`, `§47` — THE PROVIDER CAPABILITY RECORD, AS EVIDENCE RATHER THAN AS A CLAIM.
 *
 * =================================================================================
 * THE ONE PROPERTY THIS FILE EXISTS TO PIN
 *
 * `36 §7` / `I26`: "A compromised adapter must produce a well-formed VENDOR RESPONSE, not a
 * well-formed ACOS FACT." The capability record is the closest thing in this slice to a
 * vendor speaking, so the assertions below are about what it MAY NOT say: it may not claim a
 * primitive it also declares absent, it may not claim an observation basis it did not have,
 * and it may not silently disagree with `25 §7`'s own vocabulary.
 * =================================================================================
 */

const RECORD = POSTMARK_CAPABILITY_RECORD;

describe('§14 — the EM6 vocabulary is the architecture’s, transcribed twice and agreeing', () => {
  it('the record’s primitives are exactly `25 §7`’s three, in the port’s own order', () => {
    // TWO INDEPENDENT TRANSCRIPTIONS OF ONE PRINTED SENTENCE. The record does not import the
    // port’s constant, so agreement is asserted here rather than guaranteed by construction —
    // the same discipline `tests/release/release-boundaries.test.ts` applies to `50 §6`.
    expect([...EM6_PRIMITIVES]).toEqual([...ADAPTER_RESOLUTION_CAPABILITIES]);
  });

  it('the record answers every primitive, and none outside the closed set', () => {
    expect(Object.keys(RECORD.em6).sort()).toEqual([...EM6_PRIMITIVES].sort());
  });

  it('it nominates a qualifying primitive that it also declares PRESENT', () => {
    expect(EM6_PRIMITIVES).toContain(RECORD.qualifyingPrimitive);
    expect(RECORD.em6[RECORD.qualifyingPrimitive]).toBe(true);
    expect(em6Qualifies(RECORD)).toBe(true);
  });

  it('and the nominated primitive is the QUERYABLE MESSAGE LOG, not an idempotency header', () => {
    /*
     * `§14`: "Do NOT claim native idempotency if Postmark does not provide a documented
     * idempotency key. The architecture does not require native provider idempotency if ACOS
     * has another qualifying query/reconciliation primitive. State which exact primitive
     * qualifies Postmark."
     */
    expect(RECORD.qualifyingPrimitive).toBe('QUERYABLE_MESSAGE_LOG');
    expect(RECORD.em6.IDEMPOTENCY_HEADER).toBe(false);
  });

  it('the rule is not vacuous — a record claiming idempotency still "qualifies", which is the defect', () => {
    /*
     * The unsafe record passes `em6Qualifies` exactly as the real one does, and that is the
     * point: the disqualifier in `25 §7` is a DISJUNCTION, so claiming a fourth true value
     * does not change the verdict. What it changes is `25 §7`'s DOWNGRADE rule — "Where the
     * adapter's API offers no idempotency, the effect class is downgraded" — so the damage a
     * false idempotency claim does is downstream of this function, and the discrimination
     * must be on the FIELD rather than on the verdict.
     */
    const unsafe = unsafeCapabilityRecord('NATIVE_IDEMPOTENCY_CLAIMED');
    expect(em6Qualifies(unsafe)).toBe(true);
    expect(unsafe.em6.IDEMPOTENCY_HEADER).toBe(true);
    expect(RECORD.em6.IDEMPOTENCY_HEADER).toBe(false);
    expect(unsafe.qualifyingPrimitive).not.toBe(RECORD.qualifyingPrimitive);
  });

  it('a record nominating a primitive it declares ABSENT does not qualify', () => {
    const contradictory = { ...RECORD, qualifyingPrimitive: 'IDEMPOTENCY_HEADER' as const };
    expect(em6Qualifies(contradictory)).toBe(false);
  });
});

describe('§36, §47 — every row is dated, sourced, and marked as documentation rather than measurement', () => {
  it('no row claims to have been measured against an account, because none was', () => {
    /*
     * `36 §7` requires vendor properties to be measured empirically "rather than trusting the
     * annotation". S1M held no account, so a `MEASURED_AGAINST_ACCOUNT` row here would be the
     * precise thing that section warns about.
     */
    for (const row of RECORD.rows) {
      expect(row.basis, row.capability).toBe('PUBLISHED_DOCUMENTATION');
    }
    expect(RECORD.classificationProof.basis).toBe('PUBLISHED_DOCUMENTATION');
    expect(RECORD.correlation.basis).toBe('PUBLISHED_DOCUMENTATION');
    expect(RECORD.retention.basis).toBe('PUBLISHED_DOCUMENTATION');
    expect(RECORD.credentialScoping.basis).toBe('PUBLISHED_DOCUMENTATION');
    // The other basis EXISTS, so a later slice has somewhere to put a measurement.
    expect(OBSERVATION_BASES).toContain('MEASURED_AGAINST_ACCOUNT');
  });

  it('every row names a published reference, and the record carries a retrieval date', () => {
    for (const row of RECORD.rows) {
      expect(row.reference, row.capability).toMatch(/^https:\/\/postmarkapp\.com\//);
      expect(row.evidence.length, row.capability).toBeGreaterThan(20);
    }
    expect(RECORD.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RECORD.retrievedOn).toBe(RETRIEVED_ON);
  });

  it('it carries NO account identifier, NO server id and NO credential-shaped value', () => {
    /*
     * `§36`: only non-secret capability evidence. `§40`: no customer data, no personal
     * recipient. A placeholder server id would be worse than an absent one, because a reader
     * would take it for evidence.
     */
    const serialised = JSON.stringify(RECORD);
    for (const forbidden of [
      /serverId/i,
      /server_id/i,
      /accountId/i,
      /\btoken\b\s*[:=]/i,
      /[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{12}/,
      /@/,
    ]) {
      expect(serialised, `capability record matches ${String(forbidden)}`).not.toMatch(forbidden);
    }
  });

  it('the record is frozen, so no runtime and no model can edit it', () => {
    expect(Object.isFrozen(RECORD)).toBe(true);
    expect(Object.isFrozen(RECORD.em6)).toBe(true);
    expect(Object.isFrozen(RECORD.rows)).toBe(true);
  });
});

describe('§10 — the ACOS correlation tag FITS the provider field it will be carried in', () => {
  it('the declared metadata key is within the provider’s documented key length', () => {
    expect(RECORD.correlation.providerField).toBe('Metadata');
    expect(RECORD.correlation.key.length).toBeLessThanOrEqual(RECORD.correlation.maxKeyLength);
    // It is a closed key, not a caller-chosen one — `§9`: the model supplies no metadata key.
    expect(RECORD.correlation.key).toBe('acos_correlation_tag');
  });

  it('and a REAL minted ACOS tag fits the documented value length, with room to spare', () => {
    /*
     * `§10`: "Map the EXISTING immutable ACOS correlation tag into a provider-visible field."
     * The tag is `acos-corr-` plus an RFC 4122 v4 UUID, which is 46 characters. The provider
     * documents a value limit of 80. This is the assertion that the mapping is possible at
     * all, made against the tag the accepted S1I minter actually produces rather than against
     * a description of it.
     */
    const tag = mintCorrelationTag();
    expect(isCorrelationTag(tag)).toBe(true);
    expect(tag.startsWith(CORRELATION_TAG_PREFIX)).toBe(true);
    expect(tag.length).toBe(46);
    expect(tag.length).toBeLessThanOrEqual(RECORD.correlation.maxValueLength);
  });

  it('the provider field is searchable, which is what makes it the EM6 query primitive', () => {
    // `§10`: "Do not rely solely on Subject or recipient." The query leg of
    // `QUERYABLE_MESSAGE_LOG` is a metadata filter, so searchability is load-bearing.
    expect(RECORD.correlation.searchable).toBe(true);
    expect(RECORD.correlation.returnedInWebhooks).toBe(true);
  });
});

describe('§7 — the audit-credential limitation is RECORDED rather than engineered away', () => {
  it('the record states that no read-only API credential exists', () => {
    /*
     * `48 §3.6`: the audit plane's vendor credentials are "read-only, separately provisioned,
     * and attempted-write-tested (`36 §13`)". `36 §13`'s replica-read test: "attempt a write
     * against each and assert vendor-side failure." A credential that cannot fail that
     * attempt cannot pass that test.
     */
    expect(RECORD.credentialScoping.readOnlyApiTokenAvailable).toBe(false);
    expect(RECORD.credentialScoping.detail).toMatch(/undivided capability/);
  });

  it('the rule is not vacuous — the unsafe record calls a second send-capable token read-only', () => {
    const unsafe = unsafeCapabilityRecord('SEND_CAPABLE_TOKEN_RECORDED_AS_READ_ONLY');
    expect(unsafe.credentialScoping.readOnlyApiTokenAvailable).toBe(true);
    expect(RECORD.credentialScoping.readOnlyApiTokenAvailable).toBe(false);
  });
});
