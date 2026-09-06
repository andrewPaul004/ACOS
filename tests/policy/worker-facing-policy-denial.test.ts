import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { PolicyEvaluationDefect } from '../../src/kernel/policy/errors.js';
import {
  projectPolicyDecisionToWorker,
  projectedPolicyOutcome,
} from '../../src/kernel/policy/workerFacingPolicyDenial.js';
import { canonicalEffectAt } from '../support/policyFixture.js';

/**
 * The worker-facing policy surface stays coarse.
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * The S1D mandate: "Raw Cedar diagnostics, policy source, entity dumps, canonicalisation
 * `message`, or `auditNote` must not become worker-visible."
 */

const engine = new PolicyEngine();

const denied = engine.evaluate(canonicalEffectAt({ vendorAmount: '25.00', retainedFee: '1.03' }));
const permitted = engine.evaluate(canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' }));

describe('the projection has exactly one field, and it is the category', () => {
  it('a PER_ACTION denial projects to one field', () => {
    const worker = projectPolicyDecisionToWorker(denied);
    expect(worker).toEqual({ deny: 'PER_ACTION' });
    expect(Object.keys(worker)).toEqual(['deny']);
  });

  it('a NO_GRANT denial projects to one field', () => {
    const noGrant = engine.evaluate(
      canonicalEffectAt({
        vendorAmount: '10.00',
        retainedFee: '1.03',
        principalRole: 'market_researcher',
      }),
    );
    expect(projectPolicyDecisionToWorker(noGrant)).toEqual({ deny: 'NO_GRANT' });
  });

  it('a permit projects to one field, and it carries no lineage', () => {
    const worker = projectPolicyDecisionToWorker(permitted);
    expect(worker).toEqual({ permit: true });
    expect(Object.keys(worker)).toEqual(['permit']);
  });

  it('every projected value is FROZEN and is a different object from the decision', () => {
    for (const decision of [denied, permitted]) {
      const worker = projectPolicyDecisionToWorker(decision);
      expect(Object.isFrozen(worker)).toBe(true);
      expect(worker).not.toBe(decision);
    }
  });
});

describe('nothing the mandate names can cross the boundary', () => {
  const rendered = JSON.stringify(projectPolicyDecisionToWorker(denied));

  it('no Cedar diagnostics — no determining policy ids', () => {
    expect(denied.lineage.determiningPolicies).not.toHaveLength(0);
    for (const id of denied.lineage.determiningPolicies) {
      expect(rendered).not.toContain(id);
    }
  });

  it('no policy source, no entity dump', () => {
    for (const needle of ['forbid', 'permit(', 'decimal', 'Acos::', 'entities', 'context']) {
      expect(rendered).not.toContain(needle);
    }
  });

  it('no audit note', () => {
    expect(denied.decision === 'DENY' && denied.auditNote.length).toBeGreaterThan(0);
    expect(rendered).not.toContain('Cedar');
  });

  it('no policy_version and no constructor_version', () => {
    // Not secret, but a control-artifact identifier: a worker that can watch the digest
    // change can detect a policy deploy. `26 §11` puts it on the DECISION RECORD.
    expect(rendered).not.toContain(denied.lineage.policyVersion);
    expect(rendered).not.toContain(denied.lineage.constructorVersion.constructorId);
  });

  it('and no amount, no limit and no near-miss', () => {
    expect(rendered).not.toMatch(/\d/);
  });
});

describe('the S1C asymmetry is preserved — a DEFECT is rethrown, not projected', () => {
  it('`projectedPolicyOutcome` lets a PolicyEvaluationDefect through', () => {
    // `enumeration/workerFacingDenial.ts`, verbatim: "Swallowing an internal defect into
    // `DENY: SELECTOR` would hide a critical incident behind a routine category."
    expect(() =>
      projectedPolicyOutcome(() => {
        throw new PolicyEvaluationDefect('CEDAR_EVALUATION_ERROR', 'a broken policy set');
      }),
    ).toThrow(PolicyEvaluationDefect);
  });

  it('a permit passes through unchanged', () => {
    expect(projectedPolicyOutcome(() => permitted)).toEqual({ permit: true });
  });

  it('and it has no catch clause at all, which is the structural form of that', () => {
    const code = strip(
      readFileSync(join('src', 'kernel', 'policy', 'workerFacingPolicyDenial.ts'), 'utf8'),
    );
    expect(code).not.toContain('catch');
    expect(code).not.toContain('try');
  });
});

describe('no production module hands a worker a raw policy decision', () => {
  it('the projection reads ONLY `decision` and `code`', () => {
    const code = strip(
      readFileSync(join('src', 'kernel', 'policy', 'workerFacingPolicyDenial.ts'), 'utf8'),
    );
    expect(code).toContain('decision.code');
    expect(code).not.toContain('.auditNote');
    expect(code).not.toContain('.lineage');
    expect(code).not.toContain('.determiningPolicies');
    expect(code).not.toContain('.policyVersion');
  });

  it('and the accepted S1C rule still holds across the whole tree after S1D', () => {
    // `tests/canonicalisation/worker-facing-denial.test.ts` asserts "nothing in src/ returns
    // `.auditNote` … outward". S1D adds a second `auditNote`-bearing type, so the rule is
    // re-run here over the policy tree specifically, with no exemption added to the accepted
    // test's permitted list.
    for (const file of sourceFiles(join('src', 'kernel', 'policy'))) {
      expect(strip(readFileSync(file, 'utf8')), `${file} reads .auditNote`).not.toContain(
        '.auditNote',
      );
    }
  });
});

function strip(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}
