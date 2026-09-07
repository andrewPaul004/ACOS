import type { PolicyDenyCode } from './errors.js';
import { PER_ACTION_POLICY_ID } from './policyArtifacts.js';

/**
 * Cedar's determining policies -> `26 §7`'s denial terminal.
 *
 * ---------------------------------------------------------------------------------
 * THE MAPPING IS A CLOSED REGISTRY, AND IT READS NO AMOUNT
 *
 * Cedar returns `diagnostics.reason` — the set of policies that determined the outcome. On
 * a DENY, `reason` holds the `forbid` policies that fired; it is empty when the denial is
 * simply the absence of a satisfied `permit`.
 *
 * So the category is decided by WHICH POLICY FIRED, never by re-inspecting an operand. A
 * mapping that re-read `total_exposure` and compared it to `25.00` would be a second
 * implementation of the cap sitting outside the policy artifact, and the two would drift.
 * This function has no access to any amount and takes none.
 *
 * `FORBID_CATEGORY` is EXACT. An unrecognised determining policy is not guessed at and is
 * not defaulted into the nearest category — it is `null`, and `cedarEngine.ts` turns that
 * into a defect. A `forbid` deployed without a registered category would otherwise be
 * reported to a worker under whichever code happened to be first.
 * ---------------------------------------------------------------------------------
 */
const FORBID_CATEGORY: ReadonlyMap<string, PolicyDenyCode> = new Map<string, PolicyDenyCode>([
  // `26 §7` step M -> D11. `26 §11` P1's operand is `exposure.total_exposure`.
  [PER_ACTION_POLICY_ID, 'PER_ACTION'],
]);

export interface DenialCategoryResolution {
  readonly code: PolicyDenyCode | null;
  /** Determining policy ids with no registered category. Non-empty means "defect". */
  readonly unregistered: readonly string[];
}

/**
 * Resolve a Cedar denial's category.
 *
 * With no determining policy the denial is `26 §7` step I's `D7 — DENY: NO_GRANT`: no
 * policy path admitted the request. `36 §3`, verbatim: "An action class with no policy is a
 * deny by default (SR7)".
 *
 * With one or more determining `forbid`s, the FIRST registered category in the artifact's
 * declared order wins, deterministically. S1D deploys exactly one `forbid`, so the ordering
 * rule is stated rather than exercised; it exists so that adding a second `forbid` is a
 * decision about precedence rather than an accident of set iteration.
 */
export function resolveDenialCategory(
  determiningPolicies: readonly string[],
): DenialCategoryResolution {
  if (determiningPolicies.length === 0) {
    return { code: 'NO_GRANT', unregistered: [] };
  }
  const unregistered = determiningPolicies.filter((id) => !FORBID_CATEGORY.has(id));
  if (unregistered.length > 0) {
    return { code: null, unregistered: [...unregistered].sort() };
  }
  const ordered = [...determiningPolicies].sort();
  return { code: FORBID_CATEGORY.get(ordered[0]!)!, unregistered: [] };
}

/** The registered forbid ids, for the artifact-integrity test. */
export function registeredForbidPolicyIds(): readonly string[] {
  return [...FORBID_CATEGORY.keys()].sort();
}
