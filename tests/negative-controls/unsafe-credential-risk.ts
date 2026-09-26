import {
  actionCatalogueEntry,
} from '../../src/kernel/canonicalisation/actionCatalogue.js';
import { ACTION_CLASSES } from '../../src/kernel/canonicalisation/actionClasses.js';
import {
  verifiedCredentialScopes,
  type VerifiedControlArtifactBundle,
} from '../../src/kernel/controlArtifacts/bundle.js';
import type { CredentialRiskClass } from '../../src/kernel/controlArtifacts/credentialRisk.js';
import type {
  AdapterRuntimeDescriptor,
  AdapterRuntimeRegistry,
} from '../../src/integration/control/adapterRuntimeRegistry.js';

/**
 * S1O VULNERABLE CONTROLS 1–4 — THE CREDENTIAL-RISK CLASSIFICATION.
 *
 * **TEST-ONLY. NOTHING HERE IS PRODUCTION CODE AND NOTHING HERE IS EXPORTED FROM `src/`.**
 *
 * =================================================================================
 * `§29` OF THE S1O MANDATE, ITEMS 1–4
 *
 *   1. action-based instead of credential-based money-moving classification
 *   2. mixed-scope credential misclassified non-money
 *   3. missing credential risk defaults safe/false
 *   4. unsigned runtime config chooses risk class
 *
 * "Each must discriminate." A control that cannot produce a DIFFERENT answer from production
 * on the same input proves nothing, so each implementation below is paired in
 * `tests/negative-controls/credential-risk-controls.test.ts` with an input on which it
 * accepts and production refuses.
 * =================================================================================
 */

/**
 * CONTROL 1 — MONEY-MOVING DERIVED FROM THE ACTION, NOT FROM THE CREDENTIAL.
 *
 * =================================================================================
 * WHAT THIS IS, HISTORICALLY
 *
 * **This is S1N's own `derivedCredentialClass`, preserved verbatim in behaviour.** S1N read
 * `50 §2a` field 4 — `carries_vendor_monetary_field` — over every action class the adapter
 * serves, and answered `MONEY_MOVING` if any was true. `S1N-C1` recorded it as an open owner
 * question, and v1.3.7 `50 §2g` ruled it **wrong in kind**:
 *
 *   "MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER. IT
 *    IS NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL."
 *
 * =================================================================================
 * WHY IT DISCRIMINATES ON THIS REPOSITORY'S OWN CATALOGUE
 *
 * `campaign.budget.set` declares `carries_vendor_monetary_field: false`, so this function
 * answers `NON_MONETARY` for EVERY `mock_ads` credential — including
 * `mock_ads.budget_manage`, whose signed class-5 record declares the provider permission
 * `campaign.budget.set` as monetary under `§2g` clause 9 ("increase a budget, spend cap,
 * credit line, or analogous provider-side authority that permits additional spend").
 *
 * **SAME ADAPTER, SAME ACTION CATALOGUE, DIFFERENT ANSWER.** That is the discrimination, and
 * it is not a contrived input: it is the deployed artifact set.
 * =================================================================================
 */
export function unsafeActionDerivedCredentialClass(
  adapterId: string,
  bundle: VerifiedControlArtifactBundle,
): 'NON_MONETARY' | 'MONEY_MOVING' {
  for (const actionClass of ACTION_CLASSES) {
    const entry = actionCatalogueEntry(actionClass, bundle);
    if (entry.adapter !== adapterId) continue;
    // THE VIOLATION: the operand is the ACTION's vendor request, not the CREDENTIAL's
    // provider permissions. It cannot see a permission ACOS never intends to use.
    if (entry.carriesVendorMonetaryField) return 'MONEY_MOVING';
  }
  return 'NON_MONETARY';
}

/**
 * CONTROL 2 — A MIXED-SCOPE CREDENTIAL CLASSIFIED BY WHAT ACOS CONFIGURED.
 *
 * =================================================================================
 * `§8`'s REQUIRED ATTACK, VERBATIM
 *
 *   "One provider credential authorizes: `email.send`; `payment.refund`. ACOS currently
 *    tries to configure only `email.send`. **Unsafe implementation examines current action
 *    and says NON_MONETARY.** Production examines credential capability envelope:
 *    `MONEY_MOVING` and requires Option B. Must discriminate."
 *
 * This function is that unsafe implementation, stated as generally as the attack is: given a
 * credential's full envelope and the ONE permission ACOS intends to use, it classifies on the
 * intended permission alone. `50 §2g`'s maximum-privilege rule says the opposite — "the class
 * is the highest reachable, never the lowest, never the average and **never the intended**".
 *
 * The deployed `synthetic_esp.mixed_send` record is the attack input: `mail.send` plus
 * `payment.refund`, with `payment.refund` named monetary. This function called with
 * `intendedPermission = 'mail.send'` answers `NON_MONETARY_WRITE`; the signed record says
 * `MONEY_MOVING` and production refuses.
 * =================================================================================
 */
export function unsafeIntendedPermissionRiskClass(
  credentialId: string,
  intendedPermission: string,
  bundle: VerifiedControlArtifactBundle,
): CredentialRiskClass {
  const scope = verifiedCredentialScopes(bundle).credentials[credentialId];
  if (scope === undefined) return 'NON_MONETARY_WRITE';
  // THE VIOLATION: the envelope is narrowed to the permission ACOS means to call before the
  // classification runs, so a refund scope sitting beside a send scope is invisible.
  const monetary = scope.monetaryProviderPermissions.includes(intendedPermission);
  if (monetary) return 'MONEY_MOVING';
  return scope.externalMutationCapable ? 'NON_MONETARY_WRITE' : 'READ_ONLY';
}

/**
 * CONTROL 3 — A MISSING CLASSIFICATION DEFAULTING TO THE SAFE-LOOKING VALUE.
 *
 * =================================================================================
 * WHY THIS IS THE MOST LIKELY REAL DEFECT OF THE FOUR
 *
 * `50 §2g`: "There is no `UNKNOWN`, and **a missing classification is not a permissive
 * default.** A configured vendor credential whose `credential_risk_class` is absent,
 * unparseable, or outside this closed set **FAILS CLOSED**."
 *
 * The permissive default is not usually written as a decision. It is written as a `??`, by
 * someone who needed a value and picked the one that let the deployment start — and it is
 * indistinguishable from correct behaviour on every input where the record EXISTS. It
 * discriminates only on the input a reviewer is least likely to construct: a credential
 * nobody declared.
 *
 * Production's `createAdapterRuntimeRegistry` throws `CREDENTIAL_NOT_DECLARED`; this
 * function returns `NON_MONETARY_WRITE` and the deployment starts under option A holding a
 * credential nobody classified.
 * =================================================================================
 */
export function unsafeMissingRiskDefaultsSafe(
  credentialId: string,
  bundle: VerifiedControlArtifactBundle,
): CredentialRiskClass {
  const scope = verifiedCredentialScopes(bundle).credentials[credentialId];
  // THE VIOLATION: absent means safe.
  return scope?.credentialRiskClass ?? 'NON_MONETARY_WRITE';
}

/**
 * CONTROL 4 — THE RISK CLASS CHOSEN BY UNSIGNED RUNTIME CONFIGURATION.
 *
 * =================================================================================
 * `50 §2g`'s PROHIBITION, VERBATIM
 *
 *   "no provider response, account response, adapter self-description, **environment
 *    variable**, **caller parameter** or model output may supply, override or widen any of
 *    the seven fields."
 *
 * `§5` of the mandate says the same in the other direction: "Do NOT put the classification
 * in: environment; caller parameters; adapter process self-description; model output;
 * provider response. [...] Do not invent unsigned authority."
 *
 * This function reads the class from an environment variable, falling back to the signed
 * record only when the variable is absent — which is the shape this defect always takes,
 * because an override that ALWAYS won would be obvious and one that never won would be
 * pointless. The discrimination is that a deployment can set
 * `ACOS_CREDENTIAL_RISK_CLASS_OVERRIDE=NON_MONETARY_WRITE` and admit
 * `mock_processor.refund` — a credential the signed artifact declares `MONEY_MOVING` — under
 * option A.
 *
 * **THE ENVIRONMENT IS NOT SIGNED.** Whoever can set a variable on the control process can
 * decide whether ADR-024's execution proxy is required, which is the one question ADR-024
 * exists to answer.
 * =================================================================================
 */
export const UNSAFE_RISK_OVERRIDE_ENV_KEY = 'ACOS_CREDENTIAL_RISK_CLASS_OVERRIDE';

export function unsafeEnvironmentChosenRiskClass(
  credentialId: string,
  bundle: VerifiedControlArtifactBundle,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CredentialRiskClass | null {
  // THE VIOLATION: unsigned configuration outranks a signed, dual-signed, manifest-bound
  // artifact.
  const override = environment[UNSAFE_RISK_OVERRIDE_ENV_KEY];
  if (override === 'READ_ONLY' || override === 'NON_MONETARY_WRITE' || override === 'MONEY_MOVING') {
    return override;
  }
  const scope = verifiedCredentialScopes(bundle).credentials[credentialId];
  return scope === undefined ? null : scope.credentialRiskClass;
}

/**
 * A registry that admits every descriptor, whatever its credential says.
 *
 * The S1O counterpart of `unsafeAdapterRuntimeRegistry`: no count check, no class-5 read,
 * no option-B trigger. Used where a control needs a registry to EXIST so a later assertion
 * has something to compare production against.
 */
export function unsafeCredentialBlindRuntimeRegistry(
  descriptors: readonly AdapterRuntimeDescriptor[],
): AdapterRuntimeRegistry {
  const byId = new Map<string, AdapterRuntimeDescriptor>();
  for (const descriptor of descriptors) {
    // THE VIOLATION: no credential is looked up at all, so no trigger can fire.
    byId.set(descriptor.adapterId, descriptor);
  }
  return Object.freeze({
    resolve: (adapterId: string): AdapterRuntimeDescriptor | undefined => byId.get(adapterId),
    registeredIds: Object.freeze([...byId.keys()].sort()),
    credentialScopeOf: () => undefined,
  });
}
