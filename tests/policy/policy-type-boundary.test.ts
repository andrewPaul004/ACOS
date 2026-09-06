import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The S1D authority boundary, as a COMPILE-TIME property.
 *
 * The S1D mandate, verbatim: "Where a structural/type-level prohibition is the stronger
 * proof, use it. Do not add fake public APIs merely so a runtime negative test can call
 * them."
 *
 * Three attacks from `docs/implementation/S1D-contract.md §7` have no runtime form worth
 * writing, because the honest answer to each is that the program does not compile:
 *
 *   A4  mutate the canonical effect after C′ to reduce exposure
 *   A5/A6  supply an override, an alternate identity or another limit to the engine
 *   A7  call the policy engine with model-originated authoritative operands
 *
 * A runtime test for any of these would have required opening a seam — an options bag, a
 * settable field, an override parameter — and the seam would then be the defect. So the
 * proof is a real `tsc` run, discriminated the same way S1B's `I21` harness is: a positive
 * control that must compile clean, expected diagnostics on expected lines, and no diagnostic
 * on any unmarked line.
 *
 * The fixtures share `tests/type-negative/`'s project with S1B's and S1C's, because there is
 * one project and a second would duplicate the harness. Their expected codes are owned here.
 */

const PROJECT = 'tests/type-negative';

interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

let diagnostics: Diagnostic[] = [];

function compile(): string {
  try {
    execFileSync(
      process.execPath,
      [
        join('node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '-p',
        join(PROJECT, 'tsconfig.json'),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return '';
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

beforeAll(() => {
  diagnostics = compile()
    .split(/\r?\n/)
    .map((line) => /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      file: match[1]!.replace(/\\/g, '/'),
      line: Number(match[2]),
      code: match[3]!,
      message: match[4]!,
    }));
}, 180_000);

function markersIn(file: string): readonly Diagnostic[] {
  const path = `${PROJECT}/${file}`;
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => /\/\/ EXPECT_ERROR TS\d+$/.test(text))
    .map(({ text, line }) => ({ file: path, line, code: /TS\d+$/.exec(text)![0], message: '' }));
}

const S1D_FIXTURES: readonly [string, string, string][] = [
  [
    'policy-operand-supplied.ts',
    'A5/A6 — supplying an override context or an alternate per-action limit',
    'TS2554',
  ],
  [
    'mutate-canonical-exposure.ts',
    'A4 — rewriting the canonical effect’s economics after C′',
    'TS2540',
  ],
  [
    'model-exposure-into-policy.ts',
    'A7 — handing the policy engine a model-originated monetary operand',
    'TS2375',
  ],
];

describe('the harness discriminates, for the S1D fixtures too', () => {
  it('all three S1D fixtures exist and each carries at least one marker', () => {
    const present = readdirSync(PROJECT).filter((name) => name.endsWith('.ts'));
    for (const [file] of S1D_FIXTURES) {
      expect(present, `${file} is missing`).toContain(file);
      expect(markersIn(file).length, `${file} carries no EXPECT_ERROR marker`).toBeGreaterThan(0);
    }
  });

  it('POSITIVE CONTROL — positive-control.ts still compiles with zero diagnostics', () => {
    // Re-asserted here rather than assumed from the S1B suite: if the S1D fixtures' imports
    // broke the project, every negative file would "fail" and this suite would pass for the
    // wrong reason.
    const onControl = diagnostics.filter((d) => d.file.endsWith('positive-control.ts'));
    expect(onControl, JSON.stringify(onControl, null, 2)).toHaveLength(0);
  });

  it('no diagnostic appears on an unmarked line in any S1D fixture', () => {
    for (const [file] of S1D_FIXTURES) {
      const marked = new Set(markersIn(file).map((m) => m.line));
      const stray = diagnostics.filter((d) => d.file.endsWith(file) && !marked.has(d.line));
      expect(stray, JSON.stringify(stray, null, 2)).toHaveLength(0);
    }
  });
});

describe('every S1D authority-channel attack fails to compile, on the expected line', () => {
  for (const [file, what, code] of S1D_FIXTURES) {
    it(`${what} — ${file}`, () => {
      for (const marker of markersIn(file)) {
        const hit = diagnostics.find(
          (d) => d.file.endsWith(file) && d.line === marker.line && d.code === marker.code,
        );
        expect(hit, `${file}:${marker.line} expected ${marker.code} and got nothing`).toBeDefined();
      }
      expect(diagnostics.filter((d) => d.file.endsWith(file)).map((d) => d.code)).toContain(code);
    });
  }
});

describe('the boundary those diagnostics are evidence of', () => {
  it('the request builder and the engine each take exactly one parameter, in source', () => {
    const builder = readFileSync(join('src', 'kernel', 'policy', 'cedarRequest.ts'), 'utf8');
    expect(builder).toContain('export function buildCedarRequest(effect: CanonicalEffect): CedarRequest {');
    const engine = readFileSync(join('src', 'kernel', 'policy', 'policyEngine.ts'), 'utf8');
    expect(engine).toContain('evaluate(effect: CanonicalEffect): PolicyDecision {');
  });

  it('and neither declares an optional or rest parameter that a later edit could widen into', () => {
    for (const name of ['cedarRequest.ts', 'policyEngine.ts', 'cedarEngine.ts']) {
      const code = readFileSync(join('src', 'kernel', 'policy', name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${name} declares a rest parameter`).not.toMatch(/\(\s*\.\.\./);
      expect(code, `${name} declares an options bag`).not.toMatch(/options\?\s*:/);
      expect(code, `${name} declares an overrides bag`).not.toMatch(/overrides?\s*[?:]/);
    }
  });
});
