import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The S1E authority boundary, as a COMPILE-TIME property.
 *
 * Two attacks from the S1E mandate have no honest runtime form:
 *
 *   "no authority field escape hatches"  — a caller-supplied principal, grant-window set or
 *                                          generic bag reaching the pre-reservation pipeline
 *   "S1E PASS CANNOT BE DISPATCHED"      — an adapter or executor consuming an S1E result as
 *                                          a final authorisation
 *
 * A runtime test for either would have required opening the seam first — an options bag, a
 * settable principal, a payload field on the result — and the seam would then BE the defect.
 * `36 §2` deleted v1.0's precondition test for exactly that reason: "a test that passes
 * trivially once the type is right" is a tautology when the type is wrong.
 *
 * So the proof is a real `tsc` run over `tests/type-negative/`, discriminated the way S1B's
 * `I21` harness and S1D's policy harness are: a positive control that must compile clean,
 * expected diagnostics on expected lines, and no diagnostic on any unmarked line. The
 * project is shared — there is one, and a second would duplicate the harness — and the two
 * S1E fixtures' expected codes are owned here.
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
}, 120_000);

/** The `// EXPECT_ERROR TSxxxx` markers in one fixture file. */
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
  it('the compile produced diagnostics at all', () => {
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL — positive-control.ts still compiles with zero diagnostics', () => {
    // Re-asserted here as well as in the S1B harness, because S1E added fixtures to the same
    // project: a new fixture that broke the project's imports would show up here first.
    expect(diagnosticsIn('positive-control.ts')).toHaveLength(0);
  });
});

describe('no caller-supplied authority operand reaches the pre-reservation pipeline', () => {
  const FILE = 'authority-operand-supplied.ts';

  it('every marked line produced exactly the marked diagnostic', () => {
    const actual = diagnosticsIn(FILE);
    const marked = markersIn(FILE);
    expect(marked.length, 'the fixture carries no markers').toBe(5);
    for (const marker of marked) {
      const hit = actual.find((d) => d.line === marker.line);
      expect(hit, `no diagnostic on ${FILE}:${marker.line}`).toBeDefined();
      expect(hit!.code, `${FILE}:${marker.line}`).toBe(marker.code);
    }
  });

  it('the five attacks are the five the mandate names, and each fails for the right reason', () => {
    const actual = diagnosticsIn(FILE);
    const byMessage = (needle: string): Diagnostic | undefined =>
      actual.find((d) => d.message.includes(needle));

    // `26 §2.1`: the principal is "stamped by the kernel, never a parameter".
    expect(byMessage("'principalId' does not exist in type 'RuntimeSessionRef'")).toBeDefined();
    expect(
      byMessage("'principal' does not exist in type 'KernelNonAuthorityContext'"),
    ).toBeDefined();
    // `26 §2.1`: window_refs are "every named window the matching grants reference".
    expect(
      byMessage("'grantWindows' does not exist in type 'KernelNonAuthorityContext'"),
    ).toBeDefined();
    // The generic bag, which `26 §2.3` forbids in substance and the type forbids in form.
    expect(
      byMessage("'metadata' does not exist in type 'KernelNonAuthorityContext'"),
    ).toBeDefined();
    // `24 §5`: grade is "never asserted by the writer" — and never by a reader either.
    expect(byMessage("Cannot assign to 'grade' because it is a read-only property")).toBeDefined();
  });
});

describe('an S1E pass is structurally non-dispatchable', () => {
  const FILE = 'prereservation-as-dispatchable.ts';

  it('every marked line produced exactly the marked diagnostic', () => {
    const actual = diagnosticsIn(FILE);
    const marked = markersIn(FILE);
    expect(marked.length).toBe(5);
    for (const marker of marked) {
      const hit = actual.find((d) => d.line === marker.line);
      expect(hit, `no diagnostic on ${FILE}:${marker.line}`).toBeDefined();
      expect(hit!.code, `${FILE}:${marker.line}`).toBe(marker.code);
    }
  });

  it('the result is missing EXACTLY the three fields a dispatch would need', () => {
    const actual = diagnosticsIn(FILE);
    const missing = actual.find((d) => d.code === 'TS2739');
    expect(missing).toBeDefined();
    // Named individually, so a future result type that acquired any one of them fails here.
    expect(missing!.message).toContain('authorisationId');
    expect(missing!.message).toContain('reservationId');
    expect(missing!.message).toContain('dispatchPayload');
  });

  it('the payload is withheld and only its HASH crosses the boundary', () => {
    const actual = diagnosticsIn(FILE);
    const suggestion = actual.find((d) => d.code === 'TS2551');
    expect(suggestion).toBeDefined();
    // TypeScript's own suggestion states the boundary better than a comment could.
    expect(suggestion!.message).toContain("Did you mean 'dispatchPayloadHash'");
  });

  it('the verdict word is a literal type and cannot be restamped as AUTHORISED', () => {
    const actual = diagnosticsIn(FILE);
    const restamp = actual.find((d) => d.code === 'TS2322');
    expect(restamp).toBeDefined();
    expect(restamp!.message).toContain('"PRE_RESERVATION_PASS"');
    expect(restamp!.message).toContain('"AUTHORISED"');
  });
});

describe('a COMMITTED local authorisation is structurally non-dispatchable — S1F', () => {
  const FILE = 'local-authorisation-as-dispatchable.ts';

  /**
   * S1E's boundary was easy: the result carried no authorisation and no reservation, so
   * there was nothing to dispatch. S1F's is the case that matters — there IS a committed
   * authorisation, a signed decision, a real reservation and a journal row — and the type
   * must still refuse to be read as permission to reach a vendor.
   *
   * The fixture is added to the SAME project as the S1E and S1B fixtures, deliberately.
   * A second project would duplicate the harness, and the positive control above is what
   * catches a fixture that broke the project's imports.
   */
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

  it('the committed result is missing the payload a dispatch would need', () => {
    const actual = diagnosticsIn(FILE);
    const missing = actual.find((d) => d.code === 'TS2741');
    expect(missing).toBeDefined();
    expect(missing!.message).toContain('dispatchPayload');
    expect(missing!.message).toContain('LocalAuthorisationCommitted');
  });

  it('and it carries none of the four vendor-facing fields, each named individually', () => {
    // Named one by one, so a future result type that acquired ANY of them fails here rather
    // than in a review.
    const actual = diagnosticsIn(FILE);
    for (const field of ['dispatchPayload', 'idempotencyKey', 'adapter', 'monetaryEffect']) {
      const hit = actual.find(
        (d) => d.code === 'TS2339' && d.message.includes(`Property '${field}' does not exist`),
      );
      expect(hit, `the S1F terminal exposes ${field}`).toBeDefined();
    }
  });

  it('the local status is a literal type and cannot be restamped as DISPATCHED', () => {
    const actual = diagnosticsIn(FILE);
    const restamp = actual.find(
      (d) => d.code === 'TS2322' && d.message.includes('"DISPATCHED"'),
    );
    expect(restamp).toBeDefined();
    expect(restamp!.message).toContain('"AUTHORISED"');
  });

  it('a PENDING approval cannot be read as a PERMIT', () => {
    // `26 §12`: "Never auto-approve on timeout" — and never read a held tier as a permit.
    const actual = diagnosticsIn(FILE);
    const pending = actual.find(
      (d) => d.code === 'TS2322' && d.message.includes('"REQUIRE_APPROVAL"'),
    );
    expect(pending).toBeDefined();
    expect(pending!.message).toContain('"PERMIT"');
  });

  it('step V mints no new authority — the duplicate outcome has no reservation', () => {
    const actual = diagnosticsIn(FILE);
    const duplicate = actual.find(
      (d) =>
        d.code === 'TS2339' &&
        d.message.includes("Property 'reservationId' does not exist") &&
        d.message.includes('LocalAuthorisationDuplicate'),
    );
    expect(duplicate).toBeDefined();
  });
});
