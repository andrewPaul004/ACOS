import {
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  type ActionClass,
} from '../../kernel/canonicalisation/actionClasses.js';
import { actionCatalogueEntry } from '../../kernel/canonicalisation/actionCatalogue.js';
import {
  verifiedCredentialScopes,
  type VerifiedControlArtifactBundle,
  type VerifiedCredentialScope,
} from '../../kernel/controlArtifacts/bundle.js';
import {
  AUDIT_PLANE_CREDENTIAL_SCOPE,
  type CredentialRiskClass,
} from '../../kernel/controlArtifacts/credentialRisk.js';
import type { AdapterResolutionCapability } from '../../kernel/gateway/adapterPort.js';
import { isWellFormedAdapterId } from '../protocol/runtimeIdentity.js';

/**
 * THE CLOSED ADAPTER-RUNTIME REGISTRY — `§37`, `§38`, AND OPTION A's OWN GUARD RAIL.
 *
 * =================================================================================
 * WHAT A DESCRIPTOR IS, AND WHY NO REQUEST CAN CARRY ONE
 *
 * `§37` of the S1N mandate: "Adapter registration should be trusted startup/deployment
 * configuration plus signed catalogue binding. The model cannot register adapters. The
 * worker cannot supply: executable path; module path; credential locator; runtime flags."
 *
 * So a descriptor is built at process wiring time and validated against the VERIFIED
 * class-3 catalogue and the VERIFIED class-5 credential-scope declaration — `50 §3f`: "For
 * classes 3 and 27 the signed artifact bytes ARE the deployed authority source" — and there
 * is no function in this module, in `integrationClient.ts` or on the dispatch path that
 * takes a path, a specifier, a flag or a locator as a per-request argument.
 * =================================================================================
 */

/**
 * `50 §2g` — THE CREDENTIAL RISK CLASS, READ FROM SIGNED CLASS-5 BYTES.
 *
 * =================================================================================
 * WHAT CHANGED AT v1.3.7, AND WHY IT IS A CHANGE IN KIND
 *
 * S1N recorded `S1N-C1`: ADR-024's trigger is "the first **money-moving credential** or the
 * third adapter, whichever comes first", and **v1.3.6 did not define `money-moving
 * credential` as a mechanised predicate anywhere.** S1N derived it from `50 §2a` field 4,
 * `carries_vendor_monetary_field` — a statement about the vendor request the CURRENT ACTION
 * dispatches — and flagged the derivation for owner ruling.
 *
 * **THE OWNER RULED THAT DERIVATION WRONG IN KIND.** v1.3.7 `50 §2g`:
 *
 *   "MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER. IT
 *    IS NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL."
 *
 * `29 §14` is why the distinction is load-bearing: "**vendor OAuth scopes are coarser than
 * ACOS action classes on every platform examined**". A credential provisioned so ACOS can
 * pause a campaign routinely carries the permission to RAISE ITS BUDGET, which is `§2g`
 * clause 9 — "increase a budget, spend cap, credit line, or analogous provider-side
 * authority that permits additional spend" — and no field of the ACTION catalogue says so.
 *
 * **THE DIFFERENCE IS OBSERVABLE ON THIS REPOSITORY'S OWN CATALOGUE.** `campaign.budget.set`
 * declares `carries_vendor_monetary_field: false`, so S1N's derivation called every
 * `mock_ads` credential `NON_MONETARY`. v1.3.7 asks instead what the credential can do at
 * the provider, and the deployed class-5 declaration carries TWO `mock_ads` credentials that
 * answer differently: `mock_ads.pause_only` is `NON_MONETARY_WRITE` and
 * `mock_ads.budget_manage` is `MONEY_MOVING`. **Same adapter, same action catalogue,
 * different answer** — which is the whole content of the ruling.
 *
 * =================================================================================
 * NOTHING IS DERIVED HERE. THE CLASS IS DECLARED, IN SIGNED BYTES, AND READ.
 *
 * `50 §2g`: "no provider response, account response, adapter self-description, environment
 * variable, caller parameter or model output may supply, override or widen any of the seven
 * fields." A descriptor therefore names a `credentialId` and NOT a risk class: there is no
 * member of `AdapterRuntimeDescriptor` a deployment could use to state one, so there is
 * nothing to cross-check and nothing to be overstated or understated.
 *
 * `S1N`'s `declaredCredentialClass` member and its `CREDENTIAL_CLASS_UNDERSTATED` refusal
 * are **REMOVED** for exactly that reason. A declaration that has to be cross-checked is a
 * declaration somebody can make; the class-5 record is one the owner signed.
 *
 * =================================================================================
 * AND `§9`'s CONVERSE IS HONOURED: A MONETARY ACTION DOES NOT MAKE A CREDENTIAL MONETARY
 *
 * `50 §2g`: "If an ACOS action class is monetary but the configured credential cannot
 * execute it at the provider, that is a **provider capability / `I15` enforceability**
 * question [...] and it does not make the credential `MONEY_MOVING`."
 *
 * `mock_ads.pause_only` is exactly that case: `mock_ads` serves `campaign.budget.set`, and a
 * credential scoped to pause alone cannot execute it. **This module does not refuse that
 * combination**, because refusing it would merge credential risk with ACOS action authority
 * — the merge `§2g` forbids. `29 §14`'s empirical `I15` probe is what catches an action
 * ACOS believes it can dispatch and the provider will not accept.
 * =================================================================================
 */

/**
 * ADR-024's own numbers, as constants so the trigger cannot be edited by accident.
 *
 * "the first money-moving credential or the **third adapter**, whichever comes first."
 * Three adapters is the trigger; two is the last permitted count under option A. `23 §11`
 * sizes the MVP integration plane at "4 adapters at MVP", and that is the point: the fourth
 * slice that wants an adapter is the slice that has to build option B.
 *
 * **UNCHANGED BY v1.3.7.** `50 §2g`: "The third-adapter half is unchanged from v1.3.6 and
 * needs no derivation."
 */
export const OPTION_A_MAX_ADAPTER_RUNTIMES = 2;

/** One adapter runtime, as trusted deployment configuration. */
export interface AdapterRuntimeDescriptor {
  /** MUST be an adapter identity the verified class-3 catalogue names. */
  readonly adapterId: string;
  /**
   * MUST be a credential identity the verified class-5 declaration names (`50 §2g`).
   *
   * An IDENTITY, never the material and never a risk class. The risk class is field 6 of
   * the signed record this identity selects, and a deployment that wanted to state one
   * itself has nowhere to put it.
   */
  readonly credentialId: string;
  /** `§11`'s confinement root. Both module specifiers must resolve inside it. */
  readonly runtimeRoot: string;
  /** The adapter module. Trusted configuration, never a caller's value. */
  readonly adapterModule: string;
  /** The secret-source module. Same provenance. */
  readonly secretSourceModule: string;
  /** `§30`'s per-adapter secret-source LOCATOR. Never the material it locates. */
  readonly secretLocator: string;
  /** `25 §7`'s EM6 criterion, declared per adapter exactly as `adapterPort.ts` requires. */
  readonly resolutionCapabilities: readonly AdapterResolutionCapability[];
}

/** The refusals this module produces. All are refusals to CONSTRUCT, at wiring time. */
export const RUNTIME_REGISTRY_REFUSALS = [
  'ADAPTER_NOT_IN_CATALOGUE',
  'ADAPTER_ID_MALFORMED',
  'DUPLICATE_ADAPTER_RUNTIME',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  /** ADR-024's third-adapter trigger. Option B is not built, so the third is refused. */
  'OPTION_B_TRIGGER_ADAPTER_COUNT',
  /** ADR-024's money-moving trigger, from `50 §2g` field 6. */
  'OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL',
  /**
   * `50 §2g`: a configured credential with no verified class-5 record. **FAILS CLOSED.**
   *
   * The S1N refusal this replaces was `CREDENTIAL_CLASS_UNDERSTATED`, which presumed a
   * deployment-supplied class to understate. There is no such class any more, so the only
   * remaining failure mode is an ABSENT declaration — and `§2g` rules that absence fails
   * closed rather than defaulting to the safe-looking value.
   */
  'CREDENTIAL_NOT_DECLARED',
  /** The class-5 record binds this credential to a different adapter. */
  'CREDENTIAL_ADAPTER_MISMATCH',
  /**
   * `50 §2g` field 2's reserved sentinel: an AUDIT-PLANE read credential.
   *
   * Refused by NAME rather than left to `CREDENTIAL_ADAPTER_MISMATCH`, because the two are
   * different mistakes and only one of them is an attack: a mismatch is a mis-wiring
   * between two adapters, and this is an attempt to present the audit plane's read
   * credential — the one `48 §3.6` exempts from carrying an `authorisation_ref` BECAUSE it
   * only reads — at a dispatch boundary.
   */
  'CREDENTIAL_IS_AUDIT_PLANE_SCOPED',
] as const;

export type RuntimeRegistryRefusal = (typeof RUNTIME_REGISTRY_REFUSALS)[number];

export class AdapterRuntimeRegistryError extends Error {
  public readonly refusal: RuntimeRegistryRefusal;

  public constructor(refusal: RuntimeRegistryRefusal, detail: string) {
    super(`${refusal}: ${detail}`);
    this.refusal = refusal;
    this.name = 'AdapterRuntimeRegistryError';
  }
}

export interface AdapterRuntimeRegistry {
  readonly resolve: (adapterId: string) => AdapterRuntimeDescriptor | undefined;
  readonly registeredIds: readonly string[];
  /** The signed class-5 record each registered adapter was admitted against. Evidence. */
  readonly credentialScopeOf: (adapterId: string) => VerifiedCredentialScope | undefined;
}

/** Every class the verified catalogue routes to this adapter identity. */
export function classesServedBy(
  adapterId: string,
  bundle: VerifiedControlArtifactBundle,
): readonly ActionClass[] {
  return ACTION_CLASSES.filter(
    (actionClass) => actionCatalogueEntry(actionClass, bundle).adapter === adapterId,
  );
}

/**
 * `50 §2g` field 6, for one configured credential. **THE OPTION-B TRIGGER OPERAND.**
 *
 * A LOOKUP, NOT A DERIVATION, and that is the substance of the v1.3.7 change. S1N's
 * `derivedCredentialClass()` read the ACTION catalogue and computed an answer; this reads
 * the CREDENTIAL declaration and returns the one the owner signed.
 *
 * Returns `null` when the declaration carries no record for the credential. `§2g`: absent
 * FAILS CLOSED, and a `null` return is what makes the caller say so rather than defaulting.
 */
export function declaredCredentialRiskClass(
  credentialId: string,
  bundle: VerifiedControlArtifactBundle,
): CredentialRiskClass | null {
  const scope = verifiedCredentialScopes(bundle).credentials[credentialId];
  return scope === undefined ? null : scope.credentialRiskClass;
}

/** Every adapter identity the verified catalogue names, `INTERNAL_ONLY` excluded. */
function catalogueAdapterIdsFrom(bundle: VerifiedControlArtifactBundle): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const actionClass of ACTION_CLASSES) {
    const adapter = actionCatalogueEntry(actionClass, bundle).adapter;
    if (adapter !== INTERNAL_ONLY_ADAPTER) ids.add(adapter);
  }
  return ids;
}

function specifierIsInsideRoot(root: string, specifier: string): boolean {
  // Deliberately a STRING-PREFIX check on normalised separators rather than a filesystem
  // resolution: this runs in the control plane, and a control-plane function that resolved
  // an integration runtime's paths against the control plane's own working directory would
  // be answering a question about the wrong process. The authoritative containment check is
  // `main.ts`'s `isInsideRuntimeRoot`, which runs INSIDE the runtime being confined. This one
  // catches the wiring error early, in the process that can still refuse to start.
  const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalisedRoot = normalise(root);
  const normalisedSpecifier = normalise(specifier);
  return (
    normalisedSpecifier.startsWith(`${normalisedRoot}/`) && !normalisedSpecifier.includes('/../')
  );
}

/**
 * Build the registry. THE ONLY WAY TO PRODUCE AN `AdapterRuntimeRegistry`.
 *
 * =================================================================================
 * `§35` — THE OPTION-B TRIGGER CANNOT SILENTLY DISAPPEAR
 *
 * "Add a mechanism/assertion that this trigger cannot silently disappear. If a third adapter
 * is registered under option A: refuse startup/configuration. Likewise a money-moving
 * credential class."
 *
 * Both checks are here, both are refusals to CONSTRUCT, and both throw rather than returning
 * a value — the same discipline `createAdapterRegistry` applies, for the same reason: this
 * is a wiring decision at process start, not a runtime authority decision, and a deployment
 * that has crossed ADR-024's trigger must not start under option A.
 *
 * A THROW IS WHAT MAKES THE TRIGGER LOUD. A refusal value can be ignored by a caller that
 * does not read it; a throw at composition stops the process.
 *
 * =================================================================================
 * v1.3.7 — THE CONJUNCTION, AND WHICHEVER OCCURS FIRST WINS
 *
 * `50 §2g`: option A is permitted only while BOTH hold —
 *
 *   1. fewer than three configured external-write adapter runtimes; AND
 *   2. every configured vendor credential has `credential_risk_class` other than
 *      `MONEY_MOVING`.
 *
 * The count check runs first because it needs no artifact read, and the credential check
 * runs per descriptor. **Neither half weakens the other**: a deployment with one
 * money-moving credential is refused at one adapter, and a deployment with three
 * `READ_ONLY` credentials is refused at the third.
 * =================================================================================
 */
export function createAdapterRuntimeRegistry(
  descriptors: readonly AdapterRuntimeDescriptor[],
  bundle: VerifiedControlArtifactBundle,
): AdapterRuntimeRegistry {
  // ---------------------------------------------------------------------------------
  // ADR-024's SECOND TRIGGER, CHECKED FIRST BECAUSE IT NEEDS NO ARTIFACT READ.
  // ---------------------------------------------------------------------------------
  if (descriptors.length > OPTION_A_MAX_ADAPTER_RUNTIMES) {
    throw new AdapterRuntimeRegistryError(
      'OPTION_B_TRIGGER_ADAPTER_COUNT',
      `${descriptors.length} adapter runtimes were configured; ADR-024 builds the execution ` +
        'proxy (option B) "at the first money-moving credential or the THIRD adapter, ' +
        `whichever comes first", so option A admits at most ${OPTION_A_MAX_ADAPTER_RUNTIMES}. ` +
        'Option B is not implemented. Build it rather than raising this constant',
    );
  }

  const known = catalogueAdapterIdsFrom(bundle);
  const declaration = verifiedCredentialScopes(bundle);
  const byId = new Map<string, AdapterRuntimeDescriptor>();
  const scopeById = new Map<string, VerifiedCredentialScope>();

  for (const descriptor of descriptors) {
    if (!isWellFormedAdapterId(descriptor.adapterId)) {
      throw new AdapterRuntimeRegistryError(
        'ADAPTER_ID_MALFORMED',
        `"${descriptor.adapterId}" does not satisfy the adapter identifier grammar`,
      );
    }
    if (!known.has(descriptor.adapterId)) {
      throw new AdapterRuntimeRegistryError(
        'ADAPTER_NOT_IN_CATALOGUE',
        `"${descriptor.adapterId}" is not an adapter identity the VERIFIED class-3 action ` +
          `catalogue names (SR7, ADR-006, 50 §2a); known: ${[...known].sort().join(', ')}`,
      );
    }
    if (byId.has(descriptor.adapterId)) {
      throw new AdapterRuntimeRegistryError(
        'DUPLICATE_ADAPTER_RUNTIME',
        `two runtimes were configured for adapter "${descriptor.adapterId}"; 23 §7 scopes ` +
          'isolation per adapter, so one credential scope is one runtime',
      );
    }
    for (const specifier of [descriptor.adapterModule, descriptor.secretSourceModule]) {
      if (!specifierIsInsideRoot(descriptor.runtimeRoot, specifier)) {
        throw new AdapterRuntimeRegistryError(
          'MODULE_OUTSIDE_RUNTIME_ROOT',
          `a module configured for "${descriptor.adapterId}" does not resolve inside its ` +
            'declared runtime root; 29 §3.5 requires per-adapter dependency isolation',
        );
      }
    }

    // ---------------------------------------------------------------------------------
    // `50 §2g` — THE SIGNED CLASS-5 RECORD. MISSING FAILS CLOSED.
    // ---------------------------------------------------------------------------------
    const scope = declaration.credentials[descriptor.credentialId];
    if (scope === undefined) {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_NOT_DECLARED',
        `the verified class-5 declaration carries no record for credential ` +
          `"${descriptor.credentialId}"; 50 §2g: a configured vendor credential whose ` +
          'credential_risk_class is absent FAILS CLOSED, and an undeclared credential is ' +
          'not a non-money-moving one by default',
      );
    }
    if (scope.adapter === AUDIT_PLANE_CREDENTIAL_SCOPE) {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_IS_AUDIT_PLANE_SCOPED',
        `credential "${descriptor.credentialId}" is declared with 50 §2g's reserved ` +
          'audit_plane scope; an audit-plane read credential carries no dispatch authority ' +
          "and 48 §3.6's exemption rests on it only ever reading",
      );
    }
    if (scope.adapter !== descriptor.adapterId) {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_ADAPTER_MISMATCH',
        `credential "${descriptor.credentialId}" is bound by the verified class-5 ` +
          `declaration to adapter "${scope.adapter}", and the descriptor configures it for ` +
          `"${descriptor.adapterId}"; 23 §7 scopes isolation per adapter, so a credential ` +
          'presented for a scope it was not declared against is an unreviewed scope',
      );
    }

    // ---------------------------------------------------------------------------------
    // ADR-024's FIRST TRIGGER, FROM `50 §2g` FIELD 6.
    //
    // A LOOKUP, and the comparison is against the one value `§2g` reserves. `READ_ONLY` and
    // `NON_MONETARY_WRITE` both admit option A subject to the count; `MONEY_MOVING` does
    // not, whatever action ACOS intends to dispatch through the adapter.
    // ---------------------------------------------------------------------------------
    if (scope.credentialRiskClass === 'MONEY_MOVING') {
      throw new AdapterRuntimeRegistryError(
        'OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL',
        `credential "${descriptor.credentialId}" is declared MONEY_MOVING by the VERIFIED ` +
          `class-5 artifact, on the provider permissions ` +
          `[${scope.monetaryProviderPermissions.join(', ')}]. ADR-024: the execution proxy ` +
          'is built "at the FIRST money-moving credential or the third adapter, whichever ' +
          'comes first", and option B is not implemented. Option A does not admit this ' +
          'credential — and 50 §2g decides that on what the credential can do at the ' +
          'PROVIDER, not on which action ACOS currently intends to call',
      );
    }

    byId.set(descriptor.adapterId, Object.freeze({ ...descriptor }));
    scopeById.set(descriptor.adapterId, scope);
  }

  const ids = Object.freeze([...byId.keys()].sort());
  return Object.freeze({
    resolve: (adapterId: string): AdapterRuntimeDescriptor | undefined => byId.get(adapterId),
    registeredIds: ids,
    credentialScopeOf: (adapterId: string): VerifiedCredentialScope | undefined =>
      scopeById.get(adapterId),
  });
}

/**
 * PRODUCTION'S OWN RUNTIME REGISTRY. IT IS EMPTY, AND THAT IS THE POINT.
 *
 * The same posture `EMPTY_ADAPTER_REGISTRY` holds for the control-side port, one plane over:
 * `48 §2` rows 1 to 4 are the four integration-plane components that would fill it, and none
 * exists. A production process therefore launches no integration runtime at all.
 *
 * It is a FUNCTION rather than a constant because `createAdapterRuntimeRegistry` requires a
 * verified bundle, and `50 §3f` occasion 1 has not run at module-evaluation time. An empty
 * registry needs no artifact read, so this one never asks for one — which also means the
 * absence is available to a process that has not bootstrapped, and a process that cannot
 * bootstrap cannot dispatch either way.
 */
export function emptyAdapterRuntimeRegistry(): AdapterRuntimeRegistry {
  return Object.freeze({
    resolve: (): AdapterRuntimeDescriptor | undefined => undefined,
    registeredIds: Object.freeze([]),
    credentialScopeOf: (): VerifiedCredentialScope | undefined => undefined,
  });
}
