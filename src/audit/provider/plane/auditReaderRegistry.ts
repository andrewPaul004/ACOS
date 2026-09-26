import type { AuditVerifiedCredentialScope } from '../../controlArtifacts/auditPlaneVerifier.js';
import { isWellFormedProviderId } from '../protocol/readerIdentity.js';

/**
 * THE CLOSED AUDIT-READER REGISTRY — `§13`, `§14`, AND `48 §3.6`'s EXEMPTION, ENFORCED.
 *
 * =================================================================================
 * WHAT A DESCRIPTOR IS, AND WHY NO REQUEST CAN CARRY ONE
 *
 * The same rule `adapterRuntimeRegistry.ts` implements, applied to this plane: a descriptor
 * is built at process wiring time, and there is no function in this module, in
 * `auditReadClient.ts` or on the read path that takes a path, a specifier, a flag or a
 * locator as a per-request argument. `§16`'s "no generic URL" is the message-level half of
 * the same property; this is the launch-level half.
 *
 * =================================================================================
 * `§13`'s THREE SEPARATIONS, EACH AS A REFUSAL TO CONSTRUCT
 *
 * "Do not put audit credentials into: control process; control integration adapter runtime;
 * **same secret source as send credential**."
 *
 *   control process            structural. This registry is in `src/audit/`, its reader runs
 *                              in its own forked process, and the control plane imports
 *                              neither. `tests/integration/audit/audit-source-boundary.test.ts`
 *                              asserts no control-plane module imports this package.
 *   integration adapter runtime structural, plus `READER_LOCATOR_SHARED_WITH_INTEGRATION`
 *                              below: a descriptor whose locator collides with a locator the
 *                              integration plane holds is REFUSED at construction.
 *   same secret source         same refusal. A locator is what names a source, so two
 *                              runtimes sharing a locator are two runtimes sharing a source
 *                              whatever their module specifiers say.
 *
 * =================================================================================
 * AND THE ONE CHECK THAT IS NEW IN S1O — `50 §2g` FIELD 6
 *
 * `48 §3.6`'s exemption rests on the audit plane's vendor credential being read-only, and
 * before v1.3.7 that was a prose property with no signed operand. It has one now, and this
 * registry is where it is enforced: a descriptor naming a credential whose SIGNED class-5
 * record is not `READ_ONLY` is refused, and a descriptor naming a credential the class-5
 * artifact does not contain at all is refused too.
 *
 * **MISSING FAILS CLOSED.** `50 §2g`: "A configured vendor credential whose
 * `credential_risk_class` is absent, unparseable, or outside this closed set FAILS CLOSED."
 * There is no branch below that treats an unknown credential as safe, and
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` holds the implementation that does.
 * =================================================================================
 */

/** One audit reader runtime, as trusted deployment configuration. */
export interface AuditReaderDescriptor {
  /** The ONE provider identity this reader serves. */
  readonly providerId: string;
  /** The credential identity whose SIGNED class-5 record governs this reader. */
  readonly credentialId: string;
  /** `29 §3.5`'s confinement root. Both module specifiers must resolve inside it. */
  readonly runtimeRoot: string;
  /** The reader module. Trusted configuration, never a caller's value. */
  readonly readerModule: string;
  /** The secret-source module. Same provenance. */
  readonly secretSourceModule: string;
  /** The audit read credential's LOCATOR. Never the material it locates. */
  readonly secretLocator: string;
}

/** The refusals this module produces. All are refusals to CONSTRUCT, at wiring time. */
export const AUDIT_READER_REGISTRY_REFUSALS = [
  'PROVIDER_ID_MALFORMED',
  'DUPLICATE_AUDIT_READER',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  /** `50 §2g`: the class-5 artifact carries no record for this credential. FAIL CLOSED. */
  'CREDENTIAL_NOT_DECLARED',
  /** `50 §2g` field 6 is not `READ_ONLY`. `48 §3.6`'s exemption is not earned. */
  'CREDENTIAL_NOT_READ_ONLY',
  /** `50 §2g` field 7 is true. A mutation-capable credential is not an audit credential. */
  'CREDENTIAL_EXTERNALLY_MUTATION_CAPABLE',
  /**
   * `50 §2g` field 2 does not carry the reserved `audit_plane` scope.
   *
   * The mirror of `adapterRuntimeRegistry`'s `CREDENTIAL_IS_AUDIT_PLANE_SCOPED`, and both
   * halves are needed: that one stops an audit credential being presented at a dispatch
   * boundary, and this one stops an ADAPTER's credential being presented at the audit read
   * boundary. Without it, a deployment could point the audit reader at a send credential
   * that happened to be declared `READ_ONLY` for some other adapter, and `§13`'s "no control
   * send credential" would rest on the declaration alone.
   */
  'CREDENTIAL_NOT_AUDIT_PLANE_SCOPED',
  /** `§13`: the audit credential must not share a source with the send credential. */
  'READER_LOCATOR_SHARED_WITH_INTEGRATION',
] as const;

export type AuditReaderRegistryRefusal = (typeof AUDIT_READER_REGISTRY_REFUSALS)[number];

export class AuditReaderRegistryError extends Error {
  public readonly refusal: AuditReaderRegistryRefusal;

  public constructor(refusal: AuditReaderRegistryRefusal, detail: string) {
    super(`${refusal}: ${detail}`);
    this.refusal = refusal;
    this.name = 'AuditReaderRegistryError';
  }
}

export interface AuditReaderRegistry {
  readonly resolve: (providerId: string) => AuditReaderDescriptor | undefined;
  readonly registeredIds: readonly string[];
  /** The signed class-5 record each registered reader was admitted against. Evidence. */
  readonly credentialScopeOf: (providerId: string) => AuditVerifiedCredentialScope | undefined;
}

function specifierIsInsideRoot(root: string, specifier: string): boolean {
  // A STRING-PREFIX check on normalised separators, for the reason
  // `adapterRuntimeRegistry.ts` uses one: this runs in the audit plane's parent, and a
  // parent that resolved a child's paths against its own working directory would be
  // answering a question about the wrong process. The authoritative containment check is
  // `main.ts`'s `isInsideAuditRuntimeRoot`, which runs INSIDE the runtime being confined.
  const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalisedRoot = normalise(root);
  const normalisedSpecifier = normalise(specifier);
  return (
    normalisedSpecifier.startsWith(`${normalisedRoot}/`) && !normalisedSpecifier.includes('/../')
  );
}

/**
 * Build the registry. THE ONLY WAY TO PRODUCE AN `AuditReaderRegistry`.
 *
 * `integrationSecretLocators` is the set of locators the INTEGRATION plane holds, supplied
 * by the composition root so this module can refuse a collision without importing the other
 * plane's registry. Passing it is the deployment's own declaration of what the send side
 * uses; passing an empty set is possible and is exactly the mis-wiring
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` exercises, so the boundary suite
 * asserts the real composition passes the real set.
 */
export function createAuditReaderRegistry(
  descriptors: readonly AuditReaderDescriptor[],
  auditReadCredentials: Readonly<Record<string, AuditVerifiedCredentialScope>>,
  integrationSecretLocators: ReadonlySet<string>,
): AuditReaderRegistry {
  const byProvider = new Map<string, AuditReaderDescriptor>();
  const scopeByProvider = new Map<string, AuditVerifiedCredentialScope>();

  for (const descriptor of descriptors) {
    if (!isWellFormedProviderId(descriptor.providerId)) {
      throw new AuditReaderRegistryError(
        'PROVIDER_ID_MALFORMED',
        `"${descriptor.providerId}" does not satisfy the provider identifier grammar`,
      );
    }
    if (byProvider.has(descriptor.providerId)) {
      throw new AuditReaderRegistryError(
        'DUPLICATE_AUDIT_READER',
        `two readers were configured for provider "${descriptor.providerId}"; 23 §7 scopes ` +
          'isolation per credential, so one credential scope is one runtime',
      );
    }
    for (const specifier of [descriptor.readerModule, descriptor.secretSourceModule]) {
      if (!specifierIsInsideRoot(descriptor.runtimeRoot, specifier)) {
        throw new AuditReaderRegistryError(
          'MODULE_OUTSIDE_RUNTIME_ROOT',
          `a module configured for "${descriptor.providerId}" does not resolve inside its ` +
            'declared runtime root; 29 §3.5 requires per-credential dependency isolation',
        );
      }
    }

    // ---------------------------------------------------------------------------------
    // `§13` — THE AUDIT SOURCE IS NOT THE SEND SOURCE.
    // ---------------------------------------------------------------------------------
    if (integrationSecretLocators.has(descriptor.secretLocator)) {
      throw new AuditReaderRegistryError(
        'READER_LOCATOR_SHARED_WITH_INTEGRATION',
        `the audit reader for "${descriptor.providerId}" resolves its credential from a ` +
          'locator the integration plane also holds; §13 requires a separate credential ' +
          'source, and a shared locator is a shared source whatever the module specifiers say',
      );
    }

    // ---------------------------------------------------------------------------------
    // `50 §2g` — THE SIGNED CLASS-5 RECORD. MISSING FAILS CLOSED.
    // ---------------------------------------------------------------------------------
    const scope = auditReadCredentials[descriptor.credentialId];
    if (scope === undefined) {
      throw new AuditReaderRegistryError(
        'CREDENTIAL_NOT_DECLARED',
        `the verified class-5 declaration carries no record for credential ` +
          `"${descriptor.credentialId}"; 50 §2g: a configured vendor credential whose ` +
          'credential_risk_class is absent FAILS CLOSED, and an undeclared credential is ' +
          'not a READ_ONLY one by default',
      );
    }
    /*
     * THE `audit_plane` SENTINEL CHECK IS THE VERIFIER'S, NOT THIS MODULE'S.
     *
     * `auditPlaneVerifier.ts` keeps ONLY records carrying `50 §2g` field 2's reserved
     * `audit_plane` scope, so an adapter-scoped credential never reaches this map and a
     * descriptor naming one is refused as UNDECLARED above. That is the stronger placement:
     * the audit plane never learns a send credential's identity at all, which makes `§13`'s
     * "no control send credential" a fact about what this plane can see rather than a check
     * it performs.
     */
    if (scope.provider !== descriptor.providerId) {
      throw new AuditReaderRegistryError(
        'CREDENTIAL_NOT_AUDIT_PLANE_SCOPED',
        `credential "${descriptor.credentialId}" is declared for provider ` +
          `"${scope.provider}" and the descriptor configures it for ` +
          `"${descriptor.providerId}"`,
      );
    }
    if (scope.credentialRiskClass !== 'READ_ONLY') {
      throw new AuditReaderRegistryError(
        'CREDENTIAL_NOT_READ_ONLY',
        `credential "${descriptor.credentialId}" is declared ${scope.credentialRiskClass}; ` +
          "48 §3.6's audit-plane exemption rests on the credential being read-only, and " +
          '50 §2g reserves READ_ONLY for a credential with no external mutation at all',
      );
    }
    if (scope.externalMutationCapable) {
      // Unreachable while the class-5 parser enforces `§2g`'s self-consistency rule, and
      // present anyway: this registry is the component `48 §3.6` names, and an invariant it
      // relies on should be checked where it is relied upon rather than only where it is
      // produced.
      throw new AuditReaderRegistryError(
        'CREDENTIAL_EXTERNALLY_MUTATION_CAPABLE',
        `credential "${descriptor.credentialId}" declares external_mutation_capable true`,
      );
    }

    byProvider.set(descriptor.providerId, Object.freeze({ ...descriptor }));
    scopeByProvider.set(descriptor.providerId, scope);
  }

  const ids = Object.freeze([...byProvider.keys()].sort());
  return Object.freeze({
    resolve: (providerId: string): AuditReaderDescriptor | undefined => byProvider.get(providerId),
    registeredIds: ids,
    credentialScopeOf: (providerId: string): AuditVerifiedCredentialScope | undefined =>
      scopeByProvider.get(providerId),
  });
}

/**
 * PRODUCTION'S OWN AUDIT READER REGISTRY. IT IS EMPTY, AND THAT IS THE POINT.
 *
 * `§27`: "Do not make any provider send call. [...] No real provider secret should be
 * required." The read side is the same posture: `48 §2` row 13 describes a capability the
 * repository does not yet have, S1O builds the mechanism and selects a provider, and the
 * first real provider read belongs to the resumed validation slice.
 *
 * A FUNCTION rather than a constant because `createAuditReaderRegistry` requires the audit
 * plane's own verification outcome, which has not run at module-evaluation time. An empty
 * registry needs no artifact read, so this one never asks for one.
 */
export function emptyAuditReaderRegistry(): AuditReaderRegistry {
  return Object.freeze({
    resolve: (): AuditReaderDescriptor | undefined => undefined,
    registeredIds: Object.freeze([]),
    credentialScopeOf: (): AuditVerifiedCredentialScope | undefined => undefined,
  });
}
