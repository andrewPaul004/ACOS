import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CanonicalisationDenied,
  type DenyCode,
  type DenyDetail,
} from '../../src/kernel/canonicalisation/errors.js';
import {
  denialProjected,
  projectDenialToWorker,
} from '../../src/kernel/enumeration/workerFacingDenial.js';

/**
 * 15 — the worker-facing denial is COARSE, and the raw audit detail is a different surface.
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * `26 §2.0.1`, verbatim: "A single `DENY: SELECTOR` category covers out-of-range, stale and
 * downstream denial, so cardinality is not recoverable by binary search (CAN-05)."
 *
 * ---------------------------------------------------------------------------------
 * THIS CLOSES A CARRY-FORWARD NOTE FROM S1B
 *
 * S1B's `errors.ts` said `detail` "is for the audit record and is never rendered to a model
 * by any S1B code path" — true, and a property of its CALL SITES rather than of its types.
 * `Error.message` embeds both `detail` and `auditNote` by construction, so returning the
 * exception at any future call site would ship both.
 *
 * The tests below assert the structural form: the worker-facing value is a DIFFERENT OBJECT
 * with exactly one field, and none of the audit strings survives into it.
 * ---------------------------------------------------------------------------------
 */

const SELECTOR_FAMILY: readonly DenyCode[] = [
  'SELECTOR_MALFORMED',
  'SELECTOR_INVALID',
  'SELECTOR_STALE',
  'SELECTOR_ENUMERATION_STALE',
];

const SELECTOR_DETAILS: readonly DenyDetail[] = [
  'NOT_AN_OBJECT',
  'MISSING_FIELD',
  'EXTRA_FIELD',
  'WRONG_TYPE',
  'OPTION_ID_MISMATCH',
  'OPTION_ACTION_CLASS_MISMATCH',
  'OPTION_RESOURCE_MISMATCH',
  'REASON_CODE_SCOPE_MISMATCH',
  'ENUMERATION_UNKNOWN',
  'ENUMERATION_BINDING_MISMATCH',
  'ENUMERATION_PAST_MAX_AGE',
  'OPTION_ABSENT_FROM_LIVE_SET',
  'OPTION_NOT_IN_NAMED_ENUMERATION',
];

describe('the selector family collapses to one category', () => {
  it.each(SELECTOR_FAMILY)('%s → { deny: "SELECTOR" }', (code) => {
    const error = new CanonicalisationDenied(code, 'WRONG_TYPE', 'audit detail');
    expect(projectDenialToWorker(error)).toEqual({ deny: 'SELECTOR' });
  });

  it('EVERY selector detail collapses to the same value — the oracle returns one bit', () => {
    // The property that closes CAN-05: not "each denies" but "all deny identically". If any
    // pair were distinguishable, a prober could learn whether an option_id it constructed
    // ever existed, or whether the world moved under it.
    const responses = new Set(
      SELECTOR_FAMILY.flatMap((code) =>
        SELECTOR_DETAILS.map((detail) =>
          JSON.stringify(
            projectDenialToWorker(new CanonicalisationDenied(code, detail, `note ${detail}`)),
          ),
        ),
      ),
    );
    expect(responses.size).toBe(1);
    expect([...responses][0]).toBe(JSON.stringify({ deny: 'SELECTOR' }));
  });

  it('STALE and INVALID are indistinguishable — the timing channel is closed too', () => {
    // Separating these would tell a prober "your enumeration aged out" from "the world moved
    // against this resource", which is a channel onto concurrent activity.
    expect(
      projectDenialToWorker(
        new CanonicalisationDenied('SELECTOR_STALE', 'OPTION_ABSENT_FROM_LIVE_SET', 'x'),
      ),
    ).toEqual(
      projectDenialToWorker(
        new CanonicalisationDenied('SELECTOR_ENUMERATION_STALE', 'ENUMERATION_PAST_MAX_AGE', 'y'),
      ),
    );
  });

  it('the three non-selector categories stay distinct, as `26 §7` declares them', () => {
    // Collapsing these would remove information the architecture chose to return, without
    // closing any oracle: each is a statement about the PROPOSAL or about a published
    // control artifact, not about the option set.
    expect(
      projectDenialToWorker(new CanonicalisationDenied('MALFORMED', 'WRONG_TYPE', 'x')),
    ).toEqual({ deny: 'MALFORMED' });
    expect(
      projectDenialToWorker(
        new CanonicalisationDenied('UNKNOWN_ACTION', 'ACTION_CLASS_NOT_IN_CATALOGUE', 'x'),
      ),
    ).toEqual({ deny: 'UNKNOWN_ACTION' });
    expect(
      projectDenialToWorker(
        new CanonicalisationDenied('NOT_CANONICALISABLE', 'NO_REGISTERED_CONSTRUCTOR', 'x'),
      ),
    ).toEqual({ deny: 'NOT_CANONICALISABLE' });
  });
});

describe('the raw exception and the worker-facing response are DIFFERENT SURFACES', () => {
  const error = new CanonicalisationDenied(
    'SELECTOR_STALE',
    'OPTION_ABSENT_FROM_LIVE_SET',
    'the selected option_id is absent from the enumeration computed under the C′ entity lock',
  );

  it('they are different objects — the projection never returns the exception', () => {
    const workerFacing = projectDenialToWorker(error);
    expect(workerFacing).not.toBe(error);
    expect(workerFacing).not.toBeInstanceOf(CanonicalisationDenied);
    expect(workerFacing).not.toBeInstanceOf(Error);
  });

  it('the worker-facing value has EXACTLY ONE field, so there is nowhere to put a detail', () => {
    expect(Object.keys(projectDenialToWorker(error))).toEqual(['deny']);
  });

  it('NEITHER `message` NOR `auditNote` NOR `detail` survives the projection', () => {
    // The carry-forward note, closed. `Error.message` embeds both the detail and the audit
    // note by construction — `DENY: ${code} (${detail}) — ${auditNote}` — so a call site that
    // returned the exception would ship all three.
    const serialised = JSON.stringify(projectDenialToWorker(error));
    expect(error.message).toContain('OPTION_ABSENT_FROM_LIVE_SET');
    expect(error.message).toContain('entity lock');

    expect(serialised).not.toContain('OPTION_ABSENT_FROM_LIVE_SET');
    expect(serialised).not.toContain('entity lock');
    expect(serialised).not.toContain('STALE');
    expect(serialised).not.toContain('enumeration');
    expect(serialised).toBe('{"deny":"SELECTOR"}');
  });

  it('the audit detail is still INTACT on the exception — coarseness is not information loss', () => {
    // `26 §7`: "The audit record holds the full reason". The projection narrows what the
    // WORKER sees; it must not narrow what the audit layer can record.
    expect(error.code).toBe('SELECTOR_STALE');
    expect(error.detail).toBe('OPTION_ABSENT_FROM_LIVE_SET');
    expect(error.auditNote).toContain('C′ entity lock');
  });

  it('the returned object is FROZEN, so a caller cannot decorate it on the way out', () => {
    const workerFacing = projectDenialToWorker(error);
    expect(Object.isFrozen(workerFacing)).toBe(true);
    expect(() => {
      (workerFacing as unknown as Record<string, unknown>)['detail'] = error.detail;
    }).toThrow();
  });

  it('no near-miss information of any kind is expressible on the type', () => {
    // Stated explicitly so the intent is not carried only by the absence of fields.
    const workerFacing = projectDenialToWorker(error);
    const serialised = JSON.stringify(workerFacing);
    for (const forbidden of ['count', 'index', 'nearest', 'exceeded', 'remaining', 'options']) {
      expect(serialised, `worker-facing denial mentions ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('`denialProjected` is the shape a model-facing call site takes', () => {
  it('a denial becomes the coarse category, never the exception', async () => {
    const result = await denialProjected(async () => {
      throw new CanonicalisationDenied('SELECTOR_STALE', 'OPTION_ABSENT_FROM_LIVE_SET', 'note');
    });
    expect(result).toEqual({ ok: false, denial: { deny: 'SELECTOR' } });
  });

  it('a success passes through untouched', async () => {
    expect(await denialProjected(async () => 42)).toEqual({ ok: true, value: 42 });
  });

  it('an INTERNAL DEFECT is RETHROWN, not swallowed into DENY: SELECTOR', async () => {
    // The deliberate asymmetry. `26 §7`'s coarse-denial rule is about DENIALS. S1B's cohesion
    // checks and the `I18a`/`I18c` assertions THROW because no `ProposedIntent` can cause
    // them, and registry `I18a`'s on-violation column calls such a case a "Critical incident.
    // The action class is suspended pending investigation." Projecting one into a routine
    // category would hide it behind the most common denial in the system.
    await expect(
      denialProjected(async () => {
        throw new Error('I18a: dispatch monetary_effect != vendor_amount');
      }),
    ).rejects.toThrow('I18a');
  });
});

describe('no production module hands a worker a raw denial', () => {
  it('nothing in src/ returns `.auditNote`, `.detail` or a denial `message` outward', () => {
    // The structural assertion behind the two tests above. `workerFacingDenial.ts` reads
    // `error.code` and is the only permitted reader of the exception's contents.
    const offenders: string[] = [];
    for (const file of walk(join('src'))) {
      if (file.endsWith(join('enumeration', 'workerFacingDenial.ts'))) continue;
      if (file.endsWith(join('canonicalisation', 'errors.ts'))) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\.auditNote/.test(code)) offenders.push(`${file}: reads .auditNote`);
      if (/CanonicalisationDenied[\s\S]{0,80}\.message/.test(code)) {
        offenders.push(`${file}: reads a denial .message`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the projection reads ONLY `code` — never `detail`, `auditNote` or `message`', () => {
    const code = stripComments(
      readFileSync(join('src', 'kernel', 'enumeration', 'workerFacingDenial.ts'), 'utf8'),
    );
    expect(code).toContain('error.code');
    expect(code).not.toContain('error.detail');
    expect(code).not.toContain('error.auditNote');
    expect(code).not.toContain('error.message');
  });
});

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}
