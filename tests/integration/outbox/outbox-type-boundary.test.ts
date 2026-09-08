import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `§11`, `§12`, `§13`, `§30` — THE OUTBOX AUTHORITY BOUNDARY, AS A COMPILE-TIME PROPERTY.
 *
 * =================================================================================
 * WHY THESE ATTACKS HAVE NO HONEST RUNTIME FORM.
 *
 * `§12`: "Do not allow a caller or model to say `recoverability = REVERSIBLE` for an
 * IRRECOVERABLE action." `§11`: "caller cannot override [the correlation tag]." `§13`: "Do
 * not trust an eligibility value stored by the caller."
 *
 * A RUNTIME test for any of the three would have to open the seam first — a
 * `recoverability` parameter, a settable tag, an `eligible` flag — and the seam would then
 * BE the defect. `36 §2` deleted v1.0's precondition test for exactly this reason: "a test
 * that passes trivially once the type is right" is a tautology when the type is wrong, and
 * the accepted S1E and S1F boundary tests both record the same argument.
 *
 * So the proof is a real `tsc` run over `tests/type-negative/`, discriminated the way the
 * accepted `I21`, policy and authority harnesses are: a positive control that must compile
 * clean, expected diagnostics on expected lines, and — asserted by
 * `tests/canonicalisation/i21-type-boundary.test.ts` over the whole project — no diagnostic
 * on any unmarked line. The project is shared, because a second one would duplicate the
 * harness, and this file owns the S1I fixture's expected codes.
 *
 * THE RUNTIME HALF IS `tests/negative-controls/outbox-controls.test.ts`, which exhibits an
 * enqueue that DOES take a `recoverability` parameter and shows what it stores.
 * =================================================================================
 */

const PROJECT = 'tests/type-negative';
const FILE = 'outbox-caller-supplied-authority.ts';

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

function markersIn(name: string): readonly Diagnostic[] {
  const path = `${PROJECT}/${name}`;
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => /\/\/ EXPECT_ERROR TS\d+$/.test(text))
    .map(({ text, line }) => ({ file: path, line, code: /TS\d+$/.exec(text)![0], message: '' }));
}

function diagnosticsIn(name: string): readonly Diagnostic[] {
  return diagnostics.filter((d) => d.file.endsWith(name));
}

describe('the harness ran, and it discriminates', () => {
  it('the compile produced diagnostics at all — an empty run would prove nothing', () => {
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL — `positive-control.ts` still compiles with zero diagnostics', () => {
    // Re-asserted here as well as in the accepted harnesses, because S1I added a fixture to
    // the same project: a new fixture that broke the project's imports would show up here.
    expect(diagnosticsIn('positive-control.ts')).toHaveLength(0);
  });
});

describe('no caller-supplied authority reaches the enqueue or the claim', () => {
  it('every marked line produced exactly the marked diagnostic', () => {
    const actual = diagnosticsIn(FILE);
    const marked = markersIn(FILE);
    expect(marked.length, 'the fixture carries no markers').toBe(8);
    for (const marker of marked) {
      const hit = actual.find((d) => d.line === marker.line);
      expect(hit, `no diagnostic on ${FILE}:${marker.line}`).toBeDefined();
      expect(hit!.code, `${FILE}:${marker.line}`).toBe(marker.code);
    }
  });

  it('and no diagnostic appeared on a line the fixture did not mark', () => {
    // The property that keeps the fixture honest in the other direction: a widened type
    // would remove a diagnostic and the case above would fail, and an unrelated compile
    // error would appear here rather than passing quietly.
    const actual = diagnosticsIn(FILE);
    const markedLines = new Set(markersIn(FILE).map((m) => m.line));
    const stray = actual.filter((d) => !markedLines.has(d.line));
    expect(stray, JSON.stringify(stray, null, 2)).toHaveLength(0);
  });

  it('the eight attacks are the eight the mandate names, each failing for the right reason', () => {
    const actual = diagnosticsIn(FILE);
    const byMessage = (needle: string): Diagnostic | undefined =>
      actual.find((d) => d.message.includes(needle));

    // `§12` / `26 §5`: "Assigned per action class in the catalogue, not per request, and
    // never by a model."
    expect(byMessage("'recoverability' does not exist")).toBeDefined();
    // `§11`: "caller cannot override it."
    expect(byMessage("'correlationTag' does not exist")).toBeDefined();
    // `26 §2.1`: the hash "binds this request to exactly one dispatch payload", and the
    // outbox reads it from the committed authorisation.
    expect(byMessage("'dispatchPayloadHash' does not exist")).toBeDefined();
    // `§13`: "Do not trust an eligibility value stored by the caller."
    expect(byMessage("'eligible' does not exist")).toBeDefined();
    // `30 §5.6`: the mirror state is derived from durable declarations, never supplied.
    expect(byMessage("'mirrorState' does not exist")).toBeDefined();
    // `30 §5.7.2`: the override is kernel state, read under a row lock in the claim.
    expect(byMessage("'overrideId' does not exist")).toBeDefined();
    // `§3` / `§41`: an `AcquiredClaim` is not a `DispatchPayload`. THE CLAIM IS NOT A
    // DISPATCH, and the type says so.
    expect(byMessage("Type 'AcquiredClaim' is missing")).toBeDefined();
    // And there is no adapter, endpoint or vendor field to read off the row.
    expect(byMessage("'adapterEndpoint' does not exist on type 'OutboxRow'")).toBeDefined();
  });
});
