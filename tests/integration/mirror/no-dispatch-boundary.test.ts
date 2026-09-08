import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import { createMirrorHarness, type MirrorHarness } from '../../support/mirrorFixture.js';
import {
  DISPOSITIONS,
  classifyDispatchPrecedence,
} from '../../../src/kernel/mirror/dispatchPrecedence.js';

/**
 * `§3`, `§35`, `§45` — S1H IS A STATE/DECISION SLICE. NOTHING IS DISPATCHED.
 *
 * =================================================================================
 * `§2` OF THE S1H MANDATE: "S1H STOPS BEFORE ANY EXTERNAL EFFECT IS CLAIMED OR SENT."
 *
 * `§35`: "since there is no external dispatch: do NOT manufacture fake `DISPATCHED` rows
 * merely to claim the invariant closed. If useful, the pre-dispatch classifier may return
 * `requires_unmirrored_tag = true` as a deterministic property. **Actual dispatch→tag
 * enforcement remains PARTIAL until the execution slice. Be explicit.**"
 *
 * This file is that explicitness, held as assertions over the whole of `src/` and both
 * schemas rather than as a claim in a document. It REPLACES the S1G assertion that the
 * mirror mechanism is absent — S1H builds exactly that mechanism — while keeping every
 * absence S1G asserted that S1H does not build: the anchor, the outbox, the adapter, the
 * exclusive claim, the vendor read, and any `DISPATCHED` state at all.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** Every `.ts` file under `src/`, comments stripped. */
async function sourceOf(): Promise<readonly { path: string; code: string }[]> {
  const root = join(process.cwd(), 'src');
  const out: { path: string; code: string }[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const raw = await readFile(full, 'utf8');
        out.push({
          path: full,
          code: raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
        });
      }
    }
  }
  await walk(root);
  return out;
}

describe('THE CLASSIFIER RETURNS A DISPOSITION, NOT A DISPATCH', () => {
  it('the three dispositions are `30 §5.1`s three words and nothing more', () => {
    expect([...DISPOSITIONS]).toEqual(['DISPATCH_ELIGIBLE', 'SUSPEND', 'HALT']);
  });

  it('its return value carries no payload, no adapter, no endpoint and no claim', () => {
    const decision = classifyDispatchPrecedence({
      mirrorState: 'CORROBORATED_DEGRADED',
      actionClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      clockBearing: true,
      aboveApprovalFloor: false,
      hasRecordedApproval: true,
      activeOverride: null,
      now: T0,
    });
    // The full key set. `§21`: "Do not return adapter payloads."
    expect(Object.keys(decision).sort()).toEqual([
      'disposition',
      'explanation',
      'matchedRow',
      'overrideId',
      'ownerOverrideAvailable',
      'requiresUnmirroredTag',
    ]);
    // `§35`: the tag is a deterministic PROPERTY, not a tag on anything.
    expect(decision.requiresUnmirroredTag).toBe(true);
    expect(decision.disposition).toBe('DISPATCH_ELIGIBLE');
  });

  it('and it is PURE — the same operands give the same answer, with no I/O', () => {
    const operands = {
      mirrorState: 'UNCORROBORATED_STALL' as const,
      actionClass: 'refund.create' as const,
      recoverability: 'COMPENSABLE' as const,
      clockBearing: true,
      aboveApprovalFloor: true,
      hasRecordedApproval: true,
      activeOverride: null,
      now: T0,
    };
    const first = classifyDispatchPrecedence(operands);
    for (let i = 0; i < 100; i += 1) {
      expect(classifyDispatchPrecedence(operands)).toEqual(first);
    }
  });
});

describe('NO EXTERNAL CALL SURFACE EXISTS ANYWHERE IN `src/`', () => {
  it('no HTTP client, no fetch, no socket', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      // The patterns name TRANSPORT, not any identifier containing the word. `26 §7`'s
      // precondition and pre-reservation modules both have local `fetch*` helpers that read
      // PostgreSQL, and matching a bare `fetch(` would flag them and prove nothing.
      for (const pattern of [
        /globalThis\.fetch/,
        /require\(['"](node:)?https?['"]\)/,
        /from\s+['"](node:)?https?['"]/,
        /from\s+['"](node:)?net['"]/,
        /from\s+['"](node:)?dgram['"]/,
        /from\s+['"]axios['"]/,
        /from\s+['"]undici['"]/,
        /from\s+['"]node-fetch['"]/,
        /new\s+WebSocket/,
        /XMLHttpRequest/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `external call surface in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('no adapter, no outbox, no exclusive claim, no vendor query, no anchor', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      // The ACCEPTED S1A settlement-observation writer is a LOCAL ledger move, named here so
      // its exemption stays deliberate — exactly as `local-authorisation-boundary.test.ts`
      // names it.
      if (path.endsWith(join('exposure', 'reconciler.ts'))) continue;
      //
      // The patterns name MECHANISM, not vocabulary. `26 §5`'s action catalogue legitimately
      // declares an `adapter` FIELD naming a mock — "all against a mock adapter" is `37` S1's
      // own scope — so a bare `/adapter/` would flag the catalogue and every module that
      // reads it, and would prove nothing. What must be absent is an adapter MODULE, an
      // outbox, an exclusive claim, a vendor read and the hourly anchor.
      for (const pattern of [
        /from\s+['"][^'"]*adapters?\//,
        /callAdapter/i,
        /adapterClient/i,
        /\.dispatch\s*\(/,
        /\boutbox\b/i,
        /outboxClaim/i,
        /exclusiveClaim/i,
        /vendorQuery/i,
        /vendorRead/i,
        /externalAnchor/i,
        /anchorHead/i,
        /hourlyAnchor/i,
        /\bsettled_total\b/,
        /shopify/i,
        /stripe/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `dispatch machinery in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('and `DISPATCHED` is not a state of anything', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      // `DISPATCHED_UNMIRRORED` APPEARS AS A DECLARED TAG NAME, which `§35` permits: the
      // classifier's `requiresUnmirroredTag` is "a deterministic property". What must NOT
      // appear is a `DISPATCHED` STATUS an effect could hold.
      const withoutTagName = code.replace(/DISPATCHED_UNMIRRORED/g, '');
      for (const pattern of [
        /'DISPATCHED'/,
        /"DISPATCHED"/,
        /status\s*=\s*'DISPATCHED/,
        /dispatched_at/,
        /markDispatched/i,
      ]) {
        if (pattern.test(withoutTagName)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `a DISPATCHED state in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

describe('THE MIRROR MECHANISM IS CONFINED TO ITS OWN DIRECTORIES', () => {
  it('mirror state, the signal and the override live only where they belong', async () => {
    // S1G asserted these were ABSENT from all of `src/`. S1H builds them, so the property
    // becomes CONFINEMENT: the money path, the canonicaliser, the policy engine and the
    // exposure ledger must still know nothing about the mirror.
    const allowed = [
      `${sep}kernel${sep}mirror${sep}`,
      `${sep}kernel${sep}clocks${sep}`,
      `${sep}audit${sep}`,
      `${sep}replication${sep}`,
      `${sep}db${sep}`,
    ];
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      if (allowed.some((dir) => path.includes(dir))) continue;
      for (const pattern of [
        /mirrorState/i,
        /MirrorInputStall/,
        /CORROBORATED_DEGRADED/,
        /UNCORROBORATED_STALL/,
        /DegradedModeOverride/,
        /DISPATCHED_UNMIRRORED/,
        /classifyDispatchPrecedence/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `mirror mechanism outside its directories:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the LOCAL AUTHORISATION TRANSACTION still knows nothing about the mirror', async () => {
    // The sharpest form: the module that owns the S1F money transaction cannot reach the
    // mirror state at all, so no authorisation decision can depend on it. `30 §5.1`'s
    // ordering puts the precedence evaluation AFTER the commit and after the audit push.
    const code = (
      await readFile(
        join(process.cwd(), 'src', 'kernel', 'authorisation', 'localAuthorisation.ts'),
        'utf8',
      )
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const pattern of [
      /mirror/i,
      /corroboration/i,
      /override/i,
      /precedence/i,
      /statutory_clock/,
    ]) {
      expect(code, String(pattern)).not.toMatch(pattern);
    }
  });

  it('and no file in `src/` imports from `tests/`', async () => {
    // The vulnerable controls live under `tests/negative-controls/`. If production could
    // import one, the discrimination they establish would be meaningless.
    const files = await sourceOf();
    for (const { path, code } of files) {
      expect(code, path).not.toMatch(/from\s+['"].*tests\//);
      expect(code, path).not.toMatch(/unsafe-/);
    }
  });
});

describe('NEITHER DATABASE HAS A DISPATCH SURFACE', () => {
  it('the control schema has no dispatch table and no dispatch column', async () => {
    const client = await h.control.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      for (const row of tables.rows) {
        expect(row.table_name).not.toMatch(/outbox|dispatch|adapter|vendor/i);
      }
      const columns = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name ~ 'dispatch'`,
      );
      // THREE columns match `dispatch`, and each is named here so its presence is deliberate:
      //
      //   `dispatch_payload_hash`  the ACCEPTED S1B canonicaliser column — the HASH of a
      //                            payload that is never sent.
      //   `effects_dispatched`     `30 §5.7.2` item 3's override counters, incremented in the
      //   `monetary_dispatched`    transaction that WOULD dispatch. `§18` of the mandate
      //                            calls it "the pre-dispatch override allowance".
      //
      // Nothing else. In particular no `dispatched_at`, which would be a record of a send.
      for (const row of columns.rows) {
        expect(
          ['dispatch_payload_hash', 'effects_dispatched', 'monetary_dispatched'],
          `${row.table_name}.${row.column_name}`,
        ).toContain(row.column_name);
      }
    } finally {
      client.release();
    }
  });

  it('the audit schema has no dispatched-effect surface', async () => {
    const client = await h.auditOwner.connect();
    try {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name ~ 'dispatch'`,
      );
      // The audit store mirrors the control journal, so it carries the payload HASH and
      // nothing else — no override counters, because the override is control-plane state.
      for (const row of columns.rows) {
        expect(row.column_name).toBe('dispatch_payload_hash');
      }
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      for (const row of tables.rows) {
        expect(row.table_name).not.toMatch(/outbox|dispatch|adapter|vendor/i);
      }
    } finally {
      client.release();
    }
  });

  it('and no effect row can be in a dispatched state, because there is none', async () => {
    const client = await h.control.connect();
    try {
      const checks = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'effect'::regclass AND contype = 'c'`,
      );
      for (const row of checks.rows) {
        expect(row.def).not.toMatch(/DISPATCHED/);
      }
      const effects = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM effect WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(effects.rows[0]!.n).toBe('0');
    } finally {
      client.release();
    }
  });
});

describe('WHAT `§41` CARRIES FORWARD AS OPEN, ASSERTED AS ABSENCES', () => {
  it('`I8`s vendor reads, `I17b`s external anchor and the reaper are all absent', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [/inverseSweep/i, /vendorCredential/i, /reaper/i, /I17b/]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `S1H claimed something it did not build:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('approval RESUME and `R′` are still unbuilt', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [/resumeApproval/i, /verifyMode/i, /RESUMING/]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
