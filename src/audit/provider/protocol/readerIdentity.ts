/**
 * THE CLOSED SET OF AUDIT PROVIDER-READ RUNTIME IDENTITIES — `§14` OF THE S1O MANDATE.
 *
 * =================================================================================
 * WHY THE AUDIT PLANE NEEDS ITS OWN IDENTITY SPACE AND DOES NOT BORROW Z2's
 *
 * `src/integration/protocol/runtimeIdentity.ts` declares two kinds of runtime,
 * `CONTROL_PLANE` and `INTEGRATION_ADAPTER:<adapter_id>`. Reusing it here would put the
 * audit plane's reader into the SAME identity space as the integration plane's senders, and
 * the whole point of `§13` is that they are different planes with different credentials:
 *
 *   "The audit plane must use **AN INDEPENDENT PROVIDER READ CREDENTIAL INCAPABLE OF
 *    EXTERNAL MUTATION.** Do not put audit credentials into: control process; control
 *    integration adapter runtime; **same secret source as send credential**."
 *
 * An identity space shared with the sender is a space in which a wiring mistake produces a
 * NAME COLLISION rather than a refusal — `INTEGRATION_ADAPTER:mock_ads` would parse in both
 * planes — and `23 §3`'s plane table gives the two planes different credential rules, so an
 * identity that cannot tell them apart cannot enforce either.
 *
 * So there is exactly one kind of runtime here:
 *
 *     AUDIT_PROVIDER_READER:<provider_id>   one Z4 process per PROVIDER identity. Holds
 *                                           exactly one READ-ONLY provider credential and
 *                                           no other, and holds NO send credential at all.
 *
 * And the prefix is deliberately NOT a suffix of `INTEGRATION_ADAPTER:`, so neither space's
 * parser accepts the other's identity. `isIntegrationRuntimeIdentity` below is that
 * assertion made available to the boundary suite rather than left as an observation.
 *
 * =================================================================================
 * THE IDENTITY IS KEYED BY PROVIDER, NOT BY ADAPTER, AND THAT IS `§14`'s POINT
 *
 * `§14`: "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * An audit reader keyed by ADAPTER would be keyed by an ACOS-side concept — which adapter
 * ACOS routed the effect through — and the reader's job is to ask the PROVIDER what
 * happened, independently of what ACOS believes. `30 §5.4`'s structural-independence
 * argument is the same one: the audit plane's inputs must not contain a control-plane read,
 * and an adapter identity is a control-plane fact.
 *
 * `I8`'s own rule agrees: `48`'s v1.3 note says the audit plane's inverse-sweep reads are
 * "**period-bounded and never parameterised by an ACOS-side identifier or tag set**". A
 * provider identity is the vendor's, and a period is the clock's; neither is ACOS's.
 * =================================================================================
 */

/** The `AUDIT_PROVIDER_READER:` prefix, as one constant so no call site spells it. */
export const AUDIT_PROVIDER_READER_PREFIX = 'AUDIT_PROVIDER_READER:';

/**
 * A provider identity, as a grammar.
 *
 * Lowercase ASCII letters, digits and underscore, 3..64 characters — the same shape
 * `runtimeIdentity.ts` admits for an adapter id, and for the same reason: every character it
 * admits is safe in an environment-variable value and in a path segment, so no call site
 * downstream has to escape one.
 */
const PROVIDER_ID_GRAMMAR = /^[a-z0-9_]{3,64}$/;

export function isWellFormedProviderId(value: string): boolean {
  return PROVIDER_ID_GRAMMAR.test(value);
}

declare const AUDIT_READER_IDENTITY: unique symbol;

export type AuditReaderIdentity = string & { readonly [AUDIT_READER_IDENTITY]: true };

/**
 * One audit provider-read runtime's identity. THROWS on a malformed id.
 *
 * `throw` rather than a refusal value, for the reason `integrationAdapterRuntimeIdentity`
 * throws: this is a WIRING error at process start, not a runtime authority decision, and a
 * process wired to launch a reader whose identity does not parse must not start.
 */
export function auditProviderReaderIdentity(providerId: string): AuditReaderIdentity {
  if (!isWellFormedProviderId(providerId)) {
    throw new Error(
      `"${providerId}" is not a well-formed provider identity; 23 §7 scopes isolation per ` +
        'credential, so an ambiguous identity is an ambiguous credential scope',
    );
  }
  return `${AUDIT_PROVIDER_READER_PREFIX}${providerId}` as AuditReaderIdentity;
}

/** The inverse. Returns the provider id an audit reader identity names, or `null`. */
export function providerIdOfAuditReaderIdentity(identity: string): string | null {
  if (!identity.startsWith(AUDIT_PROVIDER_READER_PREFIX)) return null;
  const providerId = identity.slice(AUDIT_PROVIDER_READER_PREFIX.length);
  return isWellFormedProviderId(providerId) ? providerId : null;
}

/**
 * True for an identity belonging to the INTEGRATION plane's space rather than this one.
 *
 * Exported so `auditReaderRegistry.ts` and the boundary suite can assert the two spaces are
 * disjoint by ASKING rather than by inspecting a string, and so the assertion has one place
 * to change if either prefix ever moves.
 */
export function isIntegrationRuntimeIdentity(identity: string): boolean {
  return identity === 'CONTROL_PLANE' || identity.startsWith('INTEGRATION_ADAPTER:');
}
