import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  claimJournalRows,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { auditRows, sha256 } from '../../support/replicationFixture.js';
import { signalFieldsAt, signalSignedWith } from '../../support/mirrorFixture.js';
import {
  dispatchOutcomeFields,
  frameField,
  oracleCanonicalBytes,
  oracleRowHash,
} from '../../support/jcs1Oracle.js';
import {
  ADAPTER_ADS,
  outcomeJournalRows,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome, unknownOutcome } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import {
  consumeCorroboration,
  declareMirrorDegraded,
  evaluateState,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { signalSigningBytes } from '../../../src/kernel/mirror/corroborationSignal.js';

/**
 * `§36`, `§37`, `§38` — THE `DISPATCH_OUTCOME` JOURNAL ROW.
 *
 * =================================================================================
 * THREE IMPLEMENTATIONS, JUDGED AGAINST A FOURTH — `36 §0`, `30 §5.3`
 *
 * `30 §5.3`: "`36 §2.6` cross-implements it: the same fixture rows serialised by both
 * triggers must produce byte-identical output." The two triggers are
 * `effect_journal_canonical_bytes` (control, `0012`) and `audit_journal_canonical_bytes`
 * (audit, `A0007`), transcribed independently from `S1J-contract.md §5`. NEITHER IS
 * COMPARED TO THE OTHER: both are compared to `dispatchOutcomeFields` in `jcs1Oracle.ts`,
 * which is hand-authored and imports nothing from `src/`.
 *
 * `30 §5.3a`'s own obligation, quoted, is why: "agreement two implementations obtain from
 * one source is not a cross-implementation check."
 * =================================================================================
 *
 * =================================================================================
 * THE CONTROL-ARTIFACT CONSEQUENCE, DISCLOSED AND NOT DISCHARGED — `§36`
 *
 * `30 §5.3a` declares a field order for `acos.journal.outbox_claimed.v1` and for NO OTHER
 * KIND, and says "a row kind in service without one there is a defect of this class". S1J
 * puts a second kind in service, so its order is an IMPLEMENTATION DECLARATION recorded as
 * `S1J-C5` — the position `S1I-C4` occupied before the owner made `§5.3a` normative.
 *
 * `ACOS-JCS-1` is control artifact CLASS 20, whose signed content is "column order per row
 * kind". Declaring an order for a kind that had none MOVES class 20's `content_hash` and
 * therefore its signature. That signature has been owed since v1.3.2 and is STILL OWED;
 * S1J extends the same owed obligation and DISCHARGES NOTHING. Nothing in this file, in
 * `0012` or in `A0007` claims otherwise.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(resourceId: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${resourceId}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

function adsMock(outcome = returnedOutcome()): ReturnType<typeof createMockAdapter> {
  return createMockAdapter({
    adapterId: ADAPTER_ADS,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
    outcome,
  });
}

async function dispatched(
  resourceId: string,
  outcome = returnedOutcome(),
  at: Date = NOW,
): Promise<AuthorisedEffect> {
  const effect = await enqueuedPause(resourceId);
  const result = await dispatchAuthorisedEffect(h.control, testRegistry(adsMock(outcome)), {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    dispatchedBy: 'worker:journal',
    now: at,
  });
  expect(result.kind).toBe('OUTCOME_RESOLVED');
  return effect;
}

/** Read the control trigger's own bytes for one journal row. */
async function controlBytes(journalSeq: bigint): Promise<Buffer> {
  const client = await h.control.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT effect_journal_canonical_bytes(j.*) AS bytes
         FROM effect_journal j
        WHERE j.company_id = $1 AND j.journal_seq = $2`,
      [COMPANY_ID, journalSeq.toString()],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

/** Read the AUDIT trigger's own bytes for the same logical row, on the other server. */
async function auditBytes(journalSeq: bigint): Promise<Buffer> {
  const client = await h.auditEvaluator.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT audit_journal_canonical_bytes(j.*) AS bytes
         FROM audit_journal j
        WHERE j.company_id = $1 AND j.journal_seq = $2`,
      [COMPANY_ID, journalSeq.toString()],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

describe('`§36` — THE CONTROL TRIGGER AGREES WITH THE HAND-AUTHORED ORACLE', () => {
  it('a successful outcome, no override: bytes and row hash both match', async () => {
    await dispatched('CMP-J-OK');
    const entry = (await outcomeJournalRows(h.control))[0]!;
    expect(entry.outcomeKind).toBe('ADAPTER_RETURNED');

    const expected = oracleCanonicalBytes(
      dispatchOutcomeFields({
        companyId: COMPANY_ID,
        journalSeq: entry.journalSeq,
        outboxId: entry.outboxId,
        claimId: entry.claimId,
        correlationTag: entry.correlationTag,
        effectId: entry.effectId,
        authorisationId: entry.authorisationId,
        idempotencyKey: entry.idempotencyKey,
        actionClass: entry.actionClass,
        resourceRef: entry.resourceRef,
        dispatchPayloadHash: entry.dispatchPayloadHash,
        adapter: entry.adapter,
        outcomeKind: entry.outcomeKind,
        effectStatus: entry.effectStatus,
        requiresUnmirroredTag: entry.requiresUnmirroredTag,
        overrideId: entry.overrideId,
        occurredAt: entry.occurredAt,
        prevHash: entry.prevHash,
      }),
    );
    expect((await controlBytes(entry.journalSeq)).equals(expected)).toBe(true);
    // And the chain link the trigger computed is SHA-256 of exactly those bytes.
    expect(entry.rowHash.equals(oracleRowHash(dispatchOutcomeFieldsOf(entry)))).toBe(true);
    expect(entry.rowHash.equals(sha256(expected))).toBe(true);
  });

  it('an unknown outcome: the same order, a different declared kind and status', async () => {
    await dispatched('CMP-J-UNKNOWN', unknownOutcome('AMBIGUOUS'));
    const entry = (await outcomeJournalRows(h.control))[0]!;
    expect(entry.outcomeKind).toBe('OUTCOME_UNKNOWN');
    expect(entry.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
    expect(
      (await controlBytes(entry.journalSeq)).equals(
        oracleCanonicalBytes(dispatchOutcomeFieldsOf(entry)),
      ),
    ).toBe(true);
  });

  it('the twenty fields are in the declared order, and a SEEDED SWAP is detected', async () => {
    /*
     * `30 §5.3a`'s second obligation: "`36 §2.6`'s byte-identity fixture is what detects a
     * violation, and a seeded swap of two fields of this row kind must make it fail."
     *
     * The swap is applied to the ORACLE, because the oracle is the one implementation a test
     * can perturb without editing a migration. Two adjacent text fields of the same type
     * are swapped — `dispatch_outcome_kind` (15) and `dispatch_effect_status` (16) — which
     * is the hardest case: same type, same framing, adjacent positions, so only the ORDER
     * distinguishes the two byte strings.
     */
    await dispatched('CMP-J-SWAP');
    const entry = (await outcomeJournalRows(h.control))[0]!;
    const correct = oracleCanonicalBytes(dispatchOutcomeFieldsOf(entry));
    const swapped = oracleCanonicalBytes(
      dispatchOutcomeFieldsOf({
        ...entry,
        outcomeKind: entry.effectStatus,
        effectStatus: entry.outcomeKind,
      }),
    );
    expect(swapped.equals(correct)).toBe(false);
    expect((await controlBytes(entry.journalSeq)).equals(correct)).toBe(true);
    expect((await controlBytes(entry.journalSeq)).equals(swapped)).toBe(false);
  });

  it('the row is IMMUTABLE once chained — no path clears the outcome or the tag', async () => {
    await dispatched('CMP-J-IMMUTABLE');
    const client = await h.control.connect();
    try {
      for (const column of [
        'dispatch_outcome_kind',
        'dispatch_effect_status',
        'dispatch_adapter',
        'outbox_requires_unmirrored_tag',
      ]) {
        await expect(
          client.query(
            `UPDATE effect_journal SET ${column} = NULL
              WHERE company_id = $1 AND journal_row_kind = 'DISPATCH_OUTCOME'`,
            [COMPANY_ID],
          ),
          column,
        ).rejects.toThrow(/JOURNAL_ROW_IMMUTABLE/);
      }
    } finally {
      client.release();
    }
    // And the outcome ROW is append-only too, so the state cannot be edited either.
    const client2 = await h.control.connect();
    try {
      await expect(
        client2.query(
          `UPDATE effect_dispatch_outcome SET effect_status = 'DISPATCHED_OUTCOME_UNKNOWN'
            WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_effect_dispatch_outcome/);
      await expect(
        client2.query(`DELETE FROM effect_dispatch_outcome WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_effect_dispatch_outcome/);
    } finally {
      client2.release();
    }
  });
});

describe('`§37` — THE AUDIT PLANE, INDEPENDENTLY, OVER THE ACCEPTED POST-COMMIT PUSH', () => {
  it('the outcome row replicates, re-chains, and canonicalises to the SAME bytes', async () => {
    /*
     * `§37`: "New control journal outcome rows should follow the existing post-COMMIT audit
     * push path. Do not make outcome transaction depend synchronously on audit
     * availability."
     *
     * It uses the ACCEPTED S1G pusher, unchanged. The outcome transaction committed before
     * this line ran and knows nothing about it, which is `30 §5.1`'s rule: "Cross-database
     * atomicity is not attempted, because it does not exist."
     */
    await dispatched('CMP-J-REPLICATE');
    const run = await h.replication.pusher().pushPending(COMPANY_ID, 100);
    expect(run.pushed.length).toBeGreaterThan(0);
    for (const pushed of run.pushed) expect(pushed.outcome).toBe('ACCEPTED');

    const held = await auditRows(h.replication);
    const outcomeRow = held.find((r) => r.journal_row_kind === 'DISPATCH_OUTCOME');
    expect(outcomeRow).toBeDefined();
    // The claim row is there too, and BEFORE it in the sequence.
    const claimRow = held.find((r) => r.journal_row_kind === 'OUTBOX_CLAIMED');
    expect(claimRow).toBeDefined();
    expect(Number(outcomeRow!.journal_seq)).toBeGreaterThan(Number(claimRow!.journal_seq));

    const entry = (await outcomeJournalRows(h.control))[0]!;
    const expected = oracleCanonicalBytes(dispatchOutcomeFieldsOf(entry));
    // THE AUDIT PLANE'S OWN TRIGGER, ON THE OTHER SERVER, AGAINST THE ORACLE.
    expect((await auditBytes(entry.journalSeq)).equals(expected)).toBe(true);
    // AND ITS OWN ARRIVAL CHAIN, RE-COMPUTED BY HAND. `A0001`'s formula, verbatim:
    // `audit_row_hash = sha256(framed(audit_prev_hash) || framed(canonical bytes))`. It is
    // a DIFFERENT chain from the control plane's — `I17d`: "a chain the writer computes
    // proves nothing" — so re-computing it here from the oracle's framing primitive checks
    // that the audit store chained over the bytes it received rather than over anything the
    // control plane told it.
    expect(
      Buffer.from(outcomeRow!.audit_row_hash).equals(
        sha256(
          Buffer.concat([
            frameField(Buffer.from(outcomeRow!.audit_prev_hash)),
            frameField(expected),
          ]),
        ),
      ),
    ).toBe(true);
    // And the transmitted bytes the audit store retained ARE the oracle's bytes: `30 §5.3`,
    // "the transmitted bytes are what is hashed".
    expect(Buffer.from(outcomeRow!.transmitted_bytes).equals(expected)).toBe(true);
  });

  it('the local outcome commits and survives an audit plane that is unreachable', async () => {
    /*
     * `§37`: "Local outcome commit survives audit outage. No cross-database transaction."
     *
     * The dispatch runs with the audit store never contacted at all — no push is issued —
     * and the local outcome is committed, chained and readable. `23 §6` B8's protocol:
     * "commit [...] in one transaction; push the journal row to the audit store
     * asynchronously with retry and quota; then dispatch."
     */
    const effect = await dispatched('CMP-J-OUTAGE');
    expect(effect.idempotencyKey).toBeTruthy();
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
    // Nothing has been pushed, and the row is marked unmirrored — the accepted S1G
    // `mirrored_at IS NULL` backlog state, which the pusher drains later.
    const backlog = await h.control.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM effect_journal
        WHERE company_id = $1 AND journal_row_kind = 'DISPATCH_OUTCOME'
          AND mirrored_at IS NULL`,
      [COMPANY_ID],
    );
    expect(backlog.rows[0]!.n).toBe('1');
    // And the drain works afterwards, so the outage delayed replication and lost nothing.
    const run = await h.replication.pusher().pushPending(COMPANY_ID, 100);
    for (const pushed of run.pushed) expect(pushed.outcome).toBe('ACCEPTED');
  });
});

describe('`§38` — THE UNMIRRORED EVIDENCE PATH, END TO END', () => {
  it('a dispatch in CORROBORATED_DEGRADED carries the requirement to the adapter, the row and the journal', async () => {
    /*
     * `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
     * carries `override_id`." `36 §6`: in `CORROBORATED_DEGRADED`, "as `NORMAL`, **with
     * every dispatch tagged**".
     *
     * `§38`'s three questions, each answered by a different durable artifact:
     *
     *   the claim required the tag                 `dispatch_outbox.claim_requires_
     *                                              unmirrored_tag`, and the `OUTBOX_CLAIMED`
     *                                              journal row's field 16.
     *   the gateway sent the requirement           `effect_dispatch_outcome.
     *                                              unmirrored_tag_sent`, which `0012`'s
     *                                              CHECK forces to equal the claim's.
     *   the resulting state is associated with it  the `DISPATCH_OUTCOME` journal row's
     *                                              field 17, in the AUDIT PLANE's own copy.
     */
    const effect = await enqueuedPause('CMP-J-DEGRADED');

    // Enter `CORROBORATED_DEGRADED` through the ACCEPTED S1H path: a control-plane
    // declaration plus a signed audit-plane corroboration signal.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);
    const signal = signalSignedWith(
      signalFieldsAt(NOW, { signalId: 'signal:s1j-degraded' }),
      h.auditKey.privateKey,
      signalSigningBytes,
    );
    const consumed = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      signal,
      h.auditKey.publicKey,
      NOW,
    );
    expect(consumed.kind).toBe('SIGNAL_CONSUMED');
    expect((await evaluateState(h.control, COMPANY_ID, NOW)).state).toBe(
      'CORROBORATED_DEGRADED',
    );

    const mock = adsMock();
    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:degraded',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    // 1. THE CLAIM REQUIRED IT.
    const claimed = (await outboxRows(h.control))[0]!;
    expect(claimed.claimRequiresUnmirroredTag).toBe(true);
    expect(claimed.claimMirrorState).toBe('CORROBORATED_DEGRADED');
    expect((await claimJournalRows(h.control))[0]!.requiresUnmirroredTag).toBe(true);

    // 2. THE GATEWAY CARRIED IT ACROSS THE PORT, and the mock observed it.
    expect(mock.observed[0]!.requiresUnmirroredTag).toBe(true);

    // 3. THE OUTCOME ROW RECORDS THAT IT WAS SENT, and the CHECK makes the two equal.
    const outcome = (await rawOutcomeRows(h.control))[0]!;
    expect(outcome.requiresUnmirroredTag).toBe(true);
    expect(outcome.unmirroredTagSent).toBe(true);

    // 4. AND THE AUDIT PLANE HOLDS IT IN ITS OWN COPY, which is what `I17f(c)` and
    //    `30 §5.10`'s additive verification list are evaluated from.
    await h.replication.pusher().pushPending(COMPANY_ID, 100);
    const held = await auditRows(h.replication);
    const auditOutcome = held.find((r) => r.journal_row_kind === 'DISPATCH_OUTCOME');
    expect(auditOutcome).toBeDefined();
    const flag = await h.auditEvaluator.query<{ outbox_requires_unmirrored_tag: boolean }>(
      `SELECT outbox_requires_unmirrored_tag FROM audit_journal
        WHERE company_id = $1 AND journal_row_kind = 'DISPATCH_OUTCOME'`,
      [COMPANY_ID],
    );
    expect(flag.rows[0]!.outbox_requires_unmirrored_tag).toBe(true);
  });

  it('and the adapter cannot suppress it: the DATABASE refuses the mismatched row', async () => {
    /*
     * `§12`: "The adapter may not suppress it." `0012`'s
     * `dispatch_outcome_unmirrored_tag_not_suppressed` CHECK and its companion trigger
     * `dispatch_outcome_agrees_with_claim` are the enforcement, and neither is a code path a
     * mapper can skip. Asserted by attempting the suppressed INSERT directly.
     */
    const effect = await enqueuedPause('CMP-J-SUPPRESS');
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);
    const signal = signalSignedWith(
      signalFieldsAt(NOW, { signalId: 'signal:s1j-suppress' }),
      h.auditKey.privateKey,
      signalSigningBytes,
    );
    await consumeCorroboration(h.control, COMPANY_ID, signal, h.auditKey.publicKey, NOW);

    const mock = adsMock();
    await dispatchAuthorisedEffect(
      h.control,
      testRegistry(mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:suppress',
        now: NOW,
      },
      { hooks: { afterOutcomeLock: () => Promise.reject(new Error('crash')) } },
    ).catch(() => undefined);

    const row = (await outboxRows(h.control))[0]!;
    expect(row.claimRequiresUnmirroredTag).toBe(true);

    const client = await h.control.connect();
    try {
      // The suppression: the claim required the tag, the row claims it was not sent.
      await expect(
        client.query(
          `INSERT INTO effect_dispatch_outcome (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
             adapter, recoverability, outcome_kind, effect_status,
             requires_unmirrored_tag, unmirrored_tag_sent, economic_movement,
             invoked_at, outcome_at, journal_seq)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'REVERSIBLE', 'ADAPTER_RETURNED',
                   'DISPATCHED_AWAITING_VERIFICATION', TRUE, FALSE, 'NONE', $8, $8, 1)`,
          [
            COMPANY_ID,
            effect.idempotencyKey,
            row.outboxId,
            row.effectId,
            row.authorisationId,
            row.claimId,
            row.adapter,
            NOW,
          ],
        ),
      ).rejects.toThrow(/dispatch_outcome_unmirrored_tag_not_suppressed/);

      // And the OTHER shape of the same lie: both columns FALSE, disagreeing with the claim.
      await expect(
        client.query(
          `INSERT INTO effect_dispatch_outcome (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
             adapter, recoverability, outcome_kind, effect_status,
             requires_unmirrored_tag, unmirrored_tag_sent, economic_movement,
             invoked_at, outcome_at, journal_seq)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'REVERSIBLE', 'ADAPTER_RETURNED',
                   'DISPATCHED_AWAITING_VERIFICATION', FALSE, FALSE, 'NONE', $8, $8, 1)`,
          [
            COMPANY_ID,
            effect.idempotencyKey,
            row.outboxId,
            row.effectId,
            row.authorisationId,
            row.claimId,
            row.adapter,
            NOW,
          ],
        ),
      ).rejects.toThrow(/DISPATCH_OUTCOME_TAG_REQUIREMENT_DIVERGED/);
    } finally {
      client.release();
    }
  });

  it('THE REAL-PROVIDER TAG OBSERVABILITY LEG REMAINS OPEN, AND `I17f` IS NOT CLOSED', async () => {
    /*
     * `§38`: "This closes only the local/mock evidence path. Real provider tag
     * observability remains open." `§12`: "This may close the kernel composition leg of
     * `I17f(a)`/`(c)`, but NOT the real-vendor mapping/audit leg."
     *
     * `I17f`'s own enforcement column says who evaluates it: **Audit**, on a scheduled
     * 15-minute interval, from an audit-plane-published `MIRROR_INPUT_STALL` interval
     * compared against the tags on mirrored rows. What S1J supplies is the tag on the
     * mirrored row. What it does not supply is the evaluator, the published stall interval
     * at dispatch time, or any provider-side observation — and `30 §5.5` item 9 records
     * that the tags themselves "have no detector at all, under any mechanism in this
     * architecture".
     */
    const evaluators = await h.auditEvaluator.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname LIKE '%i17f%'`,
    );
    // There is no audit-plane function evaluating `I17f(c)` over dispatch outcomes.
    expect(evaluators.rows.map((r) => r.proname)).toEqual([]);
    // And no provider-side observation exists to compare a tag against.
    const providerish = await h.auditOwner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND (table_name LIKE '%provider%'
           OR table_name LIKE '%vendor%' OR table_name LIKE '%delivery%')`,
    );
    expect(providerish.rows).toEqual([]);
  });
});

/** The oracle's field list for one measured row. Kept next to its callers, not exported. */
function dispatchOutcomeFieldsOf(entry: {
  readonly journalSeq: bigint;
  readonly outboxId: string;
  readonly claimId: string;
  readonly correlationTag: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly idempotencyKey: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly dispatchPayloadHash: string;
  readonly adapter: string;
  readonly outcomeKind: string;
  readonly effectStatus: string;
  readonly requiresUnmirroredTag: boolean;
  readonly overrideId: string | null;
  readonly occurredAt: Date;
  readonly prevHash: Buffer | null;
}): ReturnType<typeof dispatchOutcomeFields> {
  return dispatchOutcomeFields({
    companyId: COMPANY_ID,
    journalSeq: entry.journalSeq,
    outboxId: entry.outboxId,
    claimId: entry.claimId,
    correlationTag: entry.correlationTag,
    effectId: entry.effectId,
    authorisationId: entry.authorisationId,
    idempotencyKey: entry.idempotencyKey,
    actionClass: entry.actionClass,
    resourceRef: entry.resourceRef,
    dispatchPayloadHash: entry.dispatchPayloadHash,
    adapter: entry.adapter,
    outcomeKind: entry.outcomeKind,
    effectStatus: entry.effectStatus,
    requiresUnmirroredTag: entry.requiresUnmirroredTag,
    overrideId: entry.overrideId,
    occurredAt: entry.occurredAt,
    prevHash: entry.prevHash,
  });
}
