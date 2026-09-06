import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Rules about the S1D source tree, asserted against the S1D source tree.
 *
 * The technique is S1A's and S1B's, quoted from `tests/canonicalisation/source-rules.test.ts`:
 * "A rule written only as a comment is a rule a future edit breaks silently; a rule with a
 * test is a rule."
 *
 * Six rules, each closing a way an S1D property could erode without anyone noticing.
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

const POLICY_DIR = join('src', 'kernel', 'policy');
const policySource = walk(POLICY_DIR);

describe('rule 1 — Cedar computes no money, and the policy tree performs no money arithmetic', () => {
  /**
   * The S1D mandate: "Do not move authoritative amount derivation into Cedar. Do not make
   * Cedar calculate `$25.00 + $1.03`."
   *
   * `26 §2.1`: `total_exposure` is "vendor_amount + Σ cost_components + class-specific
   * economically bounded loss", and the Effect Canonicaliser is what computes it. The policy
   * tree's only contact with `money.ts` is the fixed-scale FORMATTER.
   */
  it('the policy tree imports only `toDb` and the `Money` type from money.ts', () => {
    const specifiers = policySource
      .flatMap((file) => [...codeOf(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*money\.js'/g)])
      .flatMap((match) => match[1]!.split(',').map((name) => name.trim()));
    expect(specifiers.length).toBeGreaterThan(0);
    expect([...new Set(specifiers)].sort()).toEqual(['toDb', 'type Money']);
  });

  it('no money primitive that CHANGES a value appears anywhere in the policy tree', () => {
    for (const file of policySource) {
      const code = codeOf(file);
      for (const needle of ['add(', 'sub(', 'mulByRational', 'fromDb(', 'money(']) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('and no bare arithmetic operator is applied to an exposure or an amount', () => {
    for (const file of policySource) {
      // Import lines are removed first: `'../exposure/money.js'` is a path, not a division.
      const code = codeOf(file).replace(/^\s*import[\s\S]*?from\s*'[^']*';$/gm, '');
      expect(code, `${file} does arithmetic on an exposure`).not.toMatch(
        /(?:Exposure|exposure|[Aa]mount|totalExposure)\s*[-+*/]\s*\w/,
      );
    }
  });

  it('the Cedar policy text contains no arithmetic either', () => {
    // Cedar supports `+`, `-` and `*`. The cap is a comparison against a literal, and a
    // policy that computed a total would be the canonicaliser's job moved into the artifact.
    for (const file of walk(join(POLICY_DIR, 'artifacts'), '.cedar')) {
      const text = codeOf(file);
      expect(text, `${file} performs arithmetic`).not.toMatch(/[+*]/);
      expect(text, `${file} performs subtraction`).not.toMatch(/\w\s-\s\w/);
    }
  });
});

describe('rule 2 — the per-action limit lives in ONE place', () => {
  it('it appears in the signed artifacts and in no TypeScript source anywhere', () => {
    // Not only in `src/kernel/policy/` — anywhere in `src/`. A constant elsewhere that
    // happened to equal the cap would be a second source of truth waiting to drift.
    for (const file of walk('src')) {
      expect(codeOf(file), `${file} carries the per-action limit`).not.toMatch(/25\.00|2500n/);
    }
  });

  it('and exactly two artifacts carry it — `26 §8`’s permit conjunct and `26 §11` P1’s forbid', () => {
    const carriers = walk(join(POLICY_DIR, 'artifacts'), '.cedar').filter((file) =>
      codeOf(file).includes('decimal("25.00")'),
    );
    expect(carriers).toHaveLength(2);
  });
});

describe('rule 3 — there is no generic policy context and no attribute escape hatch', () => {
  it('no policy module declares an open-ended record of policy attributes', () => {
    for (const file of policySource) {
      const code = codeOf(file);
      for (const needle of [
        'Record<string, unknown>',
        'policyAttributes',
        'extraContext',
        'additionalContext',
        '[key: string]: unknown',
      ]) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('the Cedar schema declares the context record explicitly, with no open shape', () => {
    const schema = readFileSync(join(POLICY_DIR, 'artifacts', 'acos.cedarschema'), 'utf8');
    // Cedar's `Record` type would be the open shape; the schema uses a closed literal.
    expect(codeOf(join(POLICY_DIR, 'artifacts', 'acos.cedarschema'))).not.toContain('Record');
    expect(schema).toContain('context: {');
  });

  it('and the schema declares NO WINDOW attribute — `26 §7` puts headroom at step R', () => {
    // The S1D contract §5.2 records this as an OPEN obligation rather than a silent
    // omission. The rule keeps a later edit from adding a window attribute that a fixture
    // could fill, which would make a step-R quantity look like an evaluated step-M operand.
    const schema = codeOf(join(POLICY_DIR, 'artifacts', 'acos.cedarschema'));
    for (const needle of ['window', 'headroom', 'W_DAY', 'W_MONTH']) {
      expect(schema, `the schema declares ${needle}`).not.toContain(needle);
    }
    for (const file of walk(join(POLICY_DIR, 'artifacts'), '.cedar')) {
      expect(codeOf(file), `${file} references a window`).not.toMatch(/window|headroom|W_[A-Z]/);
    }
  });
});

describe('rule 4 — the policy tree does not touch the accepted S1A/S1B/S1C trees', () => {
  it('it imports from src/kernel/exposure/ only money.js', () => {
    const specifiers = policySource
      .flatMap((file) => [...codeOf(file).matchAll(/from '([^']*exposure\/[^']*)'/g)])
      .map((match) => match[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, `unexpected exposure import ${specifier}`).toMatch(/money\.js$/);
    }
  });

  it('it opens no database connection and takes no lock', () => {
    // `26 §7` step R is the reservation and S1D does not implement it. A policy module that
    // reached the ledger would be doing step R's work without step R's lock order.
    for (const file of policySource) {
      const code = codeOf(file);
      for (const needle of ['FOR UPDATE', 'BEGIN', 'pg', 'Client', 'pool', 'query(']) {
        expect(code, `${file} references ${needle}`).not.toContain(needle);
      }
    }
  });

  it('nothing under src/kernel/canonicalisation/ or src/kernel/enumeration/ imports the policy tree', () => {
    // The dependency runs one way. `26 §12`'s separation is a module boundary, not a
    // convention: the canonicaliser cannot come to depend on what the policy decided.
    for (const dir of [join('src', 'kernel', 'canonicalisation'), join('src', 'kernel', 'enumeration')]) {
      for (const file of walk(dir)) {
        expect(codeOf(file), `${file} imports the policy tree`).not.toMatch(/from '[^']*policy\//);
      }
    }
  });

  it('and the accepted S1B/S1C production modules are unchanged in the ways that matter', () => {
    // Narrow, deliberate assertions rather than a diff: the two properties an S1D edit could
    // plausibly have broken.
    const canonicaliser = codeOf(join('src', 'kernel', 'canonicalisation', 'canonicaliser.ts'));
    expect(canonicaliser, 'the canonicaliser now knows about policy').not.toMatch(/policy|cedar/i);
    const liveSelector = codeOf(join('src', 'kernel', 'enumeration', 'liveSelector.ts'));
    expect(liveSelector, 'C′ now knows about policy').not.toMatch(/policy|cedar/i);
  });
});

describe('rule 5 — one seam reaches Cedar, and one call binds C′ to it', () => {
  it('`authorise.ts` is the only module that calls both C′ and the policy engine', () => {
    const both = policySource.filter((file) => {
      const code = codeOf(file);
      return code.includes('canonicaliseUnderLease') && code.includes('.evaluate(');
    });
    expect(both.map((f) => f.replace(/\\/g, '/'))).toEqual(['src/kernel/policy/authorise.ts']);
  });

  it('and it does not stash the effect anywhere between the two calls', () => {
    const code = codeOf(join(POLICY_DIR, 'authorise.ts'));
    // The effect is a `const` in one function body, consumed on the next line. No field, no
    // module-level variable, no callback that could receive it first.
    expect(code).toContain('const effect = await this.#liveSelector.canonicaliseUnderLease(');
    expect(code).toContain('const decision = this.#policyEngine.evaluate(effect);');
    expect(code, 'the pipeline stores the effect').not.toMatch(/this\.#\w*[Ee]ffect/);
  });
});

describe('rule 6 — no rationale, and no lineage commitment over it, on the policy path', () => {
  it('nothing in the policy tree references rationale in executable code', () => {
    // The accepted `source-rules.test.ts` rule 1 already walks all of `src/` with a permitted
    // list of three files. S1D adds no exemption to it, and this restates the property over
    // the policy tree so a future reader sees it stated where it applies.
    for (const file of policySource) {
      expect(codeOf(file), `${file} references rationale`).not.toMatch(/rationale/i);
    }
  });

  it('and `intentHash` — which DOES commit to rationale — is not a Cedar operand', () => {
    for (const file of policySource) {
      expect(codeOf(file), `${file} reads intentHash`).not.toContain('intentHash');
    }
  });
});
