import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `I21` as a COMPILE-TIME property.
 *
 * Registry `§1.2` `I21`, test column, verbatim:
 *
 *   "Type-level property; a test constructing an AuthorizationRequest from a fifth
 *    ProposedIntent field must not compile."
 *
 * `36 §2`, verbatim:
 *
 *   "I21 as a type-level property: no AuthorizationRequest field is populated from
 *    ProposedIntent beyond action_class, resource_ref, selector, reason_code. A test
 *    attempting to construct a request from any other intent field must not compile.
 *    Unlike v1.0's version this is not vacuous, because the fields that bound money are
 *    now on the other side of the boundary."
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A REAL `tsc` RUN AND NOT A RUNTIME KEY CHECK
 *
 * `expect(request).not.toHaveProperty('rationale')` would pass against a design with no
 * type boundary at all — it asserts that one object happened not to carry a key, which is
 * a fact about one execution rather than a property of the code. `36 §2` deleted v1.0's
 * precondition test for being exactly that kind of tautology, and replacing it with
 * another one would repeat the mistake.
 *
 * So this test compiles `tests/type-negative/` as its own TypeScript project and asserts:
 *
 *   1. positive-control.ts compiles with ZERO diagnostics — without which the negative
 *      files could be failing for an unrelated reason and this test would still pass;
 *   2. every line marked `// EXPECT_ERROR TSxxxx` produced THAT diagnostic on THAT line;
 *   3. no diagnostic appeared on any line that was not marked.
 *
 * The third is what makes the harness discriminating in both directions: a fixture that
 * stops testing what it claims — because a type was widened, say — fails rather than
 * quietly passing on some other error.
 * ---------------------------------------------------------------------------------
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
      [join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', join(PROJECT, 'tsconfig.json')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return '';
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

beforeAll(() => {
  const output = compile();
  diagnostics = output
    .split(/\r?\n/)
    .map((line) => /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      file: match[1]!.replace(/\\/g, '/'),
      line: Number(match[2]),
      code: match[3]!,
      message: match[4]!,
    }));
}, 120_000);

/** Every `// EXPECT_ERROR TSxxxx` marker in the fixture directory, by file and line. */
function markers(): readonly Diagnostic[] {
  return readdirSync(PROJECT)
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) => {
      const path = `${PROJECT}/${name}`;
      return readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((text, index) => ({ text, line: index + 1 }))
        .filter(({ text }) => /\/\/ EXPECT_ERROR TS\d+$/.test(text))
        .map(({ text, line }) => ({
          file: path,
          line,
          code: /TS\d+$/.exec(text)![0],
          message: '',
        }));
    });
}

describe('the harness discriminates', () => {
  it('the fixture directory contains a positive control and fourteen negative files', () => {
    const files = readdirSync(PROJECT).filter((name) => name.endsWith('.ts')).sort();
    expect(files).toEqual([
      // S1E. WIDENED BY EXACTLY TWO, and every existing entry is untouched.
      //
      // The two new fixtures are the compile-time halves of S1E's authority-channel closure:
      // no caller-supplied authority operand reaches the pre-reservation pipeline, and an
      // S1E pass is not a dispatchable authorisation. They live in this directory because
      // there is one type-negative tsconfig project and a second one would duplicate the
      // harness; their EXPECTED DIAGNOSTICS are owned by
      // `tests/authority/authority-type-boundary.test.ts`, not by this file, so this list is
      // the only line S1E changes here.
      //
      // The harness's discriminating properties are unaffected: the positive control still
      // compiles clean, and "no diagnostic appears on an unmarked line" now covers the two
      // new files as well.
      'authority-operand-supplied.ts',
      // S1B.2 findings 1B and 3, as compile-time impossibilities.
      'catalogue-entry-into-context.ts',
      'destination-into-option.ts',
      'fifth-field-request.ts',
      'intent-as-context.ts',
      'model-amount-into-exposure.ts',
      // S1D. WIDENED BY EXACTLY THREE, and every existing entry is untouched.
      //
      // The three new fixtures are the compile-time halves of S1D's authority-channel
      // attacks A4, A5/A6 and A7 (docs/implementation/S1D-contract.md §7). They live in this
      // directory because there is one type-negative tsconfig project and a second one would
      // duplicate the harness; their EXPECTED DIAGNOSTICS are owned by
      // `tests/policy/policy-type-boundary.test.ts`, not by this file, so this list is the
      // only line S1D changes here.
      //
      // The harness's discriminating properties are unaffected: the positive control still
      // compiles clean, and "no diagnostic appears on an unmarked line" now covers the three
      // new files as well.
      'model-exposure-into-policy.ts',
      'model-windows-into-request.ts',
      'mutate-canonical-exposure.ts',
      'policy-operand-supplied.ts',
      // S1C: `26 §2.0` — the selector "is a pair rather than an integer". No index
      // compatibility layer exists, and adding one would be a visible type change.
      'positional-selector.ts',
      'positive-control.ts',
      // S1E.
      'prereservation-as-dispatchable.ts',
      'rationale-into-request.ts',
      'rationale-parsed.ts',
    ]);
  });

  it('POSITIVE CONTROL — positive-control.ts compiles with zero diagnostics', () => {
    const onControl = diagnostics.filter((d) => d.file.endsWith('positive-control.ts'));
    expect(onControl, JSON.stringify(onControl, null, 2)).toHaveLength(0);
  });

  it('the compile produced diagnostics at all — an empty run would prove nothing', () => {
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('no diagnostic appears on an unmarked line', () => {
    const marked = new Set(markers().map((m) => `${m.file}:${m.line}`));
    const stray = diagnostics.filter((d) => !marked.has(`${d.file}:${d.line}`));
    expect(stray, JSON.stringify(stray, null, 2)).toHaveLength(0);
  });
});

describe('every I21 violation fails to compile, on the expected line', () => {
  const expected: readonly [string, string, string][] = [
    [
      'rationale-into-request.ts',
      'assigning rationale into an authority-bearing request field',
      'TS2322',
    ],
    ['rationale-parsed.ts', 'parsing rationale as prose', 'TS2339'],
    [
      'fifth-field-request.ts',
      'constructing a request from a fifth ProposedIntent field',
      'TS2353',
    ],
    [
      'intent-as-context.ts',
      'passing a ProposedIntent where the authoritative context is expected',
      'TS2345',
    ],
    [
      'model-amount-into-exposure.ts',
      'assigning a model-supplied amount into exposure',
      'TS2322',
    ],
    [
      // S1B.1, clarifications S1B-C3a and S1B-C5a. Both are authoritative kernel inputs,
      // and the type says so: neither a window list nor a retained fee has an assignable
      // position on the request or the context unless it was minted by `computed()`.
      'model-windows-into-request.ts',
      'assigning model-supplied window refs or a model-supplied retained fee',
      'TS2322',
    ],
    [
      // S1B.2 finding 1B. The catalogue row is not context; it has no expressible position
      // on `AuthoritativeCanonicalisationContext` at all, so a `refund.create` request
      // cannot acquire another class's recoverability, value_direction, adapter or method.
      'catalogue-entry-into-context.ts',
      'supplying an action catalogue entry as canonicalisation context',
      'TS2353',
    ],
    [
      // S1B.2 finding 3. There is no independent destination identifier on the option or on
      // the computed parameters, so no field outside the content-addressed parent
      // transaction and instrument can change where the money goes.
      'destination-into-option.ts',
      'supplying an independent destination instrument reference',
      'TS2353',
    ],
    [
      // S1C. `26 §2.0`: the selector "is a pair rather than an integer". `26 §7`'s CAN-05
      // probing oracle is closed by the ABSENCE of an index, not by a runtime rejection of
      // one, so the absence is asserted at the type level as well as at the wire.
      'positional-selector.ts',
      'expressing a positional selector, as an ordinal or as an index field',
      'TS2322',
    ],
  ];

  for (const [file, what, code] of expected) {
    it(`${what} — ${file}`, () => {
      const fileMarkers = markers().filter((m) => m.file.endsWith(file));
      expect(fileMarkers.length, `${file} carries no EXPECT_ERROR marker`).toBeGreaterThan(0);

      for (const marker of fileMarkers) {
        const hit = diagnostics.find(
          (d) => d.file.endsWith(file) && d.line === marker.line && d.code === marker.code,
        );
        expect(hit, `${file}:${marker.line} expected ${marker.code} and got nothing`).toBeDefined();
      }

      // And the headline diagnostic for this violation is the declared one.
      expect(diagnostics.filter((d) => d.file.endsWith(file)).map((d) => d.code)).toContain(code);
    });
  }
});

describe('the boundary the compile errors are evidence of', () => {
  it('the four permitted fields are the ONLY ones that cross', () => {
    // Stated here so the intent of the fixture set is not carried only by filenames.
    // Registry I21: "action_class, resource_ref, selector and reason_code", and v1.2:
    // "selector is {enumeration_id, option_id} and remains one field."
    const source = readFileSync('src/kernel/canonicalisation/intent.ts', 'utf8');
    expect(source).toContain('export interface PermittedIntentFields');
    const block = /export interface PermittedIntentFields \{([\s\S]*?)\n\}/.exec(source)![1]!;
    const fields = [...block.matchAll(/readonly (\w+):/g)].map((m) => m[1]);
    expect(fields.sort()).toEqual(['actionClass', 'reasonCode', 'resourceRef', 'selector']);
  });
});
