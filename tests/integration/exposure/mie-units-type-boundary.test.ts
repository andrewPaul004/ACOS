import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `§4` — `irrecoverable_units` IS NOT AN ARGUMENT, AT COMPILE TIME.
 *
 * =================================================================================
 * WHY THIS ATTACK HAS NO HONEST RUNTIME FORM
 *
 * `§4` of the S1J continuation mandate: "Do not add a generic `irrecoverableUnits` argument
 * to worker-facing APIs. Required type/source negative tests." `51 §2.3` states the property
 * the mandate is enforcing: "**There is no generic caller parameter for it, and no request
 * field carries one.**"
 *
 * A RUNTIME test for "the caller cannot supply a unit count" would have to add the parameter
 * first, and the parameter would then BE the defect — the argument the accepted `I21`, S1D,
 * S1E, S1F, S1I and S1J boundary harnesses each record, and the reason `36 §2` deleted
 * v1.0's precondition test ("a test that passes trivially once the type is right").
 *
 * So the proof is a real `tsc` run over the SHARED `tests/type-negative/` project,
 * discriminated the same way: expected diagnostics on expected lines, no diagnostic on an
 * unmarked line, and — the half that matters most here — a set of cases that MUST COMPILE,
 * so the fixture cannot pass by being uniformly broken.
 *
 * THE RUNTIME HALF IS `tests/integration/exposure/mie-reservation.test.ts`, which shows the
 * catalogue supplying the figure and step R writing it.
 * =================================================================================
 */

const PROJECT = 'tests/type-negative';
const FILE = 'mie-units-as-argument.ts';

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

describe('`51 §2.3` — NO RESERVATION SURFACE ACCEPTS A UNIT COUNT', () => {
  it('the compile produced diagnostics at all — an empty run would prove nothing', () => {
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('every marked line produced exactly the marked diagnostic', () => {
    const actual = diagnosticsIn(FILE);
    const marked = markersIn(FILE);
    expect(marked.length, 'the fixture carries no markers').toBe(6);
    for (const marker of marked) {
      const hit = actual.find((d) => d.line === marker.line);
      expect(hit, `no diagnostic on ${FILE}:${marker.line}`).toBeDefined();
      expect(hit!.code, `${FILE}:${marker.line}`).toBe(marker.code);
    }
  });

  it('and no diagnostic appeared on a line the fixture did not mark', () => {
    /*
     * THE HALF THAT MAKES THE FIXTURE DISCRIMINATE. Several cases at the end of the file MUST
     * COMPILE — the two ledger movements, which legitimately take a `units` argument because
     * they ARE the movement, and `WindowTarget.countUnits`, which is a request field by
     * design. A fixture in which everything failed would prove only that it was broken.
     */
    const actual = diagnosticsIn(FILE);
    const markedLines = new Set(markersIn(FILE).map((m) => m.line));
    const stray = actual.filter((d) => !markedLines.has(d.line));
    expect(stray, JSON.stringify(stray, null, 2)).toHaveLength(0);
  });

  it('each refusal names the field the architecture forbids', () => {
    const actual = diagnosticsIn(FILE);
    const hits = actual.filter((d) => d.message.includes("'irrecoverableUnits' does not exist"));
    // Four request/dispatch surfaces: the ordinary reservation, the per-window target, the
    // rate branch, and the gateway's own input. `25 §10.1` reserves "against every applicable
    // MIE window instance" with ONE catalogue-declared count, so a per-window figure is as
    // forbidden as a per-request one.
    expect(hits.length).toBeGreaterThanOrEqual(4);

    // `§33` / `25 §7.2`: an adapter reports WHAT HAPPENED TO ITS CALL. It does not choose a
    // unit count and it does not choose its own basis string.
    expect(
      actual.some((d) => d.message.includes("'irrecoverableUnits' does not exist")),
    ).toBe(true);
    expect(
      actual.some(
        (d) =>
          d.code === 'TS2322' &&
          d.message.includes('PRE_SEND_FAILURE') &&
          d.message.includes('PROVIDER_REJECTED_NO_MUTATION'),
      ),
      'a free-form NOT_SENT_CONFIRMED basis must not be assignable',
    ).toBe(true);
  });

  it('SOURCE CHECK — no production reservation surface names the field', async () => {
    /*
     * The second mechanism (`36 §0`). The type fixture proves the shape a CALLER sees; this
     * proves the shape the SOURCE declares, over the two modules that own the money path.
     *
     * `stepR.ts` mentions `irrecoverableUnits` as a LOCAL resolved from the catalogue, so the
     * assertion is narrowed to the declaration forms a request type would use.
     */
    const read = await import('node:fs/promises');
    for (const path of [
      'src/kernel/exposure/stepR.ts',
      'src/kernel/gateway/effectGateway.ts',
      'src/kernel/gateway/adapterPort.ts',
    ]) {
      const code = (await read.readFile(path, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(
        /readonly\s+irrecoverableUnits\s*[?:]/.test(code),
        `${path} declares irrecoverableUnits as a field`,
      ).toBe(false);
    }

    // AND THE VERIFIED CATALOGUE ENTRY DOES DECLARE IT — the positive half, so the check
    // above cannot pass by the field having been deleted entirely.
    //
    // v1.3.6 (`50 §2a` field 7) moved the DECLARATION with the authority: the field is now a
    // member of the parsed representation of the signed class-3 artifact, in
    // `controlArtifacts/bundle.ts`, which `actionCatalogue.ts` re-exports as
    // `ActionCatalogueEntry`. That is a stronger position for it than a literal in the
    // canonicalisation tree, and it is still not a request field anywhere.
    const verifiedEntry = await read.readFile(
      'src/kernel/controlArtifacts/bundle.ts',
      'utf8',
    );
    expect(/readonly\s+irrecoverableUnits\s*:\s*bigint/.test(verifiedEntry)).toBe(true);

    // And `actionCatalogue.ts` still exposes it by that type, so a consumer reaches the same
    // field through the same name it always did.
    const catalogue = await read.readFile(
      'src/kernel/canonicalisation/actionCatalogue.ts',
      'utf8',
    );
    expect(catalogue).toContain('export type ActionCatalogueEntry = VerifiedActionCatalogueEntry;');
  });
});
