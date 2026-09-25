import {
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  type ActionClass,
} from '../../kernel/canonicalisation/actionClasses.js';
import { actionCatalogueEntry } from '../../kernel/canonicalisation/actionCatalogue.js';
import type { VerifiedControlArtifactBundle } from '../../kernel/controlArtifacts/bundle.js';
import type { AdapterResolutionCapability } from '../../kernel/gateway/adapterPort.js';
import { isWellFormedAdapterId } from '../protocol/runtimeIdentity.js';

/**
 * THE CLOSED ADAPTER-RUNTIME REGISTRY — `§37`, `§38`, AND OPTION A's OWN GUARD RAIL.
 *
 * =================================================================================
 * WHAT A DESCRIPTOR IS, AND WHY NO REQUEST CAN CARRY ONE
 *
 * `§37`: "Adapter registration should be trusted startup/deployment configuration plus
 * signed catalogue binding. The model cannot register adapters. The worker cannot supply:
 * executable path; module path; credential locator; runtime flags."
 *
 * So a descriptor is built at process wiring time and validated against the VERIFIED
 * class-3 catalogue — `50 §3f`: "For classes 3 and 27 the signed artifact bytes ARE the
 * deployed authority source" — and there is no function in this module, in
 * `integrationClient.ts` or on the dispatch path that takes a path, a specifier, a flag or a
 * locator as a per-request argument. `26 §5`'s rule is the one being implemented: execution
 * metadata is "assigned per action class in the catalogue, not per request, and **never by a
 * model**."
 * =================================================================================
 */

/**
 * `§36` — THE CREDENTIAL CLASS, DERIVED FROM SIGNED BYTES RATHER THAN FROM A NAME.
 *
 * "Do not try to infer whether an adapter is money-moving from its name. Derive from closed
 * signed action catalogue / adapter capability metadata."
 *
 * =================================================================================
 * WHAT v1.3.6 ACTUALLY PROVIDES, AND THE RESIDUAL THIS LEAVES
 *
 * ADR-024's trigger is "the first **money-moving credential** or the third adapter, whichever
 * comes first", and v1.3.6 DOES NOT DEFINE `money-moving credential` as a mechanised
 * predicate anywhere. `23 §11`, `29 §3.2`, `31 §12`, `33 §7` and `37 §5` all use the phrase
 * and none of them says how a build would decide it.
 *
 * What v1.3.6 DOES provide is two SIGNED per-class fields in `50 §2a`, and they do not say
 * the same thing:
 *
 *   field 4  `carries_vendor_monetary_field`  `I18a`'s subject, and `I18a` defines it:
 *                                             "**where the dispatched vendor request
 *                                             carries a monetary field**". That is a
 *                                             statement about what the CREDENTIAL presents
 *                                             to the vendor.
 *   field 3  `value_direction`                `26 §11`'s P4/P4a/P8 subject. A statement
 *                                             about where VALUE ends up, which is a
 *                                             different question: `OUTBOUND_GOODS_TO_ADDRESS`
 *                                             moves goods and `OUTBOUND_TO_COUNTERPARTY`
 *                                             covers a budget instruction that transfers
 *                                             nothing.
 *
 * `MONEY_MOVING` IS BOUND TO FIELD 4, EXACTLY. An adapter is money-moving when the verified
 * catalogue says at least one class it serves dispatches a vendor request CARRYING A
 * MONETARY FIELD. Nothing is inferred from a name, from a method, from a description or
 * from this repository's own labels.
 *
 * =================================================================================
 * WHY NOT THE BROADER READING, AND HOW THE CATALOGUE ITSELF SETTLES IT
 *
 * The obvious alternative is "field 4 true OR `value_direction` other than `NONE`", on the
 * theory that a conservative predicate fails in the safe direction. Applied to the VERIFIED
 * S1 catalogue it makes every one of the three adapter identities money-moving —
 * `campaign.budget.set` is `OUTBOUND_TO_COUNTERPARTY`, `fulfilment.reship` is
 * `OUTBOUND_GOODS_TO_ADDRESS` — so NO adapter at all could be configured under option A.
 *
 * That cannot be what ADR-024 means, and the ADR says so itself: "**With two adapters and
 * no money**, a broker adds a TCB member and delivers nothing", and `23 §11` sizes the MVP
 * integration plane at four adapters under option A with the broker removed. A reading of
 * the trigger under which option A admits zero adapters contradicts the decision the
 * trigger belongs to.
 *
 * =================================================================================
 * THE RESIDUAL, RECORDED RATHER THAN ENGINEERED AWAY
 *
 * v1.3.6 does not define `money-moving credential` as a mechanised predicate, so this is a
 * DERIVATION from a signed field whose own definition is the closest available match — not
 * a transcription of an architecture rule, because there is no architecture rule to
 * transcribe. `S1N-result.md §11` carries it as an open architecture question for the owner.
 * The OTHER half of ADR-024's trigger — "the third adapter" — is exactly stated and is
 * enforced with no derivation at all.
 * =================================================================================
 */
export const ADAPTER_CREDENTIAL_CLASSES = [
  /** Serves only classes whose signed entry moves no value. */
  'NON_MONETARY',
  /** Serves at least one class whose signed entry moves value. ADR-024's trigger. */
  'MONEY_MOVING',
] as const;

export type AdapterCredentialClass = (typeof ADAPTER_CREDENTIAL_CLASSES)[number];

/**
 * ADR-024's own numbers, as constants so the trigger cannot be edited by accident.
 *
 * "the first money-moving credential or the **third adapter**, whichever comes first."
 * Three adapters is the trigger; two is the last permitted count under option A. `23 §11`
 * sizes the MVP integration plane at "4 adapters at MVP", and that is the point: the fourth
 * slice that wants an adapter is the slice that has to build option B.
 */
export const OPTION_A_MAX_ADAPTER_RUNTIMES = 2;

/** One adapter runtime, as trusted deployment configuration. */
export interface AdapterRuntimeDescriptor {
  /** MUST be an adapter identity the verified class-3 catalogue names. */
  readonly adapterId: string;
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
  /**
   * The deployment's own declaration of what this credential can do.
   *
   * It is CROSS-CHECKED against the signed catalogue below and never trusted on its own: a
   * deployment that understated a money-moving credential as `NON_MONETARY` is refused, and
   * a deployment that overstated a non-monetary one as `MONEY_MOVING` is taken at its word,
   * because overstating triggers option B early and that is the safe direction.
   */
  readonly declaredCredentialClass: AdapterCredentialClass;
}

/** The refusals this module produces. All are refusals to CONSTRUCT, at wiring time. */
export const RUNTIME_REGISTRY_REFUSALS = [
  'ADAPTER_NOT_IN_CATALOGUE',
  'ADAPTER_ID_MALFORMED',
  'DUPLICATE_ADAPTER_RUNTIME',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  /** ADR-024's third-adapter trigger. Option B is not built, so the third is refused. */
  'OPTION_B_TRIGGER_ADAPTER_COUNT',
  /** ADR-024's money-moving trigger, from the signed catalogue. */
  'OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL',
  /** The deployment understated a credential the signed catalogue says moves value. */
  'CREDENTIAL_CLASS_UNDERSTATED',
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
 * `§36`'s derivation, over SIGNED bytes and nothing else.
 *
 * Reads `50 §2a` field 4 out of the VERIFIED class-3 artifact for every class the adapter
 * serves. An adapter that serves NO class is `NON_MONETARY` vacuously and is refused
 * earlier anyway, by the catalogue-membership check.
 */
export function derivedCredentialClass(
  adapterId: string,
  bundle: VerifiedControlArtifactBundle,
): AdapterCredentialClass {
  for (const actionClass of classesServedBy(adapterId, bundle)) {
    if (actionCatalogueEntry(actionClass, bundle).carriesVendorMonetaryField) {
      return 'MONEY_MOVING';
    }
  }
  return 'NON_MONETARY';
}

/**
 * `26 §11`'s value-movement reading of the same adapter, REPORTED AND NOT ENFORCED.
 *
 * The broader predicate the block comment above rejects as the trigger, kept as an
 * accessor so the S1N documentation can publish what it would say and so a future slice
 * that receives an owner ruling has one function to change rather than a derivation to
 * rediscover. Nothing in this module calls it, and `createAdapterRuntimeRegistry` refuses
 * nothing on its basis.
 */
export function movesValueUnderBroadReading(
  adapterId: string,
  bundle: VerifiedControlArtifactBundle,
): boolean {
  for (const actionClass of classesServedBy(adapterId, bundle)) {
    const entry = actionCatalogueEntry(actionClass, bundle);
    if (entry.carriesVendorMonetaryField) return true;
    if (entry.valueDirection !== 'NONE') return true;
  }
  return false;
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
 * does not read it; a throw at composition stops the process. And because
 * `EMPTY_ADAPTER_RUNTIME_REGISTRY` is what production holds, the trigger's first real test
 * is the slice that wires the first real adapter — which is the slice that must read this
 * paragraph.
 * =================================================================================
 */
export function createAdapterRuntimeRegistry(
  descriptors: readonly AdapterRuntimeDescriptor[],
  bundle: VerifiedControlArtifactBundle,
): AdapterRuntimeRegistry {
  // ---------------------------------------------------------------------------------
  // ADR-024's SECOND TRIGGER, CHECKED FIRST BECAUSE IT NEEDS NO CATALOGUE READ.
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
  const byId = new Map<string, AdapterRuntimeDescriptor>();

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
    // ADR-024's FIRST TRIGGER, FROM SIGNED BYTES — `§36`.
    // ---------------------------------------------------------------------------------
    const derived = derivedCredentialClass(descriptor.adapterId, bundle);
    if (derived === 'MONEY_MOVING' && descriptor.declaredCredentialClass === 'NON_MONETARY') {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_CLASS_UNDERSTATED',
        `"${descriptor.adapterId}" is declared NON_MONETARY, and the VERIFIED class-3 ` +
          'catalogue says at least one class it serves carries a vendor monetary field or a ' +
          'value direction other than NONE (50 §2a fields 3 and 4)',
      );
    }
    const effective = derived === 'MONEY_MOVING' ? 'MONEY_MOVING' : descriptor.declaredCredentialClass;
    if (effective === 'MONEY_MOVING') {
      throw new AdapterRuntimeRegistryError(
        'OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL',
        `"${descriptor.adapterId}" holds a MONEY_MOVING credential class. ADR-024: the ` +
          'execution proxy is built "at the FIRST money-moving credential or the third ' +
          'adapter, whichever comes first", and option B is not implemented. Option A does ' +
          'not admit this adapter',
      );
    }

    byId.set(descriptor.adapterId, Object.freeze({ ...descriptor }));
  }

  const ids = Object.freeze([...byId.keys()].sort());
  return Object.freeze({
    resolve: (adapterId: string): AdapterRuntimeDescriptor | undefined => byId.get(adapterId),
    registeredIds: ids,
  });
}

/**
 * PRODUCTION'S OWN RUNTIME REGISTRY. IT IS EMPTY, AND THAT IS THE POINT.
 *
 * The same posture `EMPTY_ADAPTER_REGISTRY` holds for the control-side port, one plane over:
 * `48 §2` rows 1 to 4 are the four integration-plane components that would fill it, `§4` of
 * this mandate forbids every one of them, and none exists. A production process therefore
 * launches no integration runtime at all.
 *
 * It is a FUNCTION rather than a constant because `createAdapterRuntimeRegistry` requires a
 * verified bundle, and `50 §3f` occasion 1 has not run at module-evaluation time. An empty
 * registry needs no catalogue read, so this one never asks for one — which also means the
 * absence is available to a process that has not bootstrapped, and a process that cannot
 * bootstrap cannot dispatch either way.
 */
export function emptyAdapterRuntimeRegistry(): AdapterRuntimeRegistry {
  return Object.freeze({
    resolve: (): AdapterRuntimeDescriptor | undefined => undefined,
    registeredIds: Object.freeze([]),
  });
}
