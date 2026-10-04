import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';

import {
  ACTION_CLASSES,
  actionCatalogueEntry,
  enumerationMaxAgeSecondsFor,
  irrecoverableUnitsFor,
  reasonCodeScopeFor,
  requiresExternalDispatchFor,
  semanticOptionDigestFieldsFor,
} from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  bundleArtifactIdentities,
  verifiedActionCatalogue,
  verifiedDegradedModeConfiguration,
} from '../../src/kernel/controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import {
  classifyMirrorLag,
  corroborationSignalMaxAgeMs,
  degradedModeTiming,
  degradedPerActionApprovalFloor,
  isAboveDegradedApprovalFloor,
  isFullHaltPosture,
} from '../../src/kernel/mirror/degradedModeThresholds.js';
import { money } from '../../src/kernel/exposure/money.js';
import {
  UNSAFE_UNSIGNED_ACTION_CATALOGUE,
  UNSAFE_UNSIGNED_DEGRADED_APPROVAL_FLOOR_MINOR_UNITS,
  UNSAFE_UNSIGNED_FULL_HALT_MS,
  unsafeIrrecoverableUnitsFor,
  unsafeIsAboveDegradedApprovalFloor,
  unsafeIsFullHaltPosture,
  unsafeRequiresExternalDispatchFor,
} from '../negative-controls/unsafe-unsigned-authority-literals.js';
import { verifyFixtureBundle, buildControlArtifactFixture, withArtifactBytes } from '../support/controlArtifactFixture.js';


/**
 * The COARSE message is all a worker ever sees, so a test that wants to know WHICH rule
 * refused reads the structured `detail` — which is internal, and is the whole point of
 * `controlArtifacts/errors.ts`.
 */
function detailOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) return error.detail;
    throw error;
  }
  throw new Error('expected a control-artifact integrity failure and none was raised');
}

/**
 * `50 §2a` AND `50 §2c` — class 3 and class 27 authority comes from the SIGNED ARTIFACT.
 *
 * =================================================================================
 * `50 §3f`'s single source of authority, verbatim
 *
 *   "**For classes 3 and 27 the signed artifact bytes ARE the deployed authority source.**
 *    Production code may parse them into frozen typed structures **after** verification.
 *    **It may not maintain a signed artifact value and a hard-coded production literal as
 *    two authority sources with equality asserted only in tests** — that leaves the unsigned
 *    literal authoritative in the path that matters."
 *
 * So every assertion below that reads an authority value reads it through a function that
 * resolves the ACTIVE VERIFIED BUNDLE, and every one of them is paired with the
 * corresponding unsigned literal in
 * `tests/negative-controls/unsafe-unsigned-authority-literals.ts` — which carries a
 * DIFFERENT value. If production still held a literal the two would agree and these cases
 * would prove nothing.
 * =================================================================================
 */

/**
 * `51 §2.3`'s table, HAND-AUTHORED from the architecture rather than read from the artifact.
 *
 * `§58` of the S1K mandate forbids deriving an expected authority value from the thing under
 * test. This transcription is the same one `tests/integration/exposure/mie-reservation.test.ts`
 * has carried since S1J, restated here because these cases are about WHERE the value comes
 * from rather than about the ledger.
 */
const SPEC_51_2_3: Readonly<Record<string, bigint>> = Object.freeze({
  'campaign.pause': 0n,
  'refund.create': 0n,
  'fulfilment.reship': 1n,
  'campaign.budget.set': 0n,
  // S1P. `email.send` is IRRECOVERABLE — the accepted architecture's own words, "an email
  // send cannot be unsent" — and `51 §2.3`'s rule for every IRRECOVERABLE class in the
  // current catalogue is ONE unit. The class-3 parser enforces the same coherence over the
  // verified bytes, so this transcription and the artifact cannot drift apart silently.
  'email.send': 1n,
});

/** `26 §5` and `26 §11.2`, hand-authored. */
const SPEC_RECOVERABILITY: Readonly<Record<string, string>> = Object.freeze({
  'campaign.pause': 'REVERSIBLE',
  'refund.create': 'COMPENSABLE',
  'fulfilment.reship': 'IRRECOVERABLE',
  'campaign.budget.set': 'COMPENSABLE',
  'email.send': 'IRRECOVERABLE',
});

describe('CLASS 3 — the verified artifact is the authority source', () => {
  it('every catalogue member resolves through the verified bundle', () => {
    const catalogue = verifiedActionCatalogue(activeVerifiedControlArtifacts());
    expect([...catalogue.actionClasses]).toEqual([...ACTION_CLASSES]);
    for (const actionClass of ACTION_CLASSES) {
      expect(catalogue.entries[actionClass]!.actionClass).toBe(actionClass);
    }
  });

  it('and the values match the HAND-AUTHORED architecture transcription', () => {
    for (const actionClass of ACTION_CLASSES) {
      expect(irrecoverableUnitsFor(actionClass), actionClass).toBe(SPEC_51_2_3[actionClass]);
      expect(actionCatalogueEntry(actionClass).recoverability, actionClass).toBe(
        SPEC_RECOVERABILITY[actionClass],
      );
    }
  });

  it('`actionCatalogue.ts` holds NO catalogue literal any more', () => {
    const source = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'actionCatalogue.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // The values that decide authority are gone; only accessors remain.
    for (const needle of [
      'ACTION_CATALOGUE',
      'REASON_CODE_SCOPES',
      'irrecoverableUnits:',
      'recoverability:',
      'valueDirection:',
      'adapter:',
      'settlementTolerance:',
    ]) {
      expect(source, `actionCatalogue.ts still declares ${needle}`).not.toContain(needle);
    }
  });

  it('`50 §2a` record 12 — the reason-code scope map is verified content', () => {
    // Hand-authored from `26 §2.2`'s grouping, not read from the artifact.
    expect(reasonCodeScopeFor('CUSTOMER_REPORTED_DAMAGE')).toBe('GOODS_FAULT');
    expect(reasonCodeScopeFor('ITEM_RETURNED')).toBe('GOODS_RETURNED');
    expect(reasonCodeScopeFor('DUPLICATE_CHARGE')).toBe('BILLING_ERROR');
  });

  it('`50 §2a` record 13 — the semantic option digest fields are verified content', () => {
    expect([...semanticOptionDigestFieldsFor('refund.create')]).toEqual([
      'line_id',
      'parent_transaction_id',
      'amount',
      'instrument',
      'reason_code_scope',
    ]);
  });

  it('`50 §2a` record 14 — the enumeration max_age is verified content', () => {
    for (const actionClass of ACTION_CLASSES) {
      expect(enumerationMaxAgeSecondsFor(actionClass), actionClass).toBe(120);
    }
  });

  it('VULNERABLE CONTROL 11 — the unsigned literal says something DIFFERENT, and discriminates', () => {
    // The signed artifact says `fulfilment.reship` costs ONE irrecoverable unit and runs
    // against `mock_commerce`. The unsigned literal says ZERO and `internal_only`, which
    // would remove the class from the MIE ceiling AND from the outbox entirely.
    expect(unsafeIrrecoverableUnitsFor('fulfilment.reship')).toBe(0n);
    expect(irrecoverableUnitsFor('fulfilment.reship')).toBe(1n);

    expect(unsafeRequiresExternalDispatchFor('fulfilment.reship')).toBe(false);
    expect(requiresExternalDispatchFor('fulfilment.reship')).toBe(true);

    expect(UNSAFE_UNSIGNED_ACTION_CATALOGUE['fulfilment.reship']!.recoverability).toBe(
      'REVERSIBLE',
    );
    expect(actionCatalogueEntry('fulfilment.reship').recoverability).toBe('IRRECOVERABLE');
  });

  it('TAMPER — a signed artifact with a DIFFERENT value moves production, and only that', () => {
    // The authority really does follow the signed bytes: a re-signed catalogue saying `7`
    // units produces `7`. That is what makes the previous case a statement about provenance
    // rather than about a constant that happens to be right.
    const fixture = buildControlArtifactFixture({
      mutate: (artifacts) =>
        withArtifactBytes(artifacts, 3, (bytes) =>
          Buffer.from(
            bytes
              .toString('utf8')
              .replace('"irrecoverable_units": "1"', '"irrecoverable_units": "7"'),
            'utf8',
          ),
        ),
    });
    const bundle = verifyFixtureBundle(fixture);
    expect(irrecoverableUnitsFor('fulfilment.reship', bundle)).toBe(7n);
    // And the ACTIVE bundle is untouched, because nothing published the candidate.
    expect(irrecoverableUnitsFor('fulfilment.reship')).toBe(1n);
  });

  it('TAMPER — `51 §2.3`’s coherence rule is enforced over the VERIFIED bytes', () => {
    // A signed catalogue declaring a REVERSIBLE class with a positive unit count is refused
    // at verification, so the incoherent artifact never becomes a bundle at all.
    expect(
      detailOf(() =>
        verifyFixtureBundle(
          buildControlArtifactFixture({
            mutate: (artifacts) =>
              withArtifactBytes(artifacts, 3, (bytes) =>
                Buffer.from(
                  bytes
                    .toString('utf8')
                    .replace(
                      '"recoverability": "IRRECOVERABLE"',
                      '"recoverability": "REVERSIBLE"',
                    ),
                  'utf8',
                ),
              ),
          }),
        ),
      ),
    ).toMatch(/REVERSIBLE and declares irrecoverable_units = 1/);
  });
});

describe('CLASS 27 — the verified artifact is the authority source', () => {
  it('the four quantities come from the verified bundle, at `50 §2c`’s declared values', () => {
    const config = verifiedDegradedModeConfiguration(activeVerifiedControlArtifacts());
    // Hand-authored from `50 §2c`'s table.
    expect(config.mirrorLagCriticalThresholdMs).toBe(15 * 60 * 1000);
    expect(config.auditUnreachableFullHaltThresholdMs).toBe(30 * 60 * 1000);
    expect(config.degradedPerActionApprovalFloorMinorUnits).toBe(2000n);
    expect(config.corroborationSignalMaxAgeMs).toBe(5 * 60 * 1000);
  });

  it('and the accessors agree', () => {
    expect(degradedPerActionApprovalFloor()).toBe(money('20.00'));
    expect(degradedModeTiming().mirrorLagCriticalMs).toBe(900_000);
    expect(degradedModeTiming().auditUnreachableFullHaltMs).toBe(1_800_000);
    expect(corroborationSignalMaxAgeMs()).toBe(300_000);
  });

  it('`degradedModeThresholds.ts` holds NO threshold literal any more', () => {
    const source = readFileSync(join('src', 'kernel', 'mirror', 'degradedModeThresholds.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const needle of [
      'DEGRADED_PER_ACTION_APPROVAL_FLOOR',
      'DEGRADED_MODE_TIMING',
      '2000n',
      '15 * 60 * 1000',
      '30 * 60 * 1000',
    ]) {
      expect(source, `degradedModeThresholds.ts still declares ${needle}`).not.toContain(needle);
    }
  });

  it('`mirrorState.ts` no longer declares `SIGNAL_MAX_AGE_MS`', () => {
    const source = readFileSync(join('src', 'kernel', 'mirror', 'mirrorState.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toContain('SIGNAL_MAX_AGE_MS =');
    expect(source).not.toContain('5 * 60 * 1000');
  });

  it('the boundary semantics are as `50 §2c` declares them — one strict, two inclusive', () => {
    // Quantity 3: STRICT. `$20.00` exactly is NOT above the floor; one minor unit more is.
    expect(isAboveDegradedApprovalFloor(money('20.00'))).toBe(false);
    expect(isAboveDegradedApprovalFloor(money('20.01'))).toBe(true);
    // Quantity 1: INCLUSIVE.
    expect(classifyMirrorLag(899_999)).toBe('WITHIN_THRESHOLD');
    expect(classifyMirrorLag(900_000)).toBe('CRITICAL');
    // Quantity 2: INCLUSIVE.
    expect(isFullHaltPosture(1_799_999)).toBe(false);
    expect(isFullHaltPosture(1_800_000)).toBe(true);
  });

  it('VULNERABLE CONTROL 12 — the unsigned literal is MORE PERMISSIVE, and discriminates', () => {
    // The unsigned floor is $500.00, so a $100.00 exposure is not above it and needs no
    // approval inside a declared mirror state. The signed floor is $20.00, and it is.
    expect(UNSAFE_UNSIGNED_DEGRADED_APPROVAL_FLOOR_MINOR_UNITS).toBe(50000n);
    expect(unsafeIsAboveDegradedApprovalFloor(10_000n)).toBe(false);
    expect(isAboveDegradedApprovalFloor(money('100.00'))).toBe(true);

    // The unsigned full-halt threshold is eight hours, so a forty-minute outage is not the
    // posture. The signed one is thirty minutes, and it is.
    expect(UNSAFE_UNSIGNED_FULL_HALT_MS).toBe(8 * 60 * 60 * 1000);
    expect(unsafeIsFullHaltPosture(40 * 60 * 1000)).toBe(false);
    expect(isFullHaltPosture(40 * 60 * 1000)).toBe(true);
  });

  it('TAMPER — a re-signed configuration with a MORE PERMISSIVE floor moves production', () => {
    const fixture = buildControlArtifactFixture({
      mutate: (artifacts) =>
        withArtifactBytes(artifacts, 27, (bytes) =>
          Buffer.from(
            bytes
              .toString('utf8')
              .replace(
                '"degraded_per_action_approval_floor_monetary": "20.00"',
                '"degraded_per_action_approval_floor_monetary": "500.00"',
              ),
            'utf8',
          ),
        ),
    });
    const bundle = verifyFixtureBundle(fixture);
    expect(isAboveDegradedApprovalFloor(money('100.00'), bundle)).toBe(false);
    // The ACTIVE bundle is unmoved.
    expect(isAboveDegradedApprovalFloor(money('100.00'))).toBe(true);
  });

  it('TAMPER — mutating the signed artifact WITHOUT new signatures is refused', () => {
    const baseline = buildControlArtifactFixture();
    const onDisk = buildControlArtifactFixture({ pinOverride: baseline.manifestId });
    const path = join(onDisk.controlRoot, 'class-27.degraded-mode-config.json');
    const bytes = readFileSync(path, 'utf8').replace('"20.00"', '"500.00"');
    require('node:fs').writeFileSync(path, bytes, 'utf8');
    expect(() => verifyFixtureBundle(onDisk)).toThrow();
  });

  it('a signed configuration whose halt threshold is NOT the longer one is refused', () => {
    // `30 §5.1` item 5 requires the halt threshold to be "a longer threshold". The check is
    // arithmetic over the VERIFIED values, at verification time.
    expect(
      detailOf(() =>
        verifyFixtureBundle(
          buildControlArtifactFixture({
            mutate: (artifacts) =>
              withArtifactBytes(artifacts, 27, (bytes) =>
                Buffer.from(
                  bytes
                    .toString('utf8')
                    .replace(
                      '"audit_unreachable_full_halt_threshold": "PT30M"',
                      '"audit_unreachable_full_halt_threshold": "PT10M"',
                    ),
                  'utf8',
                ),
              ),
          }),
        ),
      ),
    ).toMatch(/full_halt_threshold at or below/);
  });
});

describe('CLASS 17 — RETIRED, and still retired', () => {
  it('no class-17 artifact exists in the deployed package', () => {
    const files = require('node:fs').readdirSync(join('artifacts', 'control')) as string[];
    expect(files.some((name) => name.startsWith('class-17'))).toBe(false);
  });

  it('no manifest entry for class 17 exists in the required set', () => {
    const classes = bundleArtifactIdentities(activeVerifiedControlArtifacts()).map(
      (identity) => identity.artifactClass,
    );
    expect(classes).not.toContain(17);
    expect(classes).toEqual([2, 3, 5, 19, 20, 24, 27, 28]);
  });

  it('`window_registry` remains RUNTIME STATE, written by migrations and not by a signature', () => {
    // `50 §2d`: "PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL
    // ARTIFACTS. They are runtime authoritative database state." The table is created by a
    // migration and its integrity is governed by `50 §3h`'s named controls.
    const migrations = require('node:fs').readdirSync(join('src', 'db', 'migrations')) as string[];
    const sources = migrations.map((name) =>
      readFileSync(join('src', 'db', 'migrations', name), 'utf8'),
    );
    expect(sources.some((sql) => sql.includes('window_registry'))).toBe(true);
    // And no production module treats a window row as a signed artifact.
    const controlArtifactSources = (
      require('node:fs').readdirSync(join('src', 'kernel', 'controlArtifacts')) as string[]
    )
      .filter((name) => name.endsWith('.ts'))
      .map((name) =>
        readFileSync(join('src', 'kernel', 'controlArtifacts', name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      );
    // The trust chain never QUERIES runtime state at all: it has no pool, no client and no
    // SQL. `50 §3h`: "`I19` DOES NOT AUTHENTICATE ORDINARY MUTABLE RUNTIME DATABASE STATE".
    // (`verifier.ts` NAMES `window_registry` in the refusal it raises when a manifest tries
    // to revive class 17, which is the opposite of reading one.)
    for (const source of controlArtifactSources) {
      for (const needle of ['SELECT', 'INSERT', 'UPDATE', 'client.query', 'Pool', 'pg']) {
        expect(source, `a control-artifact module reaches for ${needle}`).not.toContain(needle);
      }
    }
  });

  it('`irrecoverable_units` is class-3 content, wherever it is stored', () => {
    // `50 §2d`'s split table: `51 §2.3`'s per-action-class count moves to class 3.
    const catalogue = verifiedActionCatalogue(activeVerifiedControlArtifacts());
    expect(catalogue.entries['fulfilment.reship']!.irrecoverableUnits).toBe(1n);
  });
});
