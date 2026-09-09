import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `§5`, `§8`, `§17`, `§32`, `§33`, `§34` — THE DISPATCH AUTHORITY BOUNDARY, AT COMPILE TIME.
 *
 * =================================================================================
 * WHY THESE ATTACKS HAVE NO HONEST RUNTIME FORM.
 *
 * `§8`: "Production offers no such argument." `§34`: "No worker/model surface may: obtain
 * adapter instance; call adapter port; supply fresh claim capability; submit adapter
 * outcome; select outcome; mutate outbox."
 *
 * A RUNTIME test for "the caller cannot pass an adapter" would have to add the parameter
 * first, and the parameter would then BE the defect — the argument the accepted `I21`, S1D,
 * S1E, S1F and S1I boundary harnesses each record, and the reason `36 §2` deleted v1.0's
 * precondition test ("a test that passes trivially once the type is right").
 *
 * So the proof is a real `tsc` run over `tests/type-negative/`, discriminated the way the
 * accepted harnesses are: a positive control that must compile clean, expected diagnostics
 * on expected lines, and — asserted by `tests/canonicalisation/i21-type-boundary.test.ts`
 * over the whole project — no diagnostic on any unmarked line. The project is shared,
 * because a second one would duplicate the harness, and THIS FILE OWNS THE S1J FIXTURE'S
 * EXPECTED CODES.
 *
 * THE RUNTIME HALF IS `tests/negative-controls/gateway-controls.test.ts`, which exhibits
 * dispatch functions that DO take an adapter, a claimed recoverability and a caller-chosen
 * outbox id, and shows what each of them does.
 * =================================================================================
 */

const PROJECT = 'tests/type-negative';
const FILE = 'gateway-caller-supplied-authority.ts';

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
    // Re-asserted here as well as in the accepted harnesses, because S1J added a fixture to
    // the same project: a new fixture that broke the project's imports would show up here.
    expect(diagnosticsIn('positive-control.ts')).toHaveLength(0);
  });
});

describe('no caller-supplied authority reaches the Effect Gateway', () => {
  it('every marked line produced exactly the marked diagnostic', () => {
    const actual = diagnosticsIn(FILE);
    const marked = markersIn(FILE);
    expect(marked.length, 'the fixture carries no markers').toBe(14);
    for (const marker of marked) {
      const hit = actual.find((d) => d.line === marker.line);
      expect(hit, `no diagnostic on ${FILE}:${marker.line}`).toBeDefined();
      expect(hit!.code, `${FILE}:${marker.line}`).toBe(marker.code);
    }
  });

  it('and no diagnostic appeared on a line the fixture did not mark', () => {
    const actual = diagnosticsIn(FILE);
    const markedLines = new Set(markersIn(FILE).map((m) => m.line));
    const stray = actual.filter((d) => !markedLines.has(d.line));
    expect(stray, JSON.stringify(stray, null, 2)).toHaveLength(0);
  });

  it('the fourteen attacks each fail for the right declared reason', () => {
    const actual = diagnosticsIn(FILE);
    const byMessage = (needle: string): Diagnostic | undefined =>
      actual.find((d) => d.message.includes(needle));

    // `§8` / `26 §5`: the adapter is "assigned per action class in the catalogue, not per
    // request, and never by a model", so neither the instance nor the identity is a field.
    expect(byMessage("'adapter' does not exist")).toBeDefined();
    expect(byMessage("'adapterId' does not exist")).toBeDefined();

    // `§17` / `24 §3` K4's "What AI may not do": "a recoverability class".
    expect(byMessage("'recoverability' does not exist")).toBeDefined();

    // `§14`: "The adapter is part of the TCB. The model must not choose the outcome." The
    // message appears on both the gateway input and the outcome-transaction input.
    expect(actual.filter((d) => d.message.includes("'outcome' does not exist"))).toHaveLength(
      2,
    );

    // `§5`: a capability is "not reconstructable by loading a CLAIMED row" and "not
    // accepted from user/model input". The brand is a module-private `unique symbol`.
    expect(byMessage("'[FRESH_DISPATCH_CAPABILITY]' is missing")).toBeDefined();
    // `§34`: nor can an attestation be fabricated, so an outcome cannot be submitted.
    expect(byMessage("'[DISPATCH_ATTESTATION]' is missing")).toBeDefined();

    // `§32`: every scalar on the envelope is read-only, so the alias attack does not even
    // compile — three of them, on the tag, the degraded requirement and the class.
    expect(actual.filter((d) => d.code === 'TS2540')).toHaveLength(3);

    // `§33`: "No generic `adapterResult.exposure` field", and no MIE quantity either.
    expect(byMessage("'totalExposure' does not exist")).toBeDefined();
    expect(byMessage("'irrecoverableUnits' does not exist")).toBeDefined();

    // `§9` / `48 §4`: a dispatch envelope is not a vendor request. There is no url, no
    // header set, no credential and no endpoint on it.
    expect(byMessage("Type 'DispatchEnvelope' is missing")).toBeDefined();
  });
});
