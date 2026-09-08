import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authorisePause,
  authoriseRefund,
  claimJournalRows,
  createOutboxHarness,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { auditRows, sha256 } from '../../support/replicationFixture.js';
import {
  frameField,
  oracleCanonicalBytes,
  oracleRowHash,
  outboxClaimedFields,
} from '../../support/jcs1Oracle.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { declareMirrorDegraded } from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { grantOverride, type OverrideRequest } from '../../../src/kernel/mirror/degradedModeOverride.js';
import { overrideGrantBytes } from '../../../src/kernel/mirror/degradedModeOverride.js';
import { sign as signEd25519 } from 'node:crypto';
import { money } from '../../../src/kernel/exposure/money.js';

/**
 * `§42` — THE `OUTBOX_CLAIMED` JOURNAL ROW, CROSS-IMPLEMENTED AND REPLICATED.
 *
 * =================================================================================
 * WHY THE CLAIM IS JOURNALED AT ALL.
 *
 * `23 §6` B8: "Effect ↛ External without journal [...] No effect originating in reasoning
 * can occur that is not recorded." The claim is the instant ACOS durably commits that this
 * exact effect may leave, so it is the last local record before an external effect could
 * exist. `S1I-owner-clarifications.md S1I-C4` records that v1.3.3 requires the CLAIM
 * without declaring a byte order for a record of it, so the order is an implementation
 * declaration — exactly as S1H's three mirror kinds were — and the specification is
 * `S1I-contract.md §5`.
 *
 * WHY IT MUST REACH THE AUDIT PLANE. `I17` is a TWO-SIDED DIFF over `journal_seq`, and
 * `30 §5.2` gives a gap "exactly one interpretation" — suppression. A control-side row kind
 * the audit store could not ingest would be a permanent, unresolvable `I17` discrepancy.
 * =================================================================================
 *
 * =================================================================================
 * THREE IMPLEMENTATIONS, JUDGED AGAINST A FOURTH.
 *
 * `30 §5.3`: "`36 §2.6` cross-implements it: the same fixture rows serialised by both
 * triggers must produce byte-identical output." The two triggers are
 * `effect_journal_canonical_bytes` (control, `0010`) and `audit_journal_canonical_bytes`
 * (audit, `A0005`), written independently. Neither is compared to the other here: BOTH are
 * compared to `outboxClaimedFields` in `jcs1Oracle.ts`, which is hand-authored and imports
 * nothing from `src/`.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');
const HOUR = 60 * 60 * 1000;

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

describe('THE CONTROL TRIGGER AGREES WITH THE HAND-AUTHORED ORACLE', () => {
  it('a claim with NO override: the bytes and the row hash both match', async () => {
    const effect = await enqueuedPause('CMP-JCS-NO-OVERRIDE');
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:jcs',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');
    if (claim.kind !== 'CLAIMED') return;

    const entry = (await claimJournalRows(h.control))[0]!;
    const expectedBytes = oracleCanonicalBytes(
      outboxClaimedFields({
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
        matchedRow: entry.matchedRow,
        mirrorState: entry.mirrorState,
        requiresUnmirroredTag: entry.requiresUnmirroredTag,
        overrideId: entry.overrideId,
        claimClockRef: entry.claimClockRef,
        occurredAt: entry.occurredAt,
        prevHash: entry.prevHash,
      }),
    );
    expect((await controlBytes(entry.journalSeq)).equals(expectedBytes)).toBe(true);
    // `I17d`: the chain value is the DATABASE's. The oracle recomputes it independently.
    expect(
      entry.rowHash.equals(
        oracleRowHash(
          outboxClaimedFields({
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
            matchedRow: entry.matchedRow,
            mirrorState: entry.mirrorState,
            requiresUnmirroredTag: entry.requiresUnmirroredTag,
            overrideId: entry.overrideId,
            claimClockRef: entry.claimClockRef,
            occurredAt: entry.occurredAt,
            prevHash: entry.prevHash,
          }),
        ),
      ),
    ).toBe(true);
    // And the NULL `override_id` is carried in the FRAMING WORD, not as a payload byte —
    // v1.3.2's JCS-01 correction. A one-byte sentinel would make this row's bytes collide
    // with a one-byte override id.
    expect(entry.overrideId).toBeNull();
    expect(expectedBytes.includes(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(true);
  });

  it('a claim WITH an override: the same order, with the id in the same position', async () => {
    const effect = await authoriseRefund(h);
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:jcs-override',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);

    const request: OverrideRequest = {
      companyId: COMPANY_ID,
      overrideId: 'override:jcs',
      requestedBy: 'principal:owner',
      requestedAt: NOW,
      effectClasses: ['refund.create'],
      recoverabilityClasses: ['COMPENSABLE'],
      precedenceRows: [4],
      startsAt: NOW,
      expiresAt: new Date(NOW.getTime() + 24 * HOUR),
      effectCountCap: 5n,
      monetaryExposureCap: money('50.00'),
      reason: 'the S1I journal-row cross-implementation (§42)',
      incidentRef: h.seed.incidentRef,
    };
    await grantOverride(h.control, request, {
      grantedBy: 'principal:owner',
      grantedAt: NOW,
      grantSignature: signEd25519(
        null,
        overrideGrantBytes(request),
        h.seed.ownerSigner.privateKey,
      ),
    });

    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:jcs-override',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');

    const entry = (await claimJournalRows(h.control))[0]!;
    expect(entry.overrideId).toBe('override:jcs');
    expect(entry.requiresUnmirroredTag).toBe(true);
    const expectedBytes = oracleCanonicalBytes(
      outboxClaimedFields({
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
        matchedRow: entry.matchedRow,
        mirrorState: entry.mirrorState,
        requiresUnmirroredTag: entry.requiresUnmirroredTag,
        overrideId: entry.overrideId,
        claimClockRef: entry.claimClockRef,
        occurredAt: entry.occurredAt,
        prevHash: entry.prevHash,
      }),
    );
    expect((await controlBytes(entry.journalSeq)).equals(expectedBytes)).toBe(true);
  });
});

describe('AND THE AUDIT PLANE, INDEPENDENTLY', () => {
  it('the claim row replicates, re-chains and canonicalises to the SAME bytes', async () => {
    const effect = await enqueuedPause('CMP-REPLICATE');
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:replicate',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');

    const run = await h.replication.pusher().pushPending(COMPANY_ID, 100);
    expect(run.pushed.length).toBeGreaterThan(0);
    for (const pushed of run.pushed) {
      expect(pushed.outcome).toBe('ACCEPTED');
    }

    const held = await auditRows(h.replication);
    const claimRow = held.find((r) => r.journal_row_kind === 'OUTBOX_CLAIMED');
    expect(claimRow).toBeDefined();

    const entry = (await claimJournalRows(h.control))[0]!;
    const expectedBytes = oracleCanonicalBytes(
      outboxClaimedFields({
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
        matchedRow: entry.matchedRow,
        mirrorState: entry.mirrorState,
        requiresUnmirroredTag: entry.requiresUnmirroredTag,
        overrideId: entry.overrideId,
        claimClockRef: entry.claimClockRef,
        occurredAt: entry.occurredAt,
        prevHash: entry.prevHash,
      }),
    );

    // THE AUDIT PLANE'S OWN CONSTRUCTION, from its own columns, on the other server.
    const fromAudit = await auditBytes(entry.journalSeq);
    expect(fromAudit.equals(expectedBytes)).toBe(true);
    /*
     * And its INDEPENDENTLY RECOMPUTED chain value. `30 §5.9`: a chain "proves nothing at
     * all if the writer computes the hashes", so the audit store computes its own, in
     * ARRIVAL order rather than in `journal_seq` order — A0001: "a store that can hold a
     * gap cannot chain by a sequence it does not have."
     *
     * A0001's construction is `sha256(framed(audit_prev_hash) || framed(canonical bytes))`,
     * and the oracle's own `frameField` reproduces it here from the hand-authored bytes.
     */
    expect(
      claimRow!.audit_row_hash.equals(
        sha256(
          Buffer.concat([frameField(claimRow!.audit_prev_hash), frameField(expectedBytes)]),
        ),
      ),
    ).toBe(true);
    // The claimed hash the control plane sent is COMPARED, never copied into a chain
    // column — and here the two agree, which is what makes the cross-implementation pass.
    expect(claimRow!.claimed_row_hash.equals(entry.rowHash)).toBe(true);
  });

  it('and the audit plane holds the tag requirement and the override id from its OWN copy', async () => {
    /*
     * `30 §5.10`: `I8`'s additive verification list is built from dispatches outside
     * `NORMAL`, and `§5.7.2` item 6 puts every override-backed dispatch on it. The audit
     * plane must therefore hold both operands itself — under control-plane compromise a
     * control-plane read is worthless, which is `30 §5.10`'s whole argument.
     */
    const effect = await enqueuedPause('CMP-AUDIT-OPERANDS');
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:audit-operands',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');

    await h.replication.pusher().pushPending(COMPANY_ID, 100);

    const client = await h.auditOwner.connect();
    try {
      const row = await client.query<{
        outbox_requires_unmirrored_tag: boolean;
        override_id: string | null;
        outbox_mirror_state: string;
        outbox_correlation_tag: string;
      }>(
        `SELECT outbox_requires_unmirrored_tag, override_id, outbox_mirror_state,
                outbox_correlation_tag
           FROM audit_journal
          WHERE company_id = $1 AND journal_row_kind = 'OUTBOX_CLAIMED'`,
        [COMPANY_ID],
      );
      expect(row.rows).toHaveLength(1);
      // `UNCORROBORATED_STALL` under the threshold: row 5 dispatches, untagged
      // (`I17f(a)` — no covering PUBLISHED interval is known to exist).
      expect(row.rows[0]!.outbox_mirror_state).toBe('UNCORROBORATED_STALL');
      expect(row.rows[0]!.outbox_requires_unmirrored_tag).toBe(false);
      expect(row.rows[0]!.override_id).toBeNull();
      expect(row.rows[0]!.outbox_correlation_tag).toMatch(/^acos-corr-/);
    } finally {
      client.release();
    }
  });

  it('a re-push of the claim row is the expected retry, not a duplicate', async () => {
    /*
     * `30 §5.2`'s re-push contract: a `UNIQUE(company_id, journal_seq)` conflict with an
     * IDENTICAL `row_hash` is `ON CONFLICT DO NOTHING` plus `AUDIT_PUSH_DUPLICATE` at INFO.
     * S1I adds a row kind to that path, so the contract is re-asserted for it.
     */
    const effect = await enqueuedPause('CMP-REPUSH');
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:repush',
      now: NOW,
    });
    await h.replication.pusher().pushPending(COMPANY_ID, 100);
    const heldOnce = await auditRows(h.replication);

    // Force a re-push of everything by clearing the advisory `mirrored_at` marker.
    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE effect_journal SET mirrored_at = NULL WHERE company_id = $1`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }
    const second = await h.replication.pusher().pushPending(COMPANY_ID, 100);
    for (const pushed of second.pushed) {
      expect(pushed.outcome).toBe('AUDIT_PUSH_DUPLICATE');
    }
    // `30 §5.2`: "`row_count` is `count(DISTINCT journal_seq)`. Anchored quantities are
    // unaffected by retries." No row was duplicated.
    const heldTwice = await auditRows(h.replication);
    expect(heldTwice).toHaveLength(heldOnce.length);
  });
});

describe('THE SHAPE CONSTRAINTS, READ OUT OF THE RUNNING DATABASE', () => {
  it('an `OUTBOX_CLAIMED` row cannot omit the tag requirement or the matched row', async () => {
    const client = await h.control.connect();
    try {
      for (const missing of [
        'outbox_requires_unmirrored_tag',
        'outbox_matched_row',
        'outbox_correlation_tag',
        'outbox_claim_id',
        'outbox_id',
      ]) {
        const columns = [
          'outbox_id',
          'outbox_claim_id',
          'outbox_correlation_tag',
          'outbox_matched_row',
          'outbox_mirror_state',
          'outbox_requires_unmirrored_tag',
          'effect_id',
          'authorisation_id',
          'idempotency_key',
          'action_class',
          'resource_ref',
          'dispatch_payload_hash',
        ].filter((c) => c !== missing);
        const values = columns.map((c) =>
          c === 'outbox_matched_row'
            ? '5'
            : c === 'outbox_requires_unmirrored_tag'
              ? 'FALSE'
              : `'x'`,
        );
        await expect(
          client.query(
            `INSERT INTO effect_journal
               (company_id, journal_seq, journal_row_kind, occurred_at, ${columns.join(', ')})
             VALUES ($1, 9999, 'OUTBOX_CLAIMED', $2, ${values.join(', ')})`,
            [COMPANY_ID, NOW],
          ),
          missing,
        ).rejects.toThrow();
      }
    } finally {
      client.release();
    }
  });

  it('and an accepted row kind did not silently acquire the new columns', async () => {
    /*
     * The rule 0008 and 0009 both applied: "an accepted row kind must not silently acquire
     * a permissible new field." So `EFFECT_AUTHORISATION` must REQUIRE the six S1I columns
     * to be absent, and a real journal row proves the constraint is live.
     */
    const client = await h.control.connect();
    try {
      const def = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'effect_journal'::regclass
            AND conname = 'journal_row_shape_per_kind'`,
      );
      const text = def.rows[0]!.def;
      for (const column of [
        'outbox_id',
        'outbox_correlation_tag',
        'outbox_claim_id',
        'outbox_matched_row',
        'outbox_mirror_state',
        'outbox_requires_unmirrored_tag',
      ]) {
        // Each appears in the constraint, so each is constrained per kind rather than free.
        expect(text, column).toContain(column);
      }
      // And an EFFECT_AUTHORISATION row carrying one is refused.
      await authorisePause(h, { resourceId: 'CMP-SHAPE' });
      await expect(
        client.query(
          `UPDATE effect_journal SET outbox_id = 'outbox:smuggled'
            WHERE company_id = $1 AND journal_row_kind = 'EFFECT_AUTHORISATION'`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/JOURNAL_ROW_IMMUTABLE/);
    } finally {
      client.release();
    }
  });
});
