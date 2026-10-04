import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authorisePause,
  createOutboxHarness,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import * as claimModule from '../../../src/kernel/outbox/claim.js';
import * as enqueueModule from '../../../src/kernel/outbox/enqueue.js';
import * as recoveryModule from '../../../src/kernel/outbox/recovery.js';
import * as stateModule from '../../../src/kernel/outbox/outboxState.js';
import * as tagModule from '../../../src/kernel/outbox/correlationTag.js';
import { OUTBOX_STATUSES } from '../../../src/kernel/outbox/outboxState.js';
import { withoutProviderEvidenceSurface } from '../../support/providerEvidenceSurface.js';

/**
 * `§30`, `§40`, `§41`, `§47` — WHERE S1I STOPS, HELD AS ASSERTIONS RATHER THAN AS A CLAIM.
 *
 * =================================================================================
 * `§2` OF THE S1I MANDATE:
 *
 *   LOCAL AUTHORISATION COMMITTED → audit/mirror state → S1H pre-dispatch classifier →
 *   durable OUTBOX row → exclusive durable CLAIM → **STOP**
 *
 *   "S1I DOES NOT CONTINUE TO: HTTP request, or vendor adapter, or external effect."
 *
 * `§47`: "Explicitly state: S1I does NOT provide external exactly-once. What S1I proves:
 * one durable outbox identity; one durable claim; no blind reclaim. What remains: what
 * happened after request leaves process; vendor idempotency; vendor query; outcome
 * reconciliation; provider delivery evidence; external exactly-once."
 *
 * This file is that boundary, asserted over the whole of `src/`, over both database
 * schemas, and over the outbox modules' own exported surface. It is the S1I successor to
 * the accepted `no-dispatch-boundary.test.ts`, which is amended in exactly two patterns —
 * the outbox and the exclusive claim — and keeps every other absence global.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');

beforeAll(async () => {
  h = await createOutboxHarness();
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

async function outboxSourceOf(): Promise<readonly { path: string; code: string }[]> {
  const files = await sourceOf();
  return files.filter(({ path }) => path.includes(`${sep}kernel${sep}outbox${sep}`));
}

describe('`§40` — NO NETWORK, SCOPED TO THE EXTERNAL-EFFECT PATH', () => {
  it('the outbox directory imports no HTTP client, no socket and no vendor SDK', async () => {
    /*
     * `§40`: "Add a strict source/boundary test proving S1I production modules contain/
     * import no fetch, axios, HTTP client, vendor SDK, adapter transport, network socket
     * for business-effect dispatch. Database/audit infrastructure already accepted
     * elsewhere should not be falsely flagged. Scope the assertion to S1I's
     * external-effect path."
     *
     * SCOPED, AS ASKED. `pg` is the accepted database driver and opens a real TCP socket;
     * flagging it would be a false positive and would prove nothing about dispatch. What
     * must be absent is a client capable of reaching a VENDOR.
     */
    const files = await outboxSourceOf();
    expect(files.length).toBeGreaterThanOrEqual(5);
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /globalThis\.fetch/,
        /\bfetch\s*\(/,
        /require\(['"](node:)?https?['"]\)/,
        /from\s+['"](node:)?https?['"]/,
        /from\s+['"](node:)?net['"]/,
        /from\s+['"](node:)?dgram['"]/,
        /from\s+['"](node:)?tls['"]/,
        /from\s+['"]axios['"]/,
        /from\s+['"]undici['"]/,
        /from\s+['"]node-fetch['"]/,
        /new\s+WebSocket/,
        /XMLHttpRequest/,
        /from\s+['"][^'"]*adapters?\//,
        /shopify/i,
        /stripe/i,
        /sendgrid/i,
        /mailgun/i,
        /Authorization/,
        /Bearer/,
        /apiKey/i,
        /credential/i,
        /endpoint/i,
        /baseUrl/i,
        /https?:\/\//,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `a transport surface in src/kernel/outbox/:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and it imports only the kernel modules it is allowed to', async () => {
    /*
     * The positive form, which is stronger than a denylist: the import list is enumerated
     * by hand, so a NEW dependency fails this test rather than slipping past a pattern.
     */
    const allowed = [
      'node:crypto',
      '../../db/pool.js',
      '../exposure/errors.js',
      '../exposure/money.js',
      '../mirror/degradedModeOverride.js',
      '../mirror/dispatchPrecedence.js',
      '../mirror/mirrorStateMachine.js',
      // v1.3.4 (CSB-01). `30 §5.1` row 3's operand comes from the ACCEPTED S1H clock
      // module, imported rather than reimplemented — the same rule `§13` states for the
      // precedence classifier, applied to its operands.
      '../clocks/statutoryClock.js',
      '../canonicalisation/actionCatalogue.js',
      './correlationTag.js',
      './outboxState.js',
      './enqueue.js',
      // v1.3.6 (`50 §3f`'s pre-claim gate). ONE new dependency: `claim.ts` asserts an ACTIVE
      // verified control-artifact bundle before the irreversible step, because `25 §7` puts
      // the claim "in a committed transaction BEFORE the HTTP call" and `CLAIMED` has no
      // timeout, lease, expiry or reclaim. A claim taken while the kernel holds no verified
      // bundle would be an at-most-once commitment spent under authority nobody checked.
      //
      // It imports the REGISTRY's accessor and not a loader: `registry.ts` is the only
      // module that can verify or publish, and `boundaries.test.ts` asserts that the
      // verifier, the trust configuration and the artifact package each have exactly one
      // production call site there.
      '../controlArtifacts/registry.js',
    ];
    const files = await outboxSourceOf();
    const seen = new Set<string>();
    for (const { path, code } of files) {
      for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!;
        seen.add(specifier);
        expect(allowed, `${path} imports ${specifier}`).toContain(specifier);
      }
    }
    // The mirror modules ARE imported, and that is `§13`'s requirement rather than a leak:
    // "Reuse S1H's accepted deterministic classifier. Do not create an alternate dispatch
    // precedence implementation."
    expect(seen).toContain('../mirror/dispatchPrecedence.js');
    expect(seen).toContain('../mirror/mirrorStateMachine.js');
    expect(seen).toContain('../mirror/degradedModeOverride.js');
    // And so is the ACCEPTED clock module, for the same reason: `30 §9.2.4`'s derivation
    // reads a LIVE `I56`-provenanced clock, and `isClockBearingOn` is the accepted
    // implementation of that predicate. A second one in this directory would be a second
    // reading of row 3's operand.
    expect(seen).toContain('../clocks/statutoryClock.js');
  });

  it('there is no scheduler, no poller and no background worker — `§6`', async () => {
    /*
     * `§6`: "Do NOT wire a production polling loop that automatically transitions eligible
     * outbox rows to CLAIMED [...] an automatic production poller would strand real rows in
     * CLAIMED without the next mechanism existing."
     */
    const files = await outboxSourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /setInterval/,
        /setTimeout/,
        /setImmediate/,
        /cron/i,
        /\bpoll\b/i,
        /startWorker/i,
        /runLoop/i,
        /while\s*\(true\)/,
        /for\s*\(;;\)/,
        /\.subscribe\s*\(/,
        /LISTEN\s/i,
        /NOTIFY\s/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `a scheduler in src/kernel/outbox/:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('and no production module imports from `tests/`', async () => {
    const files = await sourceOf();
    for (const { path, code } of files) {
      expect(code, path).not.toMatch(/from\s+['"].*tests\//);
      expect(code, path).not.toMatch(/unsafe-/);
    }
  });
});

describe('`§30` — THE CLAIM CANNOT BE BYPASSED', () => {
  it('the outbox modules export exactly the declared surface, and no force-claim', async () => {
    /*
     * `§30`: "Do not expose a low-level exported production function that says
     * `forceClaim(outboxId)` without performing the current eligibility checks."
     *
     * ASSERTED AGAINST A HAND-AUTHORED LIST, so a new export fails this test rather than
     * being caught only by a pattern. This is the module-boundary test `§30` asks for.
     */
    expect(Object.keys(claimModule).sort()).toEqual([
      'claimForExternalDispatch',
      'claimForExternalDispatchOn',
      'clockBearingAtClaim',
    ]);
    expect(Object.keys(enqueueModule).sort()).toEqual([
      'claimableCandidates',
      'enqueueDispatch',
      'enqueueDispatchOn',
      'readByEffect',
      'readByIdempotencyKey',
    ]);
    expect(Object.keys(recoveryModule).sort()).toEqual([
      'missingOutboxWork',
      'missingOutboxWorkOn',
      'recoverMissingOutboxRows',
    ]);
    expect(Object.keys(tagModule).sort()).toEqual([
      'CORRELATION_TAG_PREFIX',
      'isCorrelationTag',
      'mintCorrelationTag',
    ]);
    expect(Object.keys(stateModule).sort()).toEqual([
      'CLAIM_REFUSALS',
      'ENQUEUE_REFUSALS',
      'OUTBOX_COLUMNS',
      'OUTBOX_STATUSES',
      'toOutboxRow',
    ]);
  });

  it('no `forceClaim`, `markClaimed` or eligibility-skipping option exists anywhere', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /forceClaim/i,
        /markClaimed/i,
        /claimWithout/i,
        /skipEligibility/i,
        /skipPrecedence/i,
        /bypassClassifier/i,
        /ignoreMirror/i,
        /unsafeClaim/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `a claim bypass in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the MOST PUBLIC claim surface refuses a HALTED effect', async () => {
    /*
     * `§30`'s required attack: "call the most public claim surface while effect is HALTED.
     * Expected: no claim."
     *
     * The most public surface is `claimForExternalDispatch`, which takes a pool and four
     * scalars. There is no options object, no flag and no second entry point.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-BYPASS' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:bypass',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });

    // Put the company into the FULL-HALT POSTURE, where row 5 halts and no override can
    // restore it (`30 §5.1a`: "`precedence_rows` cannot hold 5").
    const { declareMirrorDegraded } = await import(
      '../../../src/kernel/mirror/mirrorStateMachine.js'
    );
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);
    const halted = new Date(NOW.getTime() + 31 * 60_000);

    const result = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:bypass-attempt',
      now: halted,
    });
    expect(result.kind).toBe('REFUSED');
    if (result.kind === 'REFUSED') expect(result.reason).toBe('PRE_DISPATCH_HALTED');
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });

  it('and there is no SECOND precedence implementation in the outbox directory', async () => {
    /*
     * `§13`: "Reuse S1H's accepted deterministic classifier. Do not create an alternate
     * dispatch precedence implementation."
     *
     * What must be absent is an ordered row evaluation of its own: no row predicates, no
     * first-match loop, no recoverability switch that decides a disposition.
     */
    const files = await outboxSourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /matchesRow/,
        /ROW_PREDICATES/,
        /PRECEDENCE_ROW_ORDER\s*=/,
        /DISPOSITIONS\s*=/,
        /'DISPATCH_ELIGIBLE'\s*[:;,]/,
        /isAboveDegradedApprovalFloor/,
        /isFullHaltPosture/,
        /DEGRADED_PER_ACTION_APPROVAL_FLOOR/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `a second precedence implementation:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
    // And `classifyDispatchPrecedence` IS called — exactly once, from `claim.ts`.
    const callers = files.filter(({ code }) => /classifyDispatchPrecedence\(/.test(code));
    expect(callers.map((c) => c.path.replace(`${process.cwd()}${sep}`, ''))).toEqual([
      join('src', 'kernel', 'outbox', 'claim.ts'),
    ]);
  });
});

describe('`§41` — NOTHING IS MARKED EXTERNALLY DISPATCHED', () => {
  it('`DISPATCHED`, `EXECUTED`, `VERIFIED` and `SETTLED` are not states of anything', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      // `DISPATCHED_UNMIRRORED` is a DECLARED TAG NAME and `30 §5.7.2` item 5 requires it;
      // `§16` permits carrying the requirement. What must not appear is a status an effect
      // could hold.
      const withoutTagName = code.replace(/DISPATCHED_UNMIRRORED/g, '');
      for (const pattern of [
        /'DISPATCHED'/,
        /"DISPATCHED"/,
        /status\s*=\s*'DISPATCHED/,
        /dispatched_at/,
        /markDispatched/i,
        /'EXECUTED'/,
        /'SETTLED'/,
        /'NEVER_SENT'/,
        /*
         * `'PRESUMED_EXECUTED'` HAS LEFT THIS SWEEP — v1.3.5 (MIE-01), and it is a
         * consequence of the declaration rather than a relaxation.
         *
         * S1I banned it because v1.3.4 reached it only through a consumption no artifact
         * defined; `25 §10.1` now declares the movement and `25 §7.1` makes it the state an
         * IRRECOVERABLE effect reaches from the adapter's own typed outcome. It is a LOCAL
         * state, not provider evidence — `25 §10.1`: "The unit does not move directly to
         * `realised`, because a presumption is not a realisation and provider truth is
         * unverified."
         *
         * THE PROPERTY THIS SUITE OWNS IS UNCHANGED AND IS STILL ASSERTED: no module under
         * `src/kernel/outbox/` names it. The check below is scoped to this directory, where
         * it was always the sharper claim, and `'VERIFIED'`, `'NEVER_SENT'`, `'EXECUTED'`
         * and `'SETTLED'` remain banned everywhere because each asserts provider truth.
         */
      ]) {
        if (pattern.test(withoutTagName)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `an external-outcome state in src/:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );

    // AND `PRESUMED_EXECUTED` IS STILL ABSENT FROM THE OUTBOX DIRECTORY ITSELF. `25 §7`
    // OBX-01 gives the outbox row exactly two states, and a post-dispatch effect status is
    // not one of them: the outcome row carries it (`25 §7.1`), and this directory does not
    // know that the outcome row exists.
    const outboxOnly = files.filter(({ path }) => path.includes(`${sep}outbox${sep}`));
    expect(outboxOnly.length).toBeGreaterThan(0);
    for (const { path, code } of outboxOnly) {
      expect(/'PRESUMED_EXECUTED'/.test(code), `${path} names PRESUMED_EXECUTED`).toBe(false);
      expect(/'VERIFIED'/.test(code), `${path} names VERIFIED`).toBe(false);
    }
  });

  it('the outbox status domain is exactly `ENQUEUED` and `CLAIMED`', () => {
    // `§22`: use the exact architecture-declared states; invent none. `CLAIMED` is
    // `25 §7`'s literal; `ENQUEUED` is `S1I-C2`'s declared pre-claim name.
    expect([...OUTBOX_STATUSES]).toEqual(['ENQUEUED', 'CLAIMED']);
  });

  it('running enqueue → evaluation → claim produces no external-outcome row anywhere', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-NO-OUTCOME' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:no-outcome',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:no-outcome',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');

    const client = await h.control.connect();
    try {
      // Every text column of every row in the control database, scanned for an
      // external-outcome literal. Blunt on purpose: the property is that no such value
      // exists ANYWHERE, and a per-table assertion would miss a table added later.
      const columns = await client.query<{ table_name: string; column_name: string }>(
        `SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND c.data_type = 'text'
            AND t.table_type = 'BASE TABLE'`,
      );
      for (const { table_name, column_name } of columns.rows) {
        const hits = await client.query<{ n: string }>(
          `SELECT count(*)::TEXT AS n FROM "${table_name}"
            WHERE "${column_name}" IN ('DISPATCHED', 'EXECUTED', 'SETTLED',
                                       'PRESUMED_EXECUTED', 'VERIFIED', 'NEVER_SENT')`,
        );
        expect(hits.rows[0]!.n, `${table_name}.${column_name}`).toBe('0');
      }
    } finally {
      client.release();
    }
  });

  it('and the AUDIT store holds no external-outcome value either', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-AUDIT-OUTCOME' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:audit-outcome',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:audit-outcome',
      now: NOW,
    });
    await h.replication.pusher().pushPending(COMPANY_ID, 100);

    const client = await h.auditOwner.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      for (const row of tables.rows) {
        // No outbox, dispatch, adapter or vendor relation on the audit plane at all: the
        // audit store mirrors the JOURNAL, not the control plane's own machinery.
        expect(row.table_name).not.toMatch(/outbox|dispatch|adapter|vendor/i);
      }
      const kinds = await client.query<{ journal_row_kind: string }>(
        `SELECT DISTINCT journal_row_kind FROM audit_journal WHERE company_id = $1`,
        [COMPANY_ID],
      );
      // `OUTBOX_CLAIMED` arrives; nothing that names a dispatch does.
      expect(kinds.rows.map((r) => r.journal_row_kind)).toContain('OUTBOX_CLAIMED');
      for (const row of kinds.rows) {
        expect(row.journal_row_kind).not.toMatch(/DISPATCHED$|EXECUTED|SETTLED/);
      }
    } finally {
      client.release();
    }
  });
});

describe('`§47` — THE LIMITS OF THE CLAIM, STATED AS ASSERTIONS', () => {
  it('the claim result carries no provider outcome, no response and no accepted count', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-LIMITS' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:limits',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:limits',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');
    if (claim.kind !== 'CLAIMED') return;

    // The FULL key set of what a claim hands back. `§21`'s S1H rule applied to S1I: no
    // adapter, no endpoint, no payload destination, no provider anything.
    expect(Object.keys(claim.claim).sort()).toEqual([
      // v1.3.4 (CSB-01). `30 §9.2.5`'s evidentiary clock — an ACOS-side statutory
      // reference, not a provider anything. NULL unless row 3 is the reason.
      'claimClockRef',
      'decision',
      'journalSeq',
      'matchedRow',
      'mirrorState',
      'overrideId',
      'requiresUnmirroredTag',
      'row',
    ]);
    // And the row it carries is the outbox row, whose own key set names no provider field.
    expect(Object.keys(claim.claim.row)).not.toContain('providerResponse');
    expect(Object.keys(claim.claim.row)).not.toContain('acceptedCount');
    expect(Object.keys(claim.claim.row)).not.toContain('endpoint');
    expect(Object.keys(claim.claim.row)).not.toContain('httpStatus');
  });

  it('`I20`s provider-accepted count has no subject: the audit plane holds no vendor read', async () => {
    /*
     * `§46`: "I20 compares provider-reported accepted irrecoverable effects against
     * reserved units. S1I has no provider. Therefore I20 REMAINS OPEN. Do not manufacture
     * provider accepted counts. Outbox row count is NOT provider accepted count. Claim
     * count is NOT provider accepted count."
     *
     * Asserted as the absence it is: no vendor credential, no vendor read, no accepted
     * count anywhere in `src/`.
     */
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code: raw } of files) {
      // v1.3.8 — the declared provider-evidence surface's exact tokens are removed first, and
      // only from its declared files (`tests/support/providerEvidenceSurface.ts`). Every pattern
      // below still applies to every file, those included.
      const code = withoutProviderEvidenceSurface(path, raw);
      for (const pattern of [
        /acceptedCount/i,
        /providerAccepted/i,
        /vendorCredential/i,
        /inverseSweep/i,
        /deliveryEvent/i,
        /reconcileOutcome/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `an I20/I8 surface in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('and the residuals `§50` carries forward are still absent', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /resumeApproval/i,
        /verifyMode/i,
        /RESUMING/,
        /externalAnchor/i,
        /hourlyAnchor/i,
        /reaper/i,
        /I17b/,
        /symcc/i,
        /standingRevocationExecute/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `S1I claimed something it did not build:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });
});
