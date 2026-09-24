import {
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  actionCatalogueEntry,
} from '../canonicalisation/actionCatalogue.js';
import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import type { ExternalEffectAdapter } from './adapterPort.js';

/**
 * TRUSTED CLOSED ADAPTER RESOLUTION — `§8` AND `§13` OF THE S1J MANDATE.
 *
 * =================================================================================
 * WHAT THE ARCHITECTURE REQUIRES, AND THE ATTACK IT CLOSES
 *
 * `26 §5`: recoverability and the class's execution metadata are "assigned per action
 * class in the catalogue, not per request, and **never by a model**". `25 §7`, on the
 * outbox scope predicate: "**The predicate is derived from the closed action catalogue's
 * execution metadata** — the class's declared adapter and method — so it is a property of
 * the catalogue that a model cannot choose and a caller cannot pass."
 *
 * `§8`'s required attack: "authorised effect says adapter A; attacker/caller requests mock
 * adapter B with different semantics."
 *
 * THE ATTACK IS UNREPRESENTABLE, AND NOT MERELY REFUSED. Follow the identity backwards:
 *
 *   1. `resolveAdapterFor` takes the adapter identity FROM THE DISPATCH ENVELOPE.
 *   2. The envelope's `adapter` is `dispatch_outbox.adapter`, read from the committed row.
 *   3. `0010`'s composite foreign key makes that column a MEMBER of a key into `effect`,
 *      so the only admissible value is the one the committed effect holds.
 *   4. `effect.adapter` was written by the S1F authorising transaction from
 *      the verified catalogue entry's `adapter`.
 *
 * There is no `adapter` parameter and no `adapterId` parameter on any production function
 * in this directory. A caller may supply a REGISTRY — that is how a test installs the
 * deterministic mock — and supplying one containing adapter B under key B changes nothing,
 * because the gateway asks the registry for key A.
 * =================================================================================
 */

/** The refusals this module can produce. DATA, not exception strings — `26 §2.2`. */
export const ADAPTER_RESOLUTION_REFUSALS = [
  /**
   * No adapter is registered under the identity the committed effect carries.
   *
   * THIS IS THE DEFAULT STATE OF PRODUCTION AT S1J. `EMPTY_ADAPTER_REGISTRY` holds
   * nothing, so a production process that has installed no registry cannot dispatch
   * anything at all — which is the correct posture for a slice with no real adapter.
   */
  'ADAPTER_NOT_REGISTERED',
  /**
   * `25 §7`'s EM6 criterion: "A provider offering neither an idempotency header nor a
   * delivery-event webhook nor a queryable message log **cannot serve an IRRECOVERABLE
   * class**."
   *
   * Enforced BEFORE invocation, so the ineligible call never happens. `§13`'s required
   * negative control is the unsafe gateway that dispatches anyway.
   */
  'ADAPTER_INELIGIBLE_FOR_IRRECOVERABLE',
] as const;

export type AdapterResolutionRefusal = (typeof ADAPTER_RESOLUTION_REFUSALS)[number];

export type AdapterResolution =
  | { readonly kind: 'RESOLVED'; readonly adapter: ExternalEffectAdapter }
  | {
      readonly kind: 'REFUSED';
      readonly reason: AdapterResolutionRefusal;
      readonly detail: string;
    };

/**
 * A frozen, validated map from catalogue adapter identity to trusted implementation.
 *
 * It is a nominal type rather than a bare `Map` so a caller cannot hand the gateway an
 * arbitrary object literal that happens to have a `get` method. The only way to obtain one
 * is `createAdapterRegistry`, which validates every entry.
 */
export interface AdapterRegistry {
  readonly resolve: (adapterId: string) => ExternalEffectAdapter | undefined;
  readonly registeredIds: readonly string[];
}

/** Every adapter identity the closed catalogue actually names, `INTERNAL_ONLY` excluded. */
export function catalogueAdapterIds(): readonly string[] {
  const ids = new Set<string>();
  for (const actionClass of ACTION_CLASSES) {
    const adapter = actionCatalogueEntry(actionClass).adapter;
    if (adapter !== INTERNAL_ONLY_ADAPTER) ids.add(adapter);
  }
  return [...ids].sort();
}

/**
 * Build a registry. THE ONLY WAY TO PRODUCE AN `AdapterRegistry`.
 *
 * Two validations, and both are refusals to CONSTRUCT rather than checks at dispatch time:
 *
 *   1. An adapter's self-declared `adapterId` must equal the key it is registered under.
 *      Without this, an adapter could be reached under one identity while believing itself
 *      to be another, which is `§8`'s substitution wearing a registry as a disguise.
 *
 *   2. The key must be an adapter identity the CLOSED CATALOGUE names. `SR7` and ADR-006
 *      make the catalogue "the single extension point", so a registry entry for an
 *      identity no action class declares is dead weight at best and a second dispatch
 *      surface at worst.
 *
 * `throw` rather than a refusal value, deliberately: this is a wiring error at process
 * start, not a runtime authority decision, and a process wired with a mismatched adapter
 * must not start.
 */
export function createAdapterRegistry(
  entries: readonly ExternalEffectAdapter[],
): AdapterRegistry {
  const known = new Set(catalogueAdapterIds());
  const byId = new Map<string, ExternalEffectAdapter>();
  for (const adapter of entries) {
    if (!known.has(adapter.adapterId)) {
      throw new Error(
        `adapter "${adapter.adapterId}" is not an adapter identity the closed action ` +
          `catalogue names (SR7, ADR-006); known: ${[...known].sort().join(', ')}`,
      );
    }
    if (byId.has(adapter.adapterId)) {
      throw new Error(
        `two adapters registered under identity "${adapter.adapterId}"; the resolution ` +
          'must be deterministic (26 §5)',
      );
    }
    byId.set(adapter.adapterId, adapter);
  }
  const ids = [...byId.keys()].sort();
  return Object.freeze({
    resolve: (adapterId: string): ExternalEffectAdapter | undefined => byId.get(adapterId),
    registeredIds: Object.freeze(ids),
  });
}

/**
 * PRODUCTION'S REGISTRY AT S1J. IT IS EMPTY, AND THAT IS THE POINT.
 *
 * `§7` of the mandate forbids a real adapter, and `48 §2` rows 1 to 4 are the four
 * integration-plane components that would fill this — none of which exists. A production
 * process therefore cannot invoke anything: `resolveAdapterFor` refuses
 * `ADAPTER_NOT_REGISTERED` for every effect.
 *
 * `no-real-transport-boundary.test.ts` asserts that `src/` contains no
 * `ExternalEffectAdapter` implementation and that this registry is empty, so a future
 * slice that adds a real adapter has to change a test that says so out loud.
 */
export const EMPTY_ADAPTER_REGISTRY: AdapterRegistry = createAdapterRegistry([]);

/**
 * `25 §7`'s EM6 predicate, as a pure function over trusted adapter metadata.
 *
 * "A provider offering neither an idempotency header nor a delivery-event webhook nor a
 * queryable message log cannot serve an IRRECOVERABLE class."
 *
 * READ AS A DISJUNCTION, WHICH IS THE SENTENCE'S OWN SHAPE: "neither X nor Y nor Z" is
 * false as soon as one holds, so ONE capability suffices. REVERSIBLE and COMPENSABLE
 * classes carry no capability requirement in v1.3.4 — `25 §7`'s general disqualifier
 * ("where the adapter's API offers no idempotency, the effect class is downgraded: it
 * cannot be autonomous, it requires approval") is an AUTONOMY and APPROVAL consequence
 * evaluated at `26 §7`, not a dispatch-time refusal, and S1J does not relitigate it here.
 */
export function adapterIsEligibleFor(
  adapter: ExternalEffectAdapter,
  recoverability: Recoverability,
): boolean {
  if (recoverability !== 'IRRECOVERABLE') return true;
  return adapter.resolutionCapabilities.length > 0;
}

/**
 * Resolve the trusted adapter for one dispatch, from the authoritative identity.
 *
 * THE SIGNATURE IS THE SECURITY PROPERTY. Both operands come from the committed row the
 * envelope was built from, and neither is a caller's value. There is no options object, no
 * preference list and no fallback: an unresolvable identity is a refusal, never a
 * substitution — the same discipline `24 §3` K4 states for the canonicaliser's selector
 * ("It denies. It does not approximate.").
 */
export function resolveAdapterFor(
  registry: AdapterRegistry,
  identity: { readonly adapter: string; readonly recoverability: Recoverability },
): AdapterResolution {
  const adapter = registry.resolve(identity.adapter);
  if (adapter === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'ADAPTER_NOT_REGISTERED',
      detail:
        `no trusted adapter is registered for identity "${identity.adapter}"; ` +
        `registered: [${registry.registeredIds.join(', ')}]`,
    };
  }
  if (!adapterIsEligibleFor(adapter, identity.recoverability)) {
    return {
      kind: 'REFUSED',
      reason: 'ADAPTER_INELIGIBLE_FOR_IRRECOVERABLE',
      detail:
        `adapter "${adapter.adapterId}" declares no resolution primitive and cannot ` +
        'serve an IRRECOVERABLE class: 25 §7 requires an idempotency header, a ' +
        'delivery-event webhook or a queryable message log (EM6)',
    };
  }
  return { kind: 'RESOLVED', adapter };
}
