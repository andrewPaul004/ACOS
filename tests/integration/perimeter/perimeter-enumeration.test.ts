import { describe, expect, it } from 'vitest';

import {
  BANNED_EXEMPTION_REASONS,
  DEFAULT_PERIMETER_ROOTS,
  renderPerimeterReport,
  scanPerimeter,
} from '../../../tools/perimeter/perimeterScan.js';
import {
  computeAllClosures,
  evaluateSeparation,
  renderPackagingManifest,
} from '../../../tools/integration-packaging/packagingManifest.js';

/**
 * `§17`, `§18` — THE I24 CI ENUMERATION, AS A TEST THAT FAILS THE BUILD.
 *
 * =================================================================================
 * WHY IT IS A TEST AND A COMMAND
 *
 * `§17`: "Unknown/unannotated call: **BUILD FAILURE.**" `48 §7` question 4 asks whether the
 * check "has been disabled, weakened, or worked around for any build", and calls it "the one
 * that matters most, and the one a reviewer is least likely to ask."
 *
 * A check that lives only in a command anyone can forget to run is exactly the shape that
 * question is about. So the same scan runs here, inside `npm run verify`, and
 * `npm run verify:perimeter` exists for a reviewer who wants the artifact.
 * =================================================================================
 */

describe('`§17` — EVERY EXTERNAL-CLIENT CALL SITE IS ENUMERATED AND ANNOTATED', () => {
  it('the repository perimeter PASSES, with zero unannotated sites in either scope', async () => {
    const report = await scanPerimeter();
    expect(
      report.sites
        .filter((site) => site.annotation.kind !== 'AUTHORISED' && site.annotation.kind !== 'EXEMPT')
        .map((site) => `${site.file}:${site.line} (${site.kind})`),
    ).toEqual([]);
    expect(report.productionUnannotated).toBe(0);
    expect(report.testOnlyUnannotated).toBe(0);
    expect(report.pass).toBe(true);
  });

  it('and the enumeration is NOT VACUOUS — it finds the synthetic provider clients', async () => {
    /*
     * `§17` permits it: "S1N synthetic adapter may be included." This is the assertion that
     * makes the check mean something today, because `src/` contains no vendor call at all —
     * `48 §2` rows 1 to 4 are the four integration-plane components and none exists. A
     * scanner that reported zero sites everywhere would pass forever and would report zero
     * on the day the first real one appeared, if its patterns did not see it.
     */
    const report = await scanPerimeter();
    const providerSites = report.sites.filter((site) => site.kind === 'PROVIDER_CLIENT');
    expect(providerSites.length).toBeGreaterThanOrEqual(4);

    // Two declarations and two call sites, one pair per adapter — `48 §4` item 1's "one
    // vendor-HTTP client per adapter", with each adapter's sites in its OWN root.
    const byRoot = (segment: string): number =>
      providerSites.filter((site) => site.file.includes(segment)).length;
    expect(byRoot('adapterA')).toBeGreaterThanOrEqual(2);
    expect(byRoot('adapterB')).toBeGreaterThanOrEqual(2);

    // AND EVERY ONE IS TEST_ONLY. `§18`: a synthetic provider "remains TEST-ONLY and is not
    // a production perimeter entry."
    expect(providerSites.every((site) => site.scope === 'TEST_ONLY')).toBe(true);
  });

  it('`§18`: no broad exemption is admissible, and the banned list is enforced by value', () => {
    for (const banned of ['INTERNAL', 'TEST', 'TEST_ONLY', 'TODO', 'NONE']) {
      expect(BANNED_EXEMPTION_REASONS).toContain(banned);
    }
  });

  it('the roots cover the control plane and the synthetic integration plane', () => {
    expect([...DEFAULT_PERIMETER_ROOTS]).toEqual(['src', expect.stringContaining('integration-plane')]);
  });

  it('and the rendered artifact is deterministic', async () => {
    const first = renderPerimeterReport(await scanPerimeter());
    const second = renderPerimeterReport(await scanPerimeter());
    expect(first).toBe(second);
    expect(first).toContain('RESULT: PASS');
  });
});

describe('`§46` — THE PACKAGING MANIFEST IS DETERMINISTIC AND IT GATES', () => {
  it('the manifest renders identically across runs', async () => {
    const closures = await computeAllClosures();
    const findings = evaluateSeparation(closures);
    const first = renderPackagingManifest(closures, findings);
    const second = renderPackagingManifest(await computeAllClosures(), findings);
    expect(first).toBe(second);
    expect(first).toContain('RESULT: PASS');
  });

  it('and the CONTROL closure genuinely reaches the Effect Gateway, so the scope is real', async () => {
    const closures = await computeAllClosures();
    const control = closures.find((closure) => closure.name === 'CONTROL_PLANE')!;
    expect(control.modules).toContain('src/kernel/gateway/effectGateway.ts');
    expect(control.modules).toContain('src/integration/control/integrationClient.ts');
    expect(control.modules.length).toBeGreaterThan(20);
  });
});
