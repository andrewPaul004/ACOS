import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID, createHarness } from '../../support/fixture.js';
import { createPool } from '../../../src/db/pool.js';
import {
  AUDIT_INSTANCE_ID,
  createMirrorHarness,
  newKeypair,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import { transportRecordFor, auditIncidents } from '../../support/replicationFixture.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
import {
  observeStall,
  publishStallInterval,
  issueSignal,
  runStallObservationCycle,
} from '../../../src/audit/mirrorInputStall.js';
import {
  postgresCorroborationSource,
  partitionedCorroborationSource,
} from '../../../src/replication/corroborationFetch.js';
import {
  declareMirrorDegraded,
  fetchAndConsumeCorroboration,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import {
  signalSigningBytes,
  verifyCorroborationSignal,
} from '../../../src/kernel/mirror/corroborationSignal.js';
import { oracleCanonicalBytes, stallSignalFields } from '../../support/jcs1Oracle.js';

/**
 * `VC-A2d` — THE CORROBORATION-SIGNAL CONTRACT, END TO END, ACROSS TWO REAL SERVERS.
 *
 * =================================================================================
 * `36 §9`, VC-A2d, verbatim:
 *
 *   "**VC-A2d — the corroboration signal contract (v1.3, TA-06).** A signal with a broken
 *    signature is rejected. A signal older than `max_age` (5 minutes) is rejected, at every
 *    state evaluation and not only at entry. A `signal_id` already consumed cannot re-enter
 *    the state machine. A signal for another `company_id` is rejected. **Assert the
 *    reachability table of `30 §5.6` directly:** inject a network partition and assert
 *    `CORROBORATED_DEGRADED` is **not** reached; take the audit plane down and assert the
 *    same; degrade only the push path and assert it **is** reached."
 *
 * The artifact-level rejections are `corroboration-signal-contract.test.ts`'s subject. THIS
 * file is the end-to-end path — the audit plane observes, publishes, canonicalises in its
 * own database and signs; the control plane fetches over a distinct read credential and
 * verifies against its own construction — plus `§5.6`'s reachability table, asserted with
 * REAL unreachability rather than a mocked branch.
 * =================================================================================
 */

let h: MirrorHarness;

const ATTESTED_AT = new Date('2026-03-01T12:00:00.000Z');
/** `30 §5.4`: `k × cadence` = 15 minutes. One minute past it. */
const STALLED_AT = new Date(ATTESTED_AT.getTime() + 16 * 60_000);

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/**
 * Put ONE attestation into the audit store, aged so `I17e`'s stall bound is exceeded.
 *
 * The attestation is a REAL control-side journal row pushed through the REAL replication
 * path, because `30 §5.4` makes the attestation "itself a journal row" and an audit-side
 * insert would be the "second unverified channel" it forbids.
 */
async function seedStalledAttestationChannel(): Promise<void> {
  const seq = await emitAttestation(h.control, COMPANY_ID, ATTESTED_AT);
  const record = await transportRecordFor(h.replication, seq);
  expect(await h.replication.ingress.ingest(record)).toBe('ACCEPTED');
}

describe('the audit plane issues NO signal when no stall condition holds', () => {
  it('a healthy attestation channel produces no observation and no signal', async () => {
    // `30 §5.7.1`, Issuance: "**No signal is issued when no stall condition holds.**"
    await seedStalledAttestationChannel();
    // Evaluated one minute AFTER the attestation, well inside the 15-minute bound.
    const fresh = new Date(ATTESTED_AT.getTime() + 60_000);
    expect(await observeStall(h.auditEvaluator, COMPANY_ID, fresh)).toBeNull();
    expect(
      await runStallObservationCycle(
        h.auditEvaluator,
        COMPANY_ID,
        fresh,
        AUDIT_INSTANCE_ID,
        h.auditKey.privateKey,
      ),
    ).toBeNull();

    const client = await h.auditOwner.connect();
    try {
      const signals = await client.query('SELECT 1 FROM audit_mirror_input_stall_signal');
      expect(signals.rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('a company with NO attestation at all is not stalled — there is no channel to have stopped', async () => {
    // S1G's own rule, restated: "A company with no attestation at all is NOT stalled — there
    // is no channel to have stopped, and firing here would raise a critical finding on every
    // store from the moment it is created."
    expect(await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT)).toBeNull();
  });
});

describe('the signal is derived from AUDIT-OWNED facts and signed on the audit side', () => {
  beforeEach(async () => {
    await seedStalledAttestationChannel();
  });

  it('the observation reports the audit store`s OWN attestation reading', async () => {
    const observation = await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(observation).not.toBeNull();
    expect(observation!.reason).toBe('ATTESTATION_STALL');
    // `30 §5.7.1`'s `last_attestation_seq` — "the newest `max_journal_seq` the audit plane
    // received". The attestation over an EMPTY journal attests 0, and the arrival instant is
    // real, which is why the two are not paired (`S1H-C5`).
    expect(observation!.lastAttestationSeq).toBe(0n);
    expect(observation!.lastAttestationReceivedAt?.getTime()).toBe(ATTESTED_AT.getTime());
  });

  it('the audit DATABASE canonicalises, the audit PROCESS signs, and the bytes are bound', async () => {
    const observation = (await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT))!;
    const interval = await publishStallInterval(h.auditEvaluator, observation);
    const issued = await issueSignal(
      h.auditEvaluator,
      interval,
      observation,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );

    const client = await h.auditOwner.connect();
    try {
      const row = await client.query<{ signed_bytes: Buffer; signature: Buffer }>(
        `SELECT signed_bytes, signature FROM audit_mirror_input_stall_signal
          WHERE company_id = $1 AND signal_id = $2`,
        [COMPANY_ID, issued.signalId],
      );
      const stored = row.rows[0]!;

      // FOUR READINGS AGREE, and none of them is the other. The audit database's own SQL
      // construction is `signed_bytes`; the control plane's TypeScript construction is
      // `signalSigningBytes`; the hand-authored oracle is `stallSignalFields`. `36 §0`.
      const controlSide = signalSigningBytes({
        signalId: issued.signalId,
        companyId: COMPANY_ID,
        observedAt: issued.observedAt,
        intervalStart: interval.intervalStart,
        lastAttestationSeq: observation.lastAttestationSeq,
        lastAttestationReceivedAt: observation.lastAttestationReceivedAt,
        reason: observation.reason,
        expiresAt: issued.expiresAt,
        auditInstanceId: AUDIT_INSTANCE_ID,
        signature: stored.signature,
      });
      const oracle = oracleCanonicalBytes(
        stallSignalFields({
          signalId: issued.signalId,
          companyId: COMPANY_ID,
          observedAt: issued.observedAt,
          intervalStart: interval.intervalStart,
          lastAttestationSeq: observation.lastAttestationSeq,
          lastAttestationReceivedAt: observation.lastAttestationReceivedAt,
          reason: observation.reason,
          expiresAt: issued.expiresAt,
          auditInstanceId: AUDIT_INSTANCE_ID,
        }),
      );
      expect(stored.signed_bytes.equals(controlSide)).toBe(true);
      expect(stored.signed_bytes.equals(oracle)).toBe(true);
      expect(stored.signature.length).toBe(64);
    } finally {
      client.release();
    }
  });

  it('the audit store REFUSES a signal whose signed bytes are not its own canonicalisation', async () => {
    // `A0002`'s `audit_mirror_signal_binds_bytes`. A signature over bytes nobody re-derived
    // would be a signature over the issuer's own assertion.
    const observation = (await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT))!;
    const interval = await publishStallInterval(h.auditEvaluator, observation);
    const client = await h.auditEvaluator.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO audit_mirror_input_stall_signal
             (company_id, signal_id, interval_id, observed_at, interval_start,
              last_attestation_seq, last_attestation_received_at, reason, expires_at,
              audit_instance_id, signature, signed_bytes)
           VALUES ($1,'signal:hand-built',$2,$3,$4,0,NULL,'ATTESTATION_STALL',
                   $3::TIMESTAMPTZ + INTERVAL '5 minutes',$5,$6,$7)`,
          [
            COMPANY_ID,
            interval.intervalId,
            STALLED_AT,
            interval.intervalStart,
            AUDIT_INSTANCE_ID,
            Buffer.alloc(64, 3),
            Buffer.from('not the canonical bytes'),
          ],
        ),
      ).rejects.toThrow(/AUDIT_SIGNAL_CANONICAL_MISMATCH/);
    } finally {
      client.release();
    }
  });

  it('`expires_at` is bound to `observed_at + max_age` by a CHECK, not by convention', async () => {
    // The `signed_bytes` are built by the audit store's OWN function over exactly these
    // fields, so `audit_mirror_signal_binds_bytes` is satisfied and the failure that remains
    // is the TABLE CHECK. Handing it wrong bytes instead would prove the bind trigger works
    // and leave the `max_age` binding untested — two mechanisms, each shown separately
    // (`36 §0`).
    const observation = (await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT))!;
    const interval = await publishStallInterval(h.auditEvaluator, observation);
    const client = await h.auditEvaluator.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO audit_mirror_input_stall_signal
             (company_id, signal_id, interval_id, observed_at, interval_start,
              last_attestation_seq, last_attestation_received_at, reason, expires_at,
              audit_instance_id, signature, signed_bytes)
           VALUES ($1,'signal:long-lived',$2,$3,$4,0,NULL,'ATTESTATION_STALL',
                   $3::TIMESTAMPTZ + INTERVAL '24 hours',$5,$6,
                   audit_mirror_signal_canonical_bytes(
                     'signal:long-lived',$1,$3,$4,0,NULL,'ATTESTATION_STALL',
                     $3::TIMESTAMPTZ + INTERVAL '24 hours',$5))`,
          [
            COMPANY_ID,
            interval.intervalId,
            STALLED_AT,
            interval.intervalStart,
            AUDIT_INSTANCE_ID,
            Buffer.alloc(64, 3),
          ],
        ),
      ).rejects.toThrow(/audit_signal_expiry_is_max_age/);
    } finally {
      client.release();
    }
  });

  it('re-issuance produces a FRESH `signal_id` and `observed_at` on ONE interval', async () => {
    // `30 §5.7.1`, Issuance: "re-issued every `attestation_cadence` (5 minutes) for as long
    // as the condition holds, **each issuance carrying a fresh `signal_id` and
    // `observed_at`**."
    const first = await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );
    const second = await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      new Date(STALLED_AT.getTime() + 5 * 60_000),
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.signalId).not.toBe(first!.signalId);
    expect(second!.observedAt.getTime()).toBeGreaterThan(first!.observedAt.getTime());
    // ONE interval. A persisting stall is one interval with many issuances.
    expect(second!.intervalId).toBe(first!.intervalId);
  });

  it('a published interval is IMMUTABLE except for its close, and cannot be deleted', async () => {
    // `30 §5.7.1`: `I17f(a)` reads "the audit plane's own record of the intervals it
    // published", so that record must not be editable.
    await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );
    const client = await h.auditEvaluator.connect();
    try {
      await expect(
        client.query(
          `UPDATE audit_mirror_stall_interval SET interval_start = $2 WHERE company_id = $1`,
          [COMPANY_ID, new Date(0)],
        ),
      ).rejects.toThrow(/AUDIT_STALL_INTERVAL_IMMUTABLE/);
      // The EVALUATOR holds SELECT, INSERT and UPDATE and no DELETE at all, so a delete
      // fails at the GRANT — a stronger refusal than the trigger, and the one a real
      // audit-plane process would meet.
      await expect(
        client.query(`DELETE FROM audit_mirror_stall_interval WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).rejects.toThrow(/permission denied for table audit_mirror_stall_interval/);
      // And the TRIGGER refuses it even as the OWNER, so the property does not rest on the
      // grant alone: `36 §0` — a property enforced in one place is one edit from unenforced.
      const owner = await h.auditOwner.connect();
      try {
        await expect(
          owner.query(`DELETE FROM audit_mirror_stall_interval WHERE company_id = $1`, [
            COMPANY_ID,
          ]),
        ).rejects.toThrow(/APPEND_ONLY_TABLE_audit_mirror_stall_interval/);
      } finally {
        owner.release();
      }
      // The close IS permitted, once.
      await client.query(
        `UPDATE audit_mirror_stall_interval SET interval_end = $2 WHERE company_id = $1`,
        [COMPANY_ID, new Date(STALLED_AT.getTime() + 60_000)],
      );
      await expect(
        client.query(
          `UPDATE audit_mirror_stall_interval SET interval_end = $2 WHERE company_id = $1`,
          [COMPANY_ID, new Date(STALLED_AT.getTime() + 120_000)],
        ),
      ).rejects.toThrow(/AUDIT_STALL_INTERVAL_ALREADY_CLOSED/);
    } finally {
      client.release();
    }
  });
});

describe("`30 §5.6`'s REACHABILITY TABLE, asserted directly", () => {
  beforeEach(async () => {
    await seedStalledAttestationChannel();
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
  });

  it('ROW 4 — push path degraded, audit READ path healthy → `CORROBORATED_DEGRADED` IS reached', async () => {
    // "| Push path degraded, audit read path healthy | Yes | Yes | Yes | **Yes** |"
    //
    // This is the case the whole mechanism exists for, and it is the one that must WORK —
    // otherwise every other assertion below is vacuous.
    await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );

    const outcome = await fetchAndConsumeCorroboration(
      h.control,
      postgresCorroborationSource(h.auditReader),
      COMPANY_ID,
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(outcome.kind).toBe('SIGNAL_CONSUMED');
    expect(outcome.resolution.state).toBe('CORROBORATED_DEGRADED');
  });

  it('ROW 1 — NETWORK PARTITION → NOT reached; stays `UNCORROBORATED_STALL`', async () => {
    // "| Network partition between the planes | Yes | Yes | **No** — the fetch path is the
    // severed path | **No.** Stays `UNCORROBORATED_STALL` |"
    //
    // The audit plane HAS observed and HAS published — asserted below — and the control plane
    // still cannot reach the relaxed state, which is `30 §5.7`'s fail-closed direction.
    await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );
    const client = await h.auditOwner.connect();
    try {
      const published = await client.query('SELECT 1 FROM audit_mirror_input_stall_signal');
      expect(published.rows.length).toBe(1);
    } finally {
      client.release();
    }

    const outcome = await fetchAndConsumeCorroboration(
      h.control,
      partitionedCorroborationSource('the fetch path is the severed path (30 §5.6 row 1)'),
      COMPANY_ID,
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(outcome.kind).toBe('UNAVAILABLE');
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
  });

  it('ROW 1 again — with a REAL unreachable server, not an injected branch', async () => {
    // The same property against a genuinely closed TCP port, so the fail-closed path is the
    // production `catch` rather than a test double. Port 1 is reserved and never listening.
    const unreachable = createPool({
      connectionString: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
      max: 1,
      applicationName: 'acos-s1h-partition',
    });
    try {
      const outcome = await fetchAndConsumeCorroboration(
        h.control,
        postgresCorroborationSource(unreachable),
        COMPANY_ID,
        h.auditKey.publicKey,
        STALLED_AT,
      );
      expect(outcome.kind).toBe('UNAVAILABLE');
      expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
    } finally {
      await unreachable.end().catch(() => undefined);
    }
  });

  it('ROWS 2 AND 3 — audit store / audit host down → the audit plane publishes NOTHING', async () => {
    // "| Audit store down | No — its own checks cannot run | No | — | **No** |"
    // "| Audit-plane host down | No | No | — | **No** |"
    //
    // The audit plane's OWN observation returns null when its store cannot answer, so no
    // interval is published and no signal exists to fetch. Asserted against a real closed
    // port, as the audit plane's own pool.
    const downStore = createPool({
      connectionString: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
      max: 1,
      applicationName: 'acos-s1h-audit-down',
    });
    try {
      expect(await observeStall(downStore, COMPANY_ID, STALLED_AT)).toBeNull();
    } finally {
      await downStore.end().catch(() => undefined);
    }

    // And with nothing published, the control plane's fetch finds nothing.
    const outcome = await fetchAndConsumeCorroboration(
      h.control,
      postgresCorroborationSource(h.auditReader),
      COMPANY_ID,
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(outcome.kind).toBe('NO_SIGNAL');
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
  });

  it('ROW 5 — QUOTA SATURATION is an INCIDENT, NOT a mode change', async () => {
    // `30 §5.1` item 5: "**Audit-store saturation is an incident, not a mode change
    // (I17c).**" `30 §5.6`: "Audit insert quota saturated (`I17c`) | Yes | Yes | Yes |
    // **Yes**, but `§5.1` item 5 declares saturation *an incident, not a mode change*."
    //
    // `§10`'s last adversarial case. The quota is driven to zero and a push is attempted:
    // the audit store raises `AUDIT_QUOTA_SATURATED`, and the audit plane's observation
    // still reports only the attestation condition — never `STORE_WRITE_REJECTED`, which
    // `observeStall` has no derivation rule for and deliberately never returns.
    const owner = await h.auditOwner.connect();
    try {
      // `audit_quota_within_bound` forbids `inserted_rows > max_rows`, so saturation is
      // expressed by pulling the ceiling DOWN TO the rows already inserted rather than to
      // zero — which is what a genuinely exhausted quota looks like.
      await owner.query(
        `INSERT INTO audit_insert_quota (principal_name, window_start, max_rows, inserted_rows)
         VALUES ('acos_audit_replication', date_trunc('hour', now()), 0, 0)
         ON CONFLICT (principal_name, window_start)
           DO UPDATE SET max_rows = audit_insert_quota.inserted_rows`,
      );
    } finally {
      owner.release();
    }

    const seq = await emitAttestation(h.control, COMPANY_ID, new Date(STALLED_AT.getTime() + 1000));
    const record = await transportRecordFor(h.replication, seq);
    expect(await h.replication.ingress.ingest(record)).toBe('AUDIT_QUOTA_SATURATED');

    const incidents = await auditIncidents(h.replication);
    expect(incidents.map((i) => i.kind)).toContain('AUDIT_QUOTA_SATURATED');

    // AND NO MODE CHANGE: no `STORE_WRITE_REJECTED` observation, and the reason reported is
    // the attestation condition, which is a fact about the channel rather than the quota.
    const observation = await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(observation?.reason).not.toBe('STORE_WRITE_REJECTED');
  });
});

describe('the fetch is PULL ONLY, over a DISTINCT read credential', () => {
  it('the source exposes exactly one method and it reads', () => {
    const source = postgresCorroborationSource(h.auditReader);
    expect(Object.keys(source)).toEqual(['fetchCurrent']);
  });

  it('the fetch role is NOT the replication role', async () => {
    const client = await h.auditReader.connect();
    try {
      const who = await client.query<{ me: string }>('SELECT current_user AS me');
      expect(who.rows[0]!.me).toBe('acos_audit_signal_reader');
      expect(who.rows[0]!.me).not.toBe('acos_audit_replication');
    } finally {
      client.release();
    }
  });

  it('and the two planes are two distinct PostgreSQL INSTANCES', async () => {
    // Restated here because every claim in this file rests on it. Asserted the way S1G
    // asserted it: against the server's own identity, not against two URL strings.
    const control = await createHarness();
    try {
      const controlClient = await control.connect();
      const auditClient = await h.auditOwner.connect();
      try {
        const a = await controlClient.query<{ id: string }>(
          `SELECT system_identifier::TEXT AS id FROM pg_control_system()`,
        );
        const b = await auditClient.query<{ id: string }>(
          `SELECT system_identifier::TEXT AS id FROM pg_control_system()`,
        );
        expect(a.rows[0]!.id).not.toBe(b.rows[0]!.id);
      } finally {
        controlClient.release();
        auditClient.release();
      }
    } finally {
      await control.close();
    }
  });

  it('a signal signed by a SUBSTITUTED audit key is refused end to end', async () => {
    // `50 §2` class 24: "A substituted public key would let a compromised control plane mint
    // its own corroboration [...] a mismatch makes the corroborated state **unreachable
    // rather than forgeable**."
    await seedStalledAttestationChannel();
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );

    const wrongKey = newKeypair();
    const outcome = await fetchAndConsumeCorroboration(
      h.control,
      postgresCorroborationSource(h.auditReader),
      COMPANY_ID,
      wrongKey.publicKey,
      STALLED_AT,
    );
    expect(outcome.kind).toBe('REJECTED');
    if (outcome.kind === 'REJECTED') {
      expect(outcome.rejection).toBe('SIGNAL_SIGNATURE_INVALID');
    }
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
  });

  it('the endpoint is COMPANY-SCOPED: a fetch for another company finds nothing', async () => {
    // `30 §5.7.1`, Endpoint: `GET /audit/v1/mirror-input-stall?company_id=...`. Asserted at
    // the SOURCE rather than through a state evaluation, because evaluating the state of a
    // company that does not exist would test the `company` foreign key instead of the scope.
    await seedStalledAttestationChannel();
    await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );
    const source = postgresCorroborationSource(h.auditReader);
    expect((await source.fetchCurrent(COMPANY_ID)).kind).toBe('SIGNAL');
    // The fail-closed answer, and stronger than a fetched-then-rejected signal.
    expect((await source.fetchCurrent('co_someone_else')).kind).toBe('NONE');
  });

  it('and a signal genuinely scoped elsewhere is REJECTED by the verifier, on its scope', async () => {
    // The artifact-level half. The verifier reaches `SIGNAL_WRONG_COMPANY` only AFTER the
    // signature verifies, which is why the rejection names the scope and not the cryptography
    // — a genuine signal for another company is a different fact from a forged one.
    await seedStalledAttestationChannel();
    await runStallObservationCycle(
      h.auditEvaluator,
      COMPANY_ID,
      STALLED_AT,
      AUDIT_INSTANCE_ID,
      h.auditKey.privateKey,
    );
    const fetched = await postgresCorroborationSource(h.auditReader).fetchCurrent(COMPANY_ID);
    expect(fetched.kind).toBe('SIGNAL');
    if (fetched.kind !== 'SIGNAL') return;
    const verified = verifyCorroborationSignal(
      fetched.signal,
      'co_someone_else',
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.rejection).toBe('SIGNAL_WRONG_COMPANY');
  });
});
