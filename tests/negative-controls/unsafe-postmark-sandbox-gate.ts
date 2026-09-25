import {
  CONTROL_SEND_CREDENTIAL_KEY,
  EXPECTED_DELIVERY_TYPE_KEY,
  REFUSED_CONFIGURATION_KEYS,
  REQUIRED_DELIVERY_TYPE,
} from '../../tools/postmark-sandbox/gate.js';
import {
  POSTMARK_CAPABILITY_RECORD,
  type ProviderCapabilityRecord,
} from '../../tools/postmark-sandbox/capabilityRecord.js';

/**
 * THE TEST-ONLY VULNERABLE S1M PROVIDER-SANDBOX CONTROLS OF `§53`.
 *
 * =================================================================================
 * WHY THESE EXIST
 *
 * **A control that has never failed is indistinguishable from one that cannot.** The real
 * gate refusing an unconfigured environment proves nothing on its own — a gate that refused
 * everything would pass that test too. The discriminating form is a SECOND implementation
 * that makes the specific mistake, run against the SAME environment, which ACCEPTS what the
 * real gate refuses.
 *
 * Each is a REAL BRANCH rather than a flag that skips a check, so the code a reader sees is
 * the code an unlucky implementer would have written.
 *
 * =================================================================================
 * WHICH OF `§53`'s FOURTEEN LIVE HERE, AND WHICH CANNOT
 *
 * `§53` lists fourteen. The ones below are exactly those whose defect is expressible WITHOUT
 * a provider, a transport or an adapter. The remainder — correlation metadata dropped on the
 * wire, an old `CLAIMED` row redispatched at a real provider, a lost response mapped
 * `NOT_SENT` after real bytes left, a provider count inferred from the journal, an audit
 * plane trusting a real adapter result, a query delay triggering a real resend, and the real
 * duplicate-send control — each needs bytes to cross a real boundary, and S1M never crosses
 * one. `S1M-test-matrix.md` carries them as NOT IMPLEMENTED rather than as passing rows.
 *
 * Three of the seven absent ones DO have accepted mock-level ancestors and this slice adds
 * nothing to them: `unsafe-reclaimable-outbox.ts`, `unsafe-not-sent-mapping.ts` and
 * `unsafe-dispatch-claimed.ts`. A mock-level control is not a provider-level control, which
 * is the whole reason `I36`'s verification leg is separate from its enforcement leg.
 *
 * **NOTHING UNDER `src/` IMPORTS THIS FILE**, and `tests/release/release-boundaries.test.ts`
 * asserts that over the whole production tree.
 * =================================================================================
 */

export type UnsafePostmarkControl =
  /** `§53` row 1. A live server accepted as a sandbox. */
  | 'LIVE_SERVER_ACCEPTED_AS_SANDBOX'
  /** `§53` row 1, the softer and likelier shape: an absent declaration defaulted to sandbox. */
  | 'UNDECLARED_DELIVERY_TYPE_DEFAULTED_TO_SANDBOX'
  /** `§53` row 2. A caller hands the gate a token and the gate uses it. */
  | 'CALLER_SUPPLIED_TOKEN_ACCEPTED'
  /** `§53` row 3. A caller-chosen API origin honoured instead of refused. */
  | 'CALLER_SUPPLIED_API_BASE_URL_HONOURED'
  /** `§53` row 9. One credential serving both the dispatch and the audit read. */
  | 'AUDIT_BORROWS_CONTROL_CREDENTIAL'
  /** `§53` row 11. The credential reaching a rendered report. */
  | 'CREDENTIAL_RENDERED_IN_REPORT'
  /** `§14`. Native idempotency claimed for a provider that documents none. */
  | 'NATIVE_IDEMPOTENCY_CLAIMED'
  /** `§7`. A send-capable credential recorded as a read-only audit credential. */
  | 'SEND_CAPABLE_TOKEN_RECORDED_AS_READ_ONLY';

export type UnsafeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * VULNERABLE CONTROL 1 — the sandbox declaration read permissively.
 *
 * The real gate requires the declaration to be present AND to equal `Sandbox`. This one
 * accepts a live declaration, which is the defect `§3` names: "Do NOT allow: Live Server
 * token; live message stream; production server token; fallback from sandbox to live."
 */
export function unsafeAcceptsDeliveryType(
  source: UnsafeEnvironment,
  control: UnsafePostmarkControl,
): boolean {
  const declared = source[EXPECTED_DELIVERY_TYPE_KEY];
  if (control === 'LIVE_SERVER_ACCEPTED_AS_SANDBOX') {
    // "Any declared server is a server we may send through." The classification is READ and
    // then not USED, which is how a live token comes to sit behind a sandbox deployment.
    return declared !== undefined && declared !== '';
  }
  if (control === 'UNDECLARED_DELIVERY_TYPE_DEFAULTED_TO_SANDBOX') {
    // `§35`: "Do not silently trust a variable named sandbox if a Live token can still
    // send." The softer defect does not even require the variable.
    return declared === undefined || declared === '' || declared === REQUIRED_DELIVERY_TYPE;
  }
  return declared === REQUIRED_DELIVERY_TYPE;
}

/**
 * VULNERABLE CONTROL 2 — a caller-supplied provider token accepted.
 *
 * `§9`: "The model/worker must not supply: Postmark token; server ID; sandbox/live mode; API
 * base URL; MessageStream; metadata keys; provider MessageID; retry behavior."
 *
 * The real gate has NO parameter a caller could put a token in — the readiness function
 * takes an environment source and a capability record and nothing else, and the dispatch
 * envelope has no credential field. This function is what the shape would look like if it
 * did, and it is deliberately a FUNCTION SIGNATURE rather than a behaviour: the defect is
 * that the parameter exists at all.
 */
export function unsafeReadinessWithCallerToken(
  source: UnsafeEnvironment,
  callerSuppliedToken: string,
): { readonly tokenUsed: string } {
  return { tokenUsed: callerSuppliedToken !== '' ? callerSuppliedToken : (source[CONTROL_SEND_CREDENTIAL_KEY] ?? '') };
}

/**
 * VULNERABLE CONTROL 3 — a caller-chosen API origin honoured.
 *
 * `§30`: "Do not let caller/model choose an arbitrary provider endpoint [...] Do not ship
 * SSRF-like arbitrary base URL selection in production." The real gate treats the presence
 * of the variable as a refusal; this one resolves an origin from it.
 */
export function unsafeResolveApiOrigin(source: UnsafeEnvironment): string {
  return source.POSTMARK_API_BASE_URL ?? 'https://api.postmarkapp.com';
}

/** The origin the real system may use. Declared here ONLY so the control has something to differ from. */
export const TRUSTED_API_ORIGIN_FOR_COMPARISON = 'https://api.postmarkapp.com';

/**
 * VULNERABLE CONTROL 9 — the audit plane borrowing the control plane's credential.
 *
 * `§27`: "control dispatch ≠ audit truth [...] Production audit performs its own provider
 * request and can detect disagreement." The real gate compares the two slots and refuses
 * when they are equal; this one falls back to the send credential when the audit slot is
 * empty, which is how a two-slot design collapses into a one-credential one in practice.
 */
export function unsafeAuditCredentialSlot(source: UnsafeEnvironment): string | undefined {
  return source.ACOS_AUDIT_POSTMARK_SANDBOX_SERVER_TOKEN ?? source[CONTROL_SEND_CREDENTIAL_KEY];
}

/**
 * VULNERABLE CONTROL 11 — the credential reaching a rendered report.
 *
 * `§29`: the token must never appear in a journal, a row, a payload, worker output, an
 * exception, a structured incident or a log. The likeliest real-world shape is not malice:
 * it is a diagnostic line added while debugging a 401.
 */
export function unsafeRenderWithCredential(source: UnsafeEnvironment): string {
  return [
    'ACOS S1M — POSTMARK SANDBOX VALIDATION READINESS',
    `control send credential  : ${source[CONTROL_SEND_CREDENTIAL_KEY] ?? '(absent)'}`,
  ].join('\n');
}

/**
 * VULNERABLE CONTROL — native idempotency claimed for a provider that documents none.
 *
 * `§14`: "Do NOT claim native idempotency if Postmark does not provide a documented
 * idempotency key." The defect matters because `25 §7`'s downgrade rule keys on it: "Where
 * the adapter's API offers no idempotency, the effect class is downgraded."
 */
export function unsafeCapabilityRecord(
  control: UnsafePostmarkControl,
  base: ProviderCapabilityRecord = POSTMARK_CAPABILITY_RECORD,
): ProviderCapabilityRecord {
  if (control === 'NATIVE_IDEMPOTENCY_CLAIMED') {
    return Object.freeze({
      ...base,
      em6: Object.freeze({ ...base.em6, IDEMPOTENCY_HEADER: true }),
      qualifyingPrimitive: 'IDEMPOTENCY_HEADER' as const,
    });
  }
  if (control === 'SEND_CAPABLE_TOKEN_RECORDED_AS_READ_ONLY') {
    return Object.freeze({
      ...base,
      credentialScoping: Object.freeze({
        ...base.credentialScoping,
        readOnlyApiTokenAvailable: true,
        detail: 'a second server token is a separate credential, so treat it as read-only',
      }),
    });
  }
  return base;
}

/** The refused-configuration keys, as a plain set, so a test can assert the real list is used. */
export const REFUSED_KEYS: readonly string[] = Object.freeze(
  REFUSED_CONFIGURATION_KEYS.map((entry) => entry.key),
);
