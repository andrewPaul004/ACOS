import { join } from 'node:path';

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
        .filter(
          (site) =>
            site.annotation.kind !== 'AUTHORISED' &&
            site.annotation.kind !== 'EXEMPT' &&
            // v1.3.8, `48 §8` — the ONE declared ingress, and only the two site kinds its
            // declaration may cover. Anything else annotated INGRESS is still listed here.
            !(
              site.annotation.kind === 'INGRESS' &&
              (site.kind === 'INGRESS_LISTENER' || site.kind === 'NETWORK_PRIMITIVE')
            ),
        )
        .map((site) => `${site.file}:${site.line} (${site.kind})`),
    ).toEqual([]);
    expect(report.ingressViolations).toEqual([]);
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

    /*
     * S1P AMENDS THE SECOND HALF OF THIS ASSERTION, OUT LOUD.
     *
     * It read: "AND EVERY ONE IS TEST_ONLY. `§18`: a synthetic provider 'remains TEST-ONLY
     * and is not a production perimeter entry.'" That was true while every provider client
     * in the repository was SYNTHETIC. S1P adds one that is not.
     *
     * So the rule is restated as what `§18` actually says — a site under `tests/` is
     * TEST_ONLY and never a production entry — and the new obligation is added beside it:
     * the real client is a PRODUCTION entry and must carry an `authorisation_ref`. The
     * amended pair is strictly stronger than the sentence it replaces.
     */
    for (const site of providerSites.filter((entry) => entry.file.startsWith('tests'))) {
      expect(site.scope, site.file).toBe('TEST_ONLY');
    }

    const sendGridSends = providerSites.filter((site) =>
      site.file.includes(join('validation', 'sendgrid', 'integration')),
    );
    expect(sendGridSends.length).toBeGreaterThanOrEqual(2);
    for (const site of sendGridSends) {
      expect(site.scope, site.file).toBe('PRODUCTION');
      // A SEND carries an `authorisation_ref`, never an exemption. `48 §4` item 2:
      // "Production external writes require authorisation_ref."
      expect(site.annotation.kind, site.file).toBe('AUTHORISED');
    }
    expect(report.productionAuthorised).toBeGreaterThanOrEqual(2);
  });

  it('`§18`: no broad exemption is admissible, and the banned list is enforced by value', () => {
    for (const banned of ['INTERNAL', 'TEST', 'TEST_ONLY', 'TODO', 'NONE']) {
      expect(BANNED_EXEMPTION_REASONS).toContain(banned);
    }
  });

  it(`the roots cover the control plane, BOTH synthetic planes and the real validation package`, () => {
    /*
     * S1O ADDS `tests/audit-plane/`, and the reason is `48 §3`'s own: "An exemption is not a
     * hole. It is a **named, annotated, reviewed** hole, and the difference is that a
     * reviewer can find it." `48 §2` row 13 exempts audit-plane vendor reads from carrying
     * an `authorisation_ref`; it does not exempt them from being ENUMERATED, and an
     * unenumerated read is unreviewed rather than exempt.
     */
    /*
     * S1P ADDS `validation/`, AND AMENDS THIS ACCEPTED ASSERTION OUT LOUD.
     *
     * `45 §3` warns about accepted boundary assertions changed quietly, so: the fourth root
     * is the Twilio SendGrid non-production validation package, it holds the first REAL
     * vendor clients this repository has ever contained, and its first path segment is
     * deliberately NOT `tests` — `§18` scopes the `TEST_ONLY` carve-out to a "test synthetic
     * provider", and a client that reaches `api.sendgrid.com` is not one. Its sites are
     * therefore PRODUCTION perimeter entries, which is a WIDENING of what this check counts
     * rather than a relaxation of what it requires.
     */
    expect([...DEFAULT_PERIMETER_ROOTS]).toEqual([
      'src',
      expect.stringContaining('integration-plane'),
      expect.stringContaining('audit-plane'),
      'validation',
    ]);
  });

  it('`48 §2` row 13 — the audit READ sites are enumerated, annotated and EXEMPT', async () => {
    const report = await scanPerimeter();
    // Non-vacuous: the sites exist, and they are read sites rather than write sites.
    expect(report.providerReadTotal).toBeGreaterThanOrEqual(2);
    expect(report.providerReadUnannotated).toBe(0);

    const reads = report.sites.filter((site) => site.kind === 'PROVIDER_READ_CLIENT');
    for (const site of reads) {
      /*
       * S1P AMENDS THE SCOPE HALF OF THIS ASSERTION TOO, AND FOR THE SAME REASON.
       *
       * It read "TEST_ONLY, always". S1P's SendGrid Email Activity reader is a real
       * provider read at PRODUCTION scope; the ANNOTATION requirement is unchanged and is
       * the half that carries the meaning — `48 §2` row 13's exemption is `48 §3.6`'s and
       * no other, so the reason and the ticket are still asserted by value on every read
       * site in either scope.
       */
      expect(site.annotation.kind, site.file).toBe('EXEMPT');
      if (site.annotation.kind === 'EXEMPT') {
        expect(site.annotation.reason).toBe('audit_plane_read_only');
        expect(site.annotation.ticket).toBe('48-3-6');
      }
    }
    // The synthetic reader stays TEST_ONLY; the real one is a PRODUCTION entry.
    for (const site of reads.filter((entry) => entry.file.startsWith('tests'))) {
      expect(site.scope, site.file).toBe('TEST_ONLY');
    }
    expect(
      reads.some(
        (site) =>
          site.scope === 'PRODUCTION' && site.file.includes(join('validation', 'sendgrid')),
      ),
    ).toBe(true);

    // AND NO SEND CLIENT LIVES IN THE AUDIT PLANE. This is the assertion `§16`'s "no send
    // operation" reduces to at the perimeter: the scanner finds zero `sendToProvider*`
    // declarations or calls under `tests/audit-plane/`.
    const auditSends = report.sites.filter(
      (site) =>
        site.kind === 'PROVIDER_CLIENT' &&
        (site.file.includes('audit-plane') ||
          site.file.includes(join('validation', 'sendgrid', 'audit'))),
    );
    expect(auditSends).toEqual([]);

    /*
     * S1P EXTENDS THIS ASSERTION TO THE REAL AUDIT PACKAGE, which is where it matters most:
     * `36 §13` needs an attempted-write probe, and `§8.2` forbids that probe from becoming a
     * normal audit capability. It lives in `validation/sendgrid/harness/`, it is a PRODUCTION
     * perimeter entry in its own right, and it carries its OWN exemption reason so a reviewer
     * can never mistake it for a read.
     */
    const scopeProbes = report.sites.filter(
      (site) =>
        site.annotation.kind === 'EXEMPT' &&
        site.annotation.reason === 'credential_scope_conformance_probe',
    );
    expect(scopeProbes.length).toBeGreaterThanOrEqual(1);
    for (const site of scopeProbes) {
      expect(site.file, 'a scope probe outside the harness').toContain(
        join('validation', 'sendgrid', 'harness'),
      );
      if (site.annotation.kind === 'EXEMPT') expect(site.annotation.ticket).toBe('36-13');
    }
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
