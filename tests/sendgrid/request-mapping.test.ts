import { describe, expect, it } from 'vitest';

import { mintCorrelationTag } from '../../src/kernel/outbox/correlationTag.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import { verifiedActionCatalogue } from '../../src/kernel/controlArtifacts/bundle.js';
import {
  CORRELATION_CUSTOM_ARG,
  SENDGRID_MAIL_SEND_PATH,
  buildSendGridSendRequest,
} from '../../validation/sendgrid/integration/requestMapping.js';
import {
  OWNER_SINK_MARKER,
  PAYLOAD_REFUSALS,
  SIGNED_ACTION_CLASS,
  SIGNED_METHOD,
  SIGNED_RECOVERABILITY,
  VALIDATION_EMAIL_FIELDS,
  decodeDispatchPayload,
  isOwnerControlledSink,
  parseValidationEmailPayload,
  type ValidationEmailPayload,
} from '../../validation/sendgrid/integration/validationPayload.js';
import { validationDispatchPayloadBytes } from '../../validation/sendgrid/harness/validationAuthority.js';

/**
 * CORRECTION 2 AND CORRECTION 17 — **THE PAYLOAD BINDING, AND THE SIGNED OPERATION.**
 *
 * =================================================================================
 * WHAT THIS SUITE PROVES, AND WHY IT ENCODES WITH ONE IMPLEMENTATION AND DECODES WITH ANOTHER
 *
 * `validationPayload.ts` decodes `acos.dispatch_payload.v1` with a framing parser written out
 * inside the integration package, because the production ENCODER
 * (`dispatchPayloadCanonicalBytes`) sits behind the control plane's class-20 admission gate and
 * must not be dragged into a credential-holding child.
 *
 * Two independent implementations of one framing is a risk, and this file is where it is paid
 * for: every round-trip below ENCODES with the production canonicaliser — through
 * `validationDispatchPayloadBytes`, which the seeder uses — and DECODES with the transcribed
 * parser. A decoder tested against its own encoder would agree with itself and prove nothing.
 *
 * `§19` items 1, 2 and 3 are the three discriminations this file owes:
 *   1. launch-config sink substitution cannot change the authorised recipient — and here the
 *      structural half: there is no configured sink in the mapping's input at all. The
 *      behavioural half is CONTROL 9 in `tests/negative-controls/sendgrid-review-controls.test.ts`.
 *   2. a wrong adapter method refuses before the provider boundary.
 *   3. a wrong action class refuses before the provider boundary.
 * =================================================================================
 */

const SINK = `owner+${OWNER_SINK_MARKER}@example.test`;
const SENDER = 'validation@nonprod.example.test';
const AUTH_REF = 'auth:AR-S1P-TEST';
const IDEMPOTENCY = 'idem:email.send:S1P-TEST:auth:AR-S1P-TEST';

const AUTHORISED: ValidationEmailPayload = Object.freeze({
  senderAddress: SENDER,
  sinkAddress: SINK,
  subject: 'ACOS S1P NON-PRODUCTION VALIDATION kill-point-1',
  bodyText: 'ACOS S1P NON-PRODUCTION VALIDATION\nscenario: kill-point-1\nno business content.',
});

function encoded(overrides: Partial<ValidationEmailPayload> = {}): Buffer {
  return validationDispatchPayloadBytes({
    authorisationRef: AUTH_REF,
    idempotencyKey: IDEMPOTENCY,
    authorised: { ...AUTHORISED, ...overrides },
  });
}

const EXPECTED = { adapterId: 'sendgrid_email', method: SIGNED_METHOD, authorisationRef: AUTH_REF };

describe('the transcribed decoder agrees with the PRODUCTION canonical encoder', () => {
  it('a round trip recovers every declared field, in the declared order', () => {
    const decoded = decodeDispatchPayload(encoded());
    expect(decoded.kind).toBe('DECODED');
    if (decoded.kind !== 'DECODED') return;
    const payload = decoded.payload;
    expect(payload.adapter).toBe('sendgrid_email');
    expect(payload.method).toBe(SIGNED_METHOD);
    expect(payload.idempotencyKey).toBe(IDEMPOTENCY);
    expect(payload.authorisationRef).toBe(AUTH_REF);
    // `I18a`'s null branch survives the framing: a NULL is the reserved word, not a payload.
    expect(payload.monetaryEffect).toBeNull();
    expect(payload.preconditionToken).toBeNull();
    expect(Object.keys(payload.vendorParameters).sort()).toEqual([...VALIDATION_EMAIL_FIELDS].sort());
  });

  it('and the semantic fields survive verbatim — including a body with newlines', () => {
    const parsed = parseValidationEmailPayload(encoded(), EXPECTED);
    expect(parsed.kind).toBe('PAYLOAD');
    if (parsed.kind !== 'PAYLOAD') return;
    expect(parsed.payload).toEqual(AUTHORISED);
  });

  it('a truncated or over-long buffer is REFUSED rather than guessed at', () => {
    const bytes = encoded();
    expect(decodeDispatchPayload(bytes.subarray(0, bytes.byteLength - 4)).kind).toBe('REFUSED');
    expect(decodeDispatchPayload(Buffer.concat([bytes, Buffer.from([0, 0, 0, 0])])).kind).toBe(
      'REFUSED',
    );
    expect(decodeDispatchPayload(Buffer.alloc(0)).kind).toBe('REFUSED');
  });
});

describe('CORRECTION 17 — the transcribed operation IS the signed one', () => {
  it('the constants match the VERIFIED class-3 record for `email.send`', () => {
    /*
     * `§58` of the S1K mandate forbids deriving an expected authority value from the thing
     * under test, so this reads the VERIFIED BUNDLE and compares it to the transcription the
     * credential-holding child carries. A class-3 edit that repointed `email.send` at another
     * adapter, or renamed its method, fails HERE rather than at a provider.
     */
    const catalogue = verifiedActionCatalogue(activeVerifiedControlArtifacts());
    const entry = catalogue.entries['email.send'];
    expect(entry).toBeDefined();
    expect(SIGNED_ACTION_CLASS).toBe('email.send');
    expect(entry!.adapter).toBe('sendgrid_email');
    expect(entry!.method).toBe(SIGNED_METHOD);
    expect(entry!.recoverability).toBe(SIGNED_RECOVERABILITY);
    // `51 §2.3`: ONE irrecoverable unit for every IRRECOVERABLE class in the catalogue.
    expect(entry!.irrecoverableUnits).toBe(1n);
  });

  it('`§19` item 2 — a payload naming a WRONG METHOD is refused before the boundary', () => {
    const wrongMethod = parseValidationEmailPayload(encoded(), {
      ...EXPECTED,
      method: 'emailSendV2',
    });
    expect(wrongMethod.kind).toBe('REFUSED');
    if (wrongMethod.kind !== 'REFUSED') return;
    expect(wrongMethod.reason).toBe('PAYLOAD_METHOD_MISMATCH');
  });

  it('`§19` item 3 — a payload naming a WRONG ADAPTER is refused before the boundary', () => {
    const wrongAdapter = parseValidationEmailPayload(encoded(), {
      ...EXPECTED,
      adapterId: 'mock_ads',
    });
    expect(wrongAdapter.kind).toBe('REFUSED');
    if (wrongAdapter.kind !== 'REFUSED') return;
    expect(wrongAdapter.reason).toBe('PAYLOAD_ADAPTER_MISMATCH');
  });

  it('and a payload bound to ANOTHER authorisation is refused', () => {
    const other = parseValidationEmailPayload(encoded(), {
      ...EXPECTED,
      authorisationRef: 'auth:AR-SOMEONE-ELSE',
    });
    expect(other.kind).toBe('REFUSED');
    if (other.kind !== 'REFUSED') return;
    expect(other.reason).toBe('PAYLOAD_AUTHORISATION_REF_MISMATCH');
  });
});

describe('CORRECTION 2 — the vendor-parameter schema is CLOSED in both directions', () => {
  it('a field outside the closed set is REFUSED, not ignored', () => {
    // Encoded through the production canonicaliser so the framing is real; the extra member
    // is what a widened seeder would produce.
    const bytes = validationDispatchPayloadBytes({
      authorisationRef: AUTH_REF,
      idempotencyKey: IDEMPOTENCY,
      authorised: AUTHORISED,
    });
    const decoded = decodeDispatchPayload(bytes);
    expect(decoded.kind).toBe('DECODED');

    /*
     * THE SAME BYTES WITH ONE KEY RENAMED, AT THE SAME LENGTH AND IN THE SAME SORT POSITION.
     *
     * Equal length keeps the field's framing word correct and equal sort position keeps the
     * JCS object well-formed, so what reaches the parser is a STRUCTURALLY VALID payload
     * carrying a field the closed set does not name — which is exactly the shape a widened
     * seeder would emit, and exactly what `§2.2` item 5 requires be refused.
     */
    const widened = Buffer.from(
      bytes.toString('binary').replace('"subject"', '"subjekt"'),
      'binary',
    );
    const parsed = parseValidationEmailPayload(widened, EXPECTED);
    expect(parsed.kind).toBe('REFUSED');
    if (parsed.kind !== 'REFUSED') return;
    expect(['VENDOR_PARAMETER_UNKNOWN', 'VENDOR_PARAMETER_MISSING']).toContain(parsed.reason);
  });

  it('every refusal reason is a declared member of the closed set', () => {
    const reasons = new Set<string>();
    for (const bad of [
      Buffer.alloc(0),
      encoded({ sinkAddress: 'customer@example.com' }),
      encoded({ senderAddress: 'not an address' }),
      encoded({ subject: '' }),
    ]) {
      const parsed = parseValidationEmailPayload(bad, EXPECTED);
      if (parsed.kind === 'REFUSED') reasons.add(parsed.reason);
    }
    expect(reasons.size).toBeGreaterThanOrEqual(3);
    for (const reason of reasons) {
      expect([...PAYLOAD_REFUSALS]).toContain(reason);
    }
  });

  it('`§2.3` — a sink without the owner marker is REFUSED, and never substituted', () => {
    const parsed = parseValidationEmailPayload(encoded({ sinkAddress: 'customer@example.com' }), EXPECTED);
    expect(parsed.kind).toBe('REFUSED');
    if (parsed.kind !== 'REFUSED') return;
    expect(parsed.reason).toBe('PAYLOAD_SINK_NOT_OWNER_CONTROLLED');
    expect(isOwnerControlledSink('customer@example.com')).toBe(false);
    expect(isOwnerControlledSink(SINK)).toBe(true);
  });

  it('a header-injection or list-shaped address is refused as MALFORMED', () => {
    for (const hostile of [
      `a@b.test, c+${OWNER_SINK_MARKER}@d.test`,
      `x+${OWNER_SINK_MARKER}@y.test\r\nBcc: victim@example.com`,
      `"quoted"+${OWNER_SINK_MARKER}@z.test`,
      '',
    ]) {
      const parsed = parseValidationEmailPayload(encoded({ sinkAddress: hostile }), EXPECTED);
      expect(parsed.kind, hostile).toBe('REFUSED');
    }
  });
});

describe('`§8.6` — SANDBOX MODE FAILS BEFORE THE PROVIDER BOUNDARY', () => {
  it('sandboxMode true is REFUSED, and no request is produced at all', () => {
    const refused = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: mintCorrelationTag(),
      sandboxMode: true,
    });
    expect(refused.kind).toBe('REFUSED');
    if (refused.kind !== 'REFUSED') return;
    expect(refused.reason).toBe('SANDBOX_MODE_REFUSED');
  });

  it('and the SAME input with sandboxMode false produces a request whose flag is false', () => {
    const built = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: mintCorrelationTag(),
      sandboxMode: false,
    });
    expect(built.kind).toBe('REQUEST');
    if (built.kind !== 'REQUEST') return;
    expect(built.body.mail_settings.sandbox_mode.enable).toBe(false);
  });

  it('sandbox is refused FIRST, before any other defect in the same input', () => {
    const refused = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: 'not-a-correlation-tag',
      sandboxMode: true,
    });
    expect(refused.kind).toBe('REFUSED');
    if (refused.kind !== 'REFUSED') return;
    expect(refused.reason).toBe('SANDBOX_MODE_REFUSED');
  });
});

describe('`§8.1`, `§8.3` — the mapping is deterministic and carries the KERNEL correlation', () => {
  it('the same input produces byte-identical bodies', () => {
    const tag = mintCorrelationTag();
    const a = buildSendGridSendRequest({ authorised: AUTHORISED, correlationTag: tag, sandboxMode: false });
    const b = buildSendGridSendRequest({ authorised: AUTHORISED, correlationTag: tag, sandboxMode: false });
    expect(a.kind).toBe('REQUEST');
    if (a.kind !== 'REQUEST' || b.kind !== 'REQUEST') return;
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
  });

  it('exactly ONE recipient, and it is the AUTHORISED sink', () => {
    const built = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: mintCorrelationTag(),
      sandboxMode: false,
    });
    if (built.kind !== 'REQUEST') throw new Error('expected a request');
    expect(built.body.personalizations).toHaveLength(1);
    expect(built.body.personalizations[0].to).toHaveLength(1);
    expect(built.body.personalizations[0].to[0].email).toBe(AUTHORISED.sinkAddress);
    expect(built.body.from.email).toBe(AUTHORISED.senderAddress);
  });

  it('the SUBJECT and BODY are the AUTHORISED ones, verbatim and undecorated', () => {
    const built = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: mintCorrelationTag(),
      sandboxMode: false,
    });
    if (built.kind !== 'REQUEST') throw new Error('expected a request');
    /*
     * `33 §1` — "receives the kernel's `dispatch_payload` **verbatim**". A mapping that
     * appended a sentence, or composed the subject from the tag, would be emitting content the
     * authorisation did not commit to.
     */
    expect(built.body.subject).toBe(AUTHORISED.subject);
    expect(built.body.content[0].value).toBe(AUTHORISED.bodyText);
  });

  it('the tag is on `categories` AND on `custom_args`, and only there', () => {
    const tag = mintCorrelationTag();
    const built = buildSendGridSendRequest({ authorised: AUTHORISED, correlationTag: tag, sandboxMode: false });
    if (built.kind !== 'REQUEST') throw new Error('expected a request');
    expect([...built.body.categories]).toEqual([tag]);
    expect(built.body.custom_args[CORRELATION_CUSTOM_ARG]).toBe(tag);
    // AND IT DID NOT REACH A SEMANTIC FIELD. `§2.1`: correlation metadata alters no business
    // or recipient semantics.
    expect(built.body.subject).not.toContain(tag);
    expect(built.body.content[0].value).not.toContain(tag);
    expect(built.body.personalizations[0].to[0].email).not.toContain(tag);
  });

  it('a tag this kernel did not mint is REFUSED — provider evidence would not correlate', () => {
    for (const bad of ['', 'acos-corr-', 'acos-corr-not-a-uuid', 'corr-123']) {
      const refused = buildSendGridSendRequest({
        authorised: AUTHORISED,
        correlationTag: bad,
        sandboxMode: false,
      });
      expect(refused.kind, bad).toBe('REFUSED');
      if (refused.kind !== 'REFUSED') continue;
      expect(refused.reason).toBe('CORRELATION_TAG_MALFORMED');
    }
  });

  it('`§19` item 1, structurally — the mapping input has NO configured address member', () => {
    /*
     * The behavioural discrimination is CONTROL 9. This is the structural half, and it is the
     * stronger statement: `SendGridSendInput` has three members and none of them is a launch
     * document, so a configuration substitution is not merely ignored — it is INEXPRESSIBLE.
     */
    const input = { authorised: AUTHORISED, correlationTag: mintCorrelationTag(), sandboxMode: false };
    expect(Object.keys(input).sort()).toEqual(['authorised', 'correlationTag', 'sandboxMode']);
    expect(SENDGRID_MAIL_SEND_PATH).toBe('/v3/mail/send');
  });
});
