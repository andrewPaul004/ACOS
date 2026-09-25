import { INTERNAL_ONLY_ADAPTER, isActionClass } from '../../kernel/canonicalisation/actionClasses.js';

/**
 * THE CLOSED SET OF RUNTIME IDENTITIES — `§6` OF THE S1N MANDATE.
 *
 * =================================================================================
 * WHAT THE ARCHITECTURE REQUIRES, AND WHY AN IDENTITY IS NOT A STRING
 *
 * `23 §3`'s plane table gives the control plane "only its own DB credential — CI-enforced
 * (I25)" and the integration plane "vendor credentials live here and nowhere else".
 * `23 §7`'s zone rules sharpen it to a PER-ADAPTER property: "**v1.1: isolation is per
 * adapter, not per plane** (R5, R6) — one adapter cannot read another's secret from its own
 * environment or filesystem".
 *
 * So there are exactly two kinds of runtime in this repository's integration boundary:
 *
 *     CONTROL_PLANE                      the Z1 process. Holds the database credential and
 *                                        no vendor credential, ever.
 *     INTEGRATION_ADAPTER:<adapter_id>   one Z2 process per ADAPTER IDENTITY. Holds exactly
 *                                        one vendor credential scope and no other.
 *
 * `§6` of the mandate: "Do not let caller/model choose an arbitrary process target. Adapter
 * identity comes from the verified class-3 action catalogue."
 *
 * THAT IS WHY `integrationAdapterRuntimeIdentity` TAKES AN ADAPTER ID AND VALIDATES IT
 * AGAINST THE CLOSED CATALOGUE'S OWN SHAPE RULES RATHER THAN ACCEPTING ANY STRING. The
 * catalogue MEMBERSHIP check lives in `adapterRuntimeRegistry.ts`, which holds the verified
 * bundle; what lives here is the shape and the total, injective encoding, because an
 * identity that two different adapters could spell the same way is not an identity.
 * =================================================================================
 */

/** The Z1 runtime. There is exactly one, and it never carries an adapter suffix. */
export const CONTROL_PLANE_RUNTIME = 'CONTROL_PLANE';

/** The `INTEGRATION_ADAPTER:` prefix, as one constant so no call site spells it. */
export const INTEGRATION_ADAPTER_RUNTIME_PREFIX = 'INTEGRATION_ADAPTER:';

export type ControlPlaneRuntimeIdentity = typeof CONTROL_PLANE_RUNTIME;

/**
 * A runtime identity, as a branded string.
 *
 * The brand is what stops a caller passing an arbitrary process target: the only producers
 * are the two functions below, and both refuse anything the closed catalogue's identifier
 * grammar does not admit.
 */
declare const RUNTIME_IDENTITY: unique symbol;

export type RuntimeIdentity = string & { readonly [RUNTIME_IDENTITY]: true };

/**
 * `26 §5`'s catalogue-assigned adapter identity, as a grammar.
 *
 * Lowercase ASCII letters, digits and underscore, 3..64 characters. The four identities the
 * S1 catalogue actually names (`mock_ads`, `mock_processor`, `mock_commerce`, and
 * `INTERNAL_ONLY`'s sentinel which is excluded below) all satisfy it, and the grammar is
 * deliberately narrower than "a string": every character it admits is safe in an
 * environment-variable value, in a `NUL`-separated binding preimage and in a path segment,
 * so no call site downstream has to escape one.
 */
const ADAPTER_ID_GRAMMAR = /^[a-z0-9_]{3,64}$/;

export function isWellFormedAdapterId(value: string): boolean {
  if (value === INTERNAL_ONLY_ADAPTER) return false;
  if (isActionClass(value)) return false;
  return ADAPTER_ID_GRAMMAR.test(value);
}

/** The control plane's own identity. A function rather than a cast, so there is one site. */
export function controlPlaneRuntimeIdentity(): RuntimeIdentity {
  return CONTROL_PLANE_RUNTIME as RuntimeIdentity;
}

/**
 * One adapter runtime's identity. THROWS on a malformed id.
 *
 * `throw` rather than a refusal value, deliberately, and for the reason
 * `createAdapterRegistry` throws: this is a WIRING error at process start, not a runtime
 * authority decision, and a process wired to launch a runtime whose identity does not parse
 * must not start.
 */
export function integrationAdapterRuntimeIdentity(adapterId: string): RuntimeIdentity {
  if (!isWellFormedAdapterId(adapterId)) {
    throw new Error(
      `"${adapterId}" is not a well-formed adapter identity; 26 §5 assigns adapter ` +
        'identities in the closed catalogue and this one does not satisfy the identifier ' +
        'grammar (23 §7: isolation is per adapter, so an ambiguous identity is an ' +
        'ambiguous credential scope)',
    );
  }
  return `${INTEGRATION_ADAPTER_RUNTIME_PREFIX}${adapterId}` as RuntimeIdentity;
}

/**
 * The inverse. Returns the adapter id an integration runtime identity names, or `null`.
 *
 * Total and injective against the producer above, which is what makes "adapter A's runtime"
 * and "adapter B's runtime" distinguishable by the host without a second field to disagree
 * with.
 */
export function adapterIdOfRuntimeIdentity(identity: string): string | null {
  if (!identity.startsWith(INTEGRATION_ADAPTER_RUNTIME_PREFIX)) return null;
  const adapterId = identity.slice(INTEGRATION_ADAPTER_RUNTIME_PREFIX.length);
  return isWellFormedAdapterId(adapterId) ? adapterId : null;
}

/** True for the one Z1 identity and nothing else. */
export function isControlPlaneRuntimeIdentity(identity: string): boolean {
  return identity === CONTROL_PLANE_RUNTIME;
}
