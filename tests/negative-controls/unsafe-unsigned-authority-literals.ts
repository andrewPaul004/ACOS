/**
 * TEST-ONLY VULNERABLE CONTROLS 11 AND 12 — the unsigned literal that stayed authoritative.
 *
 * =================================================================================
 * THE DEFECT `50 §3c` NAMES IN WORDS
 *
 *   "**A signed control artifact and a separate hard-coded production literal may not both
 *    be authority sources**, with equality asserted only in a test; that arrangement leaves
 *    the unsigned literal authoritative, because the test is not in the authority path."
 *
 * and `50 §3f`'s single-source rule:
 *
 *   "**For classes 3 and 27 the signed artifact bytes ARE the deployed authority source.**
 *    [...] **It may not maintain a signed artifact value and a hard-coded production literal
 *    as two authority sources with equality asserted only in tests** [...] Migrating today's
 *    frozen literals onto the verified bundle is **required S1K runtime work**."
 *
 * =================================================================================
 * WHAT MAKES THIS DISCRIMINATE RATHER THAN MERELY ILLUSTRATE
 *
 * The fixture sets the signed artifact and the literal to DIFFERENT values. A verifier is
 * then not what is being tested — both implementations verify the same valid package — and
 * the only question is WHICH VALUE THE AUTHORITY PATH USED:
 *
 *   unsafe      reads the literal below      and returns the literal's value
 *   production  reads the verified bundle    and returns the signed artifact's value
 *
 * If production were still reading a literal, the two would agree and the test would fail
 * to discriminate. That is the shape `§30` and `§57` of the S1K mandate require.
 * =================================================================================
 */

/**
 * The v1.3.5 class-3 literals, as `actionCatalogue.ts` carried them before this slice, with
 * `fulfilment.reship`'s unit count and adapter left exactly where an editor could move them.
 *
 * `51 §2.3` declares `1` for every current IRRECOVERABLE class. A tampered deployment that
 * wanted a reship to cost NOTHING against the MIE ceiling would edit this literal — and
 * under the unsafe reader that is all it would take.
 */
export const UNSAFE_UNSIGNED_ACTION_CATALOGUE: Readonly<
  Record<string, { readonly irrecoverableUnits: bigint; readonly adapter: string; readonly recoverability: string }>
> = Object.freeze({
  'campaign.pause': Object.freeze({
    irrecoverableUnits: 0n,
    adapter: 'mock_ads',
    recoverability: 'REVERSIBLE',
  }),
  'refund.create': Object.freeze({
    irrecoverableUnits: 0n,
    adapter: 'mock_processor',
    recoverability: 'COMPENSABLE',
  }),
  'fulfilment.reship': Object.freeze({
    irrecoverableUnits: 0n,
    adapter: 'internal_only',
    recoverability: 'REVERSIBLE',
  }),
  'campaign.budget.set': Object.freeze({
    irrecoverableUnits: 0n,
    adapter: 'mock_ads',
    recoverability: 'COMPENSABLE',
  }),
});

/** VULNERABLE CONTROL 11: the catalogue consumer that reads the unsigned literal. */
export function unsafeIrrecoverableUnitsFor(actionClass: string): bigint {
  return UNSAFE_UNSIGNED_ACTION_CATALOGUE[actionClass]!.irrecoverableUnits;
}

/** VULNERABLE CONTROL 11 (second reader): the outbox scope predicate off the literal. */
export function unsafeRequiresExternalDispatchFor(actionClass: string): boolean {
  return UNSAFE_UNSIGNED_ACTION_CATALOGUE[actionClass]!.adapter !== 'internal_only';
}

/** VULNERABLE CONTROL 11 (third reader): recoverability off the literal. */
export function unsafeRecoverabilityFor(actionClass: string): string {
  return UNSAFE_UNSIGNED_ACTION_CATALOGUE[actionClass]!.recoverability;
}

/**
 * The v1.3.3 class-27 literals, as `degradedModeThresholds.ts` carried them, with the
 * approval floor moved to a MORE PERMISSIVE value.
 *
 * `50 §2c` quantity 3 declares `USD 20.00`, strict `>`. A floor of `$500.00` means almost
 * nothing is above it, so almost nothing needs approval inside a declared mirror state —
 * which is `30 §5.1` item 4 row 2 silently disabled.
 */
export const UNSAFE_UNSIGNED_DEGRADED_APPROVAL_FLOOR_MINOR_UNITS = 50000n;

/** `PT15M` widened to `PT4H`: the escalation that never fires. */
export const UNSAFE_UNSIGNED_MIRROR_LAG_CRITICAL_MS = 4 * 60 * 60 * 1000;

/** `PT30M` widened to `PT8H`: `30 §5.1a`'s FULL-HALT POSTURE, removed. */
export const UNSAFE_UNSIGNED_FULL_HALT_MS = 8 * 60 * 60 * 1000;

/** VULNERABLE CONTROL 12: the degraded-mode predicate off the unsigned literal. */
export function unsafeIsAboveDegradedApprovalFloor(totalExposureMinorUnits: bigint): boolean {
  return totalExposureMinorUnits > UNSAFE_UNSIGNED_DEGRADED_APPROVAL_FLOOR_MINOR_UNITS;
}

/** VULNERABLE CONTROL 12 (second reader): the full-halt posture off the unsigned literal. */
export function unsafeIsFullHaltPosture(continuousUnreachabilityMs: number): boolean {
  return continuousUnreachabilityMs >= UNSAFE_UNSIGNED_FULL_HALT_MS;
}
