import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTION_CLASSES } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  PROHIBITED_ACTION_CLASSES,
  evaluateCategoricalProhibition,
  isCategoricallyProhibited,
  prohibitedClassesInCatalogue,
} from '../../src/kernel/authority/prohibitions.js';
import { AUTHORITY_STEPS, S1E_GATE_STEPS, stepPrecedes } from '../../src/kernel/authority/steps.js';
import { PreReservationAuthorityPipeline } from '../../src/kernel/authority/preReservation.js';
import { projectPreReservationToWorker } from '../../src/kernel/authority/workerFacingAuthorityDenial.js';

/**
 * RULES ABOUT THE S1E SOURCE TREE, ASSERTED AGAINST THE S1E SOURCE TREE.
 *
 * The technique is S1A's, S1B's and S1D's, quoted from
 * `tests/canonicalisation/source-rules.test.ts`: "A rule written only as a comment is a rule
 * a future edit breaks silently; a rule with a test is a rule."
 *
 * The rules here are the S1E mandate's "no authority field escape hatches" section, plus the
 * two ordering properties `26 §7` states in prose.
 */

function walk(dir: string, suffix = '.ts'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name), suffix)
      : entry.name.endsWith(suffix)
        ? [join(dir, entry.name)]
        : [],
  );
}

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * A call to a bare function `name(`, not a method `.name(`.
 *
 * The distinction matters twice below. `Set.prototype.add` is not `money.add`, and
 * `PreconditionEvaluator.fetch` is step G's own name in `26 §7` ("Fetch preconditions from
 * state store") rather than the global `fetch`. A rule that could not tell them apart would
 * either be unsatisfiable or would be relaxed into uselessness the first time it fired.
 */
function callsBareFunction(code: string, name: string): boolean {
  return new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(code);
}

const AUTHORITY_DIR = join('src', 'kernel', 'authority');
const authoritySource = walk(AUTHORITY_DIR);
const SRC_DIR = join('src');
const allSource = walk(SRC_DIR);

describe('rule 1 — there is no generic authority bag anywhere in the authority tree', () => {
  /**
   * The S1E mandate names the shapes, and `26 §2.3` gives the reason: "Any free text with
   * authority. The engine reads no prose."
   *
   * A generic map is worse than free text, because it is typed enough to look safe and open
   * enough to carry anything. Cedar closes it at the policy boundary — `acos.cedarschema`
   * rejects an undeclared context attribute at parse time — and this rule closes it at the
   * authority boundary, where there is no schema to do it.
   */
  it('no `Record<string, unknown>` and no index signature appears in the authority tree', () => {
    for (const file of authoritySource) {
      const code = codeOf(file);
      expect(code, `${file} carries a generic record`).not.toMatch(
        /Record\s*<\s*string\s*,\s*unknown\s*>/,
      );
      expect(code, `${file} carries a generic record`).not.toMatch(
        /Record\s*<\s*string\s*,\s*any\s*>/,
      );
      expect(code, `${file} carries an index signature`).not.toMatch(
        /\[\s*\w+\s*:\s*string\s*\]\s*:/,
      );
      expect(code, `${file} carries a Map-typed public surface`).not.toMatch(
        /readonly\s+\w+\s*:\s*(Readonly)?Map</,
      );
    }
  });

  it('no field named for a generic bag appears in the authority tree', () => {
    // `policyContext`, `extra`, `metadata`, `attributes`, `options` as an authority carrier.
    for (const file of authoritySource) {
      const code = codeOf(file);
      for (const needle of [
        'policyContext',
        'readonly extra',
        'readonly metadata',
        'readonly attributes',
        'readonly custom',
        'readonly overrides',
      ]) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
    }
  });
});

describe('rule 2 — no authority operand is a caller-supplied parameter', () => {
  /**
   * `26 §1` Corollary 3, verbatim: "the request must be built by the ceiling's enforcer, not
   * by its subject. […] A limit evaluated against a figure the model supplied is not a
   * limit."
   *
   * Each name below is an operand `26 §7` requires the kernel to derive. The rule is that
   * none of them appears as a FIELD of a type the pipeline accepts from a caller.
   */
  it('the pipeline\'s caller-supplied context declares exactly two lineage fields', () => {
    const code = codeOf(join(AUTHORITY_DIR, 'preReservation.ts'));
    const match = /export interface KernelNonAuthorityContext \{([\s\S]*?)\n\}/.exec(code);
    expect(match, 'KernelNonAuthorityContext is not declared').not.toBeNull();
    const fields = [...match![1]!.matchAll(/readonly\s+(\w+)\s*:/g)].map((m) => m[1]!);
    // TWO. `contextDigest` and `authorisationRef`. `principal` and `grantWindows` were
    // REMOVED when S1E took over steps D and I; a third field here would be a new channel.
    expect(fields.sort()).toEqual(['authorisationRef', 'contextDigest']);
  });

  it('the identity input declares exactly a company and a session', () => {
    const code = codeOf(join(AUTHORITY_DIR, 'principal.ts'));
    const match = /export interface RuntimeSessionRef \{([\s\S]*?)\n\}/.exec(code);
    expect(match).not.toBeNull();
    const fields = [...match![1]!.matchAll(/readonly\s+(\w+)\s*:/g)].map((m) => m[1]!);
    expect(fields.sort()).toEqual(['companyId', 'sessionId']);
    // And in particular NOT these.
    for (const forbidden of ['principalId', 'role', 'kind', 'modelBinding', 'delegationDepth']) {
      expect(fields, `RuntimeSessionRef carries ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('`evaluateUnderLease` takes six positional parameters and no options bag', () => {
    // lease, session, intent, spec, non-authority context, and the OPTIONAL test barrier.
    // Six, and every one of them is a named positional parameter rather than a bag.
    expect(PreReservationAuthorityPipeline.prototype.evaluateUnderLease.length).toBe(6);
    const code = codeOf(join(AUTHORITY_DIR, 'preReservation.ts'));
    const signature = /async evaluateUnderLease\(([\s\S]*?)\): Promise</.exec(code);
    expect(signature).not.toBeNull();
    const params = signature![1]!;
    for (const forbidden of [
      'principal:',
      'grade:',
      'grant:',
      'grants:',
      'counterparty:',
      'valueDirection:',
      'platformStatus:',
      'evidence:',
      'autonomyLevel:',
      'exposure:',
      'recoverability:',
      'windowRefs:',
    ]) {
      expect(params, `evaluateUnderLease accepts ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('rule 3 — the authority tree performs no money arithmetic and adds no policy path', () => {
  it('no money primitive that CHANGES a value appears in the authority tree', () => {
    // `26 §2.1`: exposure is COMPUTED by the Effect Canonicaliser. The authority tree reads
    // `per_action_max` off grant rows for the intersection and formats nothing.
    for (const file of authoritySource) {
      const code = codeOf(file);
      for (const needle of ['add', 'sub', 'mulByRational', 'money']) {
        // A BARE call. `Set.prototype.add` and `Map.prototype.set` are not money primitives,
        // and a rule that could not tell them apart would either be unsatisfiable or would be
        // relaxed into uselessness the first time someone used a Set.
        expect(callsBareFunction(code, needle), `${file} calls ${needle}(`).toBe(false);
      }
    }
  });

  it('there is exactly ONE production Cedar evaluation path, and S1E did not add a second', () => {
    // The accepted S1D property, re-asserted across the whole tree after S1E.
    const withIsAuthorized = allSource.filter((file) => codeOf(file).includes('isAuthorized'));
    expect(withIsAuthorized).toEqual([join('src', 'kernel', 'policy', 'cedarEngine.ts')]);

    // The dependency is reachable from two accepted S1D files — the evaluator and the
    // artifact loader, which parses and validates the schema and the policy set at
    // construction. Only ONE of them takes a decision, which the assertion above states.
    const importsCedarWasm = allSource.filter((file) =>
      /from\s*'@cedar-policy\/cedar-wasm/.test(codeOf(file)),
    );
    expect(importsCedarWasm.sort()).toEqual([
      join('src', 'kernel', 'policy', 'cedarEngine.ts'),
      join('src', 'kernel', 'policy', 'policyArtifacts.ts'),
    ]);

    // And the authority tree reaches Cedar only through `PolicyEngine`.
    for (const file of authoritySource) {
      expect(codeOf(file), `${file} reaches the Cedar engine directly`).not.toContain(
        'cedarEngine',
      );
    }
  });

  it('the authority tree contains no reservation, dispatch, outbox, audit or adapter code', () => {
    // The S1E scope boundary, as a grep. `26 §7` step R and everything after it is absent.
    for (const file of authoritySource) {
      const code = codeOf(file);
      for (const needle of [
        'window_balance',
        'exposure_reservation',
        'standing_window_exposure',
        'journal_counter',
        'FOR UPDATE',
        'INSERT INTO',
        'UPDATE ',
        'DELETE FROM',
        'http',
        'outbox',
        'audit_',
        'node:https',
        'undici',
      ]) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
      // No NETWORK fetch. `PreconditionEvaluator.fetch` is a METHOD and is step G's own name
      // in `26 §7` ("Fetch preconditions from state store"), so the rule names the two forms a
      // network call actually takes. A bare `fetch(...)` with no `await` would be a floating
      // promise, which the lint configuration already rejects as an error.
      expect(code, `${file} awaits the global fetch`).not.toContain('await fetch(');
      expect(code, `${file} reaches globalThis.fetch`).not.toContain('globalThis.fetch');
    }
  });
});

describe('rule 4 — the worker-facing surface has nowhere to put a detail', () => {
  it('every worker-facing variant declares exactly one field', () => {
    const code = codeOf(join(AUTHORITY_DIR, 'workerFacingAuthorityDenial.ts'));
    for (const name of [
      'WorkerFacingAuthorityDenial',
      'WorkerFacingPreReservationEligible',
      'WorkerFacingApprovalRequired',
    ]) {
      const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(code);
      expect(match, `${name} is not declared`).not.toBeNull();
      const fields = [...match![1]!.matchAll(/readonly\s+(\w+)\s*[?:]/g)].map((m) => m[1]!);
      expect(fields, name).toHaveLength(1);
    }
  });

  it('the projection reads neither `detail`, nor `auditNote`, nor `lineage`, nor `step`', () => {
    const code = codeOf(join(AUTHORITY_DIR, 'workerFacingAuthorityDenial.ts'));
    const body = /export function projectPreReservationToWorker\(([\s\S]*?)\n\}/.exec(code);
    expect(body).not.toBeNull();
    for (const needle of ['.detail', '.lineage', '.step', '.stepsEvaluated']) {
      expect(body![1]!, `the projection reads ${needle}`).not.toContain(needle);
    }
  });

  it('nothing in `src/` returns an audit note or a step label outward', () => {
    // The accepted S1B/S1C/S1D rule, extended over the S1E tree.
    for (const file of allSource) {
      const code = codeOf(file);
      expect(code, `${file} returns an audit note`).not.toMatch(/return\s+[\w.#]*\.auditNote/);
    }
  });

  it('a denial projects to one frozen field, whatever the internal detail was', () => {
    const projected = projectPreReservationToWorker({
      outcome: 'DENIED',
      step: 'H′',
      code: 'PRECONDITION_CONTRADICTED',
      detail: 'PRECONDITION_IN_OPEN_CONTRADICTION',
      lineage: null,
      stepsEvaluated: ['D', 'E', 'F', 'G', 'H', 'H′'],
    });
    expect(projected).toEqual({ deny: 'PRECONDITION_CONTRADICTED' });
    expect(Object.isFrozen(projected)).toBe(true);
    const serialised = JSON.stringify(projected);
    expect(serialised).not.toContain('H′');
    expect(serialised).not.toContain('PRECONDITION_IN_OPEN_CONTRADICTION');
    expect(serialised).not.toContain('ContradictionLink');
  });
});

describe('rule 5 — `26 §7`\'s declared order, and the two properties it states in prose', () => {
  /**
   * The expected sequence is transcribed HERE from `26 §7`'s flowchart. It is not imported
   * from the production table and not derived from it.
   */
  const FLOWCHART: readonly string[] = [
    'B', 'C', 'C2', 'C′', 'D', 'E', 'F', 'G', 'H', 'H′', 'H″', 'I', 'J', 'K', 'L', 'M', 'N', 'P',
  ];

  it('the declared step order is `26 §7`\'s, transcribed independently', () => {
    expect([...AUTHORITY_STEPS]).toEqual(FLOWCHART);
  });

  it('PROPERTY 1 — prohibitions are evaluated before grants', () => {
    // `26 §7`: "Prohibitions are evaluated before grants and are unappealable."
    expect(stepPrecedes('E', 'I')).toBe(true);
    expect(FLOWCHART.indexOf('E')).toBeLessThan(FLOWCHART.indexOf('I'));
  });

  it('H′ is immediately after H, and H″ immediately after H′', () => {
    // `26 §7`: "H′ — Contradiction check | Immediately after H (precondition grade and
    // freshness)."
    expect(FLOWCHART.indexOf("H′") - FLOWCHART.indexOf('H')).toBe(1);
    expect(FLOWCHART.indexOf('H″') - FLOWCHART.indexOf("H′")).toBe(1);
  });

  it('every S1E gate precedes the Cedar decision, and the ledger follows it', () => {
    for (const step of S1E_GATE_STEPS) {
      expect(FLOWCHART.indexOf(step), step).toBeLessThan(FLOWCHART.indexOf('M'));
    }
    expect(FLOWCHART.indexOf('M')).toBeLessThan(FLOWCHART.indexOf('N'));
  });

  it('the pipeline REFUSES TO CONSTRUCT if the declared order is violated', () => {
    // The construction check is what makes the order a startup property rather than a comment.
    // It runs on every construction, so the fact that the suite builds pipelines at all is
    // the assertion; this states it explicitly.
    const code = codeOf(join(AUTHORITY_DIR, 'preReservation.ts'));
    expect(code).toContain('assertDeclaredOrder()');
    expect(code).toMatch(/constructor\(options: PreReservationPipelineOptions\) \{\s*assertDeclaredOrder\(\);/);
  });

  it('there is no step R, S, T, U, V, W or X in the declared sequence', () => {
    // The S1E boundary, as a property of the step table itself.
    for (const beyond of ['R', "R′", 'S', 'T', 'U', 'V', 'W', 'X']) {
      expect([...AUTHORITY_STEPS], `step ${beyond} is declared`).not.toContain(beyond);
    }
  });
});

describe('rule 6 — `26 §6`\'s prohibited classes are transcribed, closed and disjoint', () => {
  /**
   * The list is transcribed HERE from `26 §6`'s table, row by row, independently of
   * `prohibitions.ts`. A test importing the production list and comparing it to itself would
   * assert nothing.
   */
  const SECTION_6: readonly string[] = [
    'payee.create',
    'payee.bank_details.modify',
    'payment_method.add',
    'credential.create',
    'credential.rotate',
    'credential.export',
    'oauth.scope.modify',
    'payment_page_code.write',
    'theme.checkout.write',
    'authority.*',
    'audit.write',
    'audit.close',
    'audit.delete',
    'platform.spend_cap.raise',
    'platform.budget_limit.raise',
    'review.create',
    'testimonial.create',
    'tax.filing.*',
    'entity.*',
    'contract.execute',
    'legal.response.send',
    'dispute.representment.submit',
  ];

  it('the production list is exactly `26 §6`\'s — neither expanded nor shrunk', () => {
    expect([...PROHIBITED_ACTION_CLASSES].sort()).toEqual([...SECTION_6].sort());
  });

  it('the wildcards match as prefixes and do not overreach', () => {
    expect(isCategoricallyProhibited('authority.grant.create')).toBe(true);
    expect(isCategoricallyProhibited('authority.policy.deploy')).toBe(true);
    expect(isCategoricallyProhibited('tax.filing.submit')).toBe(true);
    expect(isCategoricallyProhibited('entity.dissolve')).toBe(true);
    // Not a prefix match on a different identifier that merely starts with the same letters.
    expect(isCategoricallyProhibited('authorityx.foo')).toBe(false);
    expect(isCategoricallyProhibited('entityresolver.run')).toBe(false);
    // And an ordinary class is not prohibited.
    expect(isCategoricallyProhibited('refund.create')).toBe(false);
  });

  it('`26 §6`\'s SECOND enforcement leg — no prohibited class is in the closed catalogue', () => {
    // "enforced twice: a deny rule that no grant can override, and the ABSENCE of any
    // credential the broker can issue". S1E's analogue of the credential half is catalogue
    // membership: a class with no catalogue row has no adapter and no method.
    expect(prohibitedClassesInCatalogue([...ACTION_CLASSES])).toEqual([]);
  });

  it('every prohibited class denies at step E, individually', () => {
    for (const actionClass of SECTION_6) {
      const concrete = actionClass.endsWith('.*')
        ? `${actionClass.slice(0, -1)}anything`
        : actionClass;
      expect(() => evaluateCategoricalProhibition(concrete), concrete).toThrow(/PROHIBITED/);
    }
  });
});
