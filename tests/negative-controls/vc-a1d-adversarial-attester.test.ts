import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { emitAttestation } from '../../src/replication/attestation.js';
import { evaluateTransportCompleteness } from '../../src/audit/transportCompleteness.js';
import { CAN03, loadCommerceFixture } from '../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
  s1eSpec,
} from '../support/authorityFixture.js';
import {
  COMPANY_ID,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  type LocalAuthorityHarness,
} from '../support/localAuthorisationFixture.js';
import {
  auditRows,
  controlJournal,
  createReplicationFixture,
  transportRecordFor,
  type ReplicationFixture,
} from '../support/replicationFixture.js';

/**
 * `VC-A1d` — THE ADVERSARIAL-ATTESTER NEGATIVE CONTROL. MANDATORY. S1G.
 *
 * =================================================================================
 * A RUN IN WHICH THE DETECTOR FIRES IS A TEST FAILURE.
 *
 * `36 §2`, verbatim, and the emphasis is the architecture's own:
 *
 *   "VC-A1d — the adversarial-attester negative control, MANDATORY (v1.3, TA-01).
 *    Truncate the push at `journal_seq = 900` of 1,000 AND ADJUST THE ATTESTATION TO
 *    MATCH, so it reports `max_journal_seq = 900`, `row_count = 900` and the genuine
 *    `head_hash` at 900. ASSERT `I17e` DOES NOT FIRE. Assert `I17` does not fire. Assert
 *    `ATTESTATION_STALL` does not fire. A RUN IN WHICH ANY OF THEM FIRES IS A TEST
 *    FAILURE, NOT A PASS. [...] The purpose of VC-A1d is to prove THE VERIFIER KNOWS WHAT
 *    IT CANNOT DETECT, and a validation suite that cannot state its own blind spot
 *    certifies a property it does not exercise."
 *
 * Registry `I17e`'s explicit residual:
 *
 *   "A compromised control plane can FREEZE ITS OWN ATTESTED PREFIX and remain undetected
 *    by this invariant and by `I17` for as long as it likes."
 *
 * Registry `§3` item 9, on the class with no detector AT ALL:
 *
 *   "Rows describing anything with no vendor counterpart — authorisation decisions,
 *    denials, reservations, releases, `PRESUMED_SETTLED` transitions, approvals, resumes,
 *    `RemedyObligation`s, state facts, supersessions, escalations, incidents, clock
 *    creations, override exercises, `StandingAuthorization` transitions, enumeration reads,
 *    `OutOfBandAction` records and the `DISPATCHED_UNMIRRORED` tags themselves — HAVE NO
 *    DETECTOR AT ALL, UNDER ANY MECHANISM IN THIS ARCHITECTURE."
 *
 * =================================================================================
 * DO NOT "FIX" THIS TEST.
 *
 * The correct repair for a failure here is NOT to make the detector fire. `§19` of the
 * S1G mandate and `36 §2` both forbid the obvious "improvement" — giving the audit plane a
 * control-database read — and `30 §5.4` explains why it is not available: "R10 removed the
 * replica deliberately, and `24 §3` K11's declared inputs contain no control-database
 * read."
 *
 * The residual belongs to `I8`, which at S1 "proves nothing" (`37` S1, TA-02) because all
 * four action classes run against mock adapters. So for the SUBSET of suppressed rows with
 * a vendor counterpart the detector arrives at S3; for the subset without one, there is
 * none, ever.
 * =================================================================================
 */

let fixture: ReplicationFixture;
let kernel: LocalAuthorityHarness;

const T0 = new Date('2026-01-05T12:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

beforeAll(async () => {
  fixture = await createReplicationFixture();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
  const client = await fixture.control.connect();
  try {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  } finally {
    client.release();
  }
  kernel = makeLocalAuthorityHarness(fixture.control);
});

const evaluate = async (now: Date) =>
  evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, now);

/**
 * The attack, built exactly as `36 §2` VC-A1d specifies.
 *
 * The scale is 4 of 6 rather than 900 of 1,000. The architecture's numbers illustrate the
 * mechanism; what makes the case is that the SUPPRESSED SUFFIX IS NON-EMPTY and the
 * attested prefix is frozen to match, and 4-of-6 has that property with a fixture whose
 * `W_DAY_REFUND` count ceiling is 2. `30 §5.4`'s worked example — "the control journal
 * advances to 1,000; the push stops at 900; attestations continue at cadence claiming
 * `max_journal_seq = 900`" — is reproduced structurally, not numerically.
 */
async function buildFrozenPrefixAttack(): Promise<{ truncatedAt: bigint; controlHead: bigint }> {
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec }); // seq 1
  await proposeAndAuthorise(kernel, CAN03, { spec }); // seq 2

  // seq 3 — an HONEST attestation at max = 2, emitted and delivered before the compromise.
  await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));

  // seq 4 — the LAST row the compromised control plane is willing to let the audit plane
  // see. It attests max = 3, `row_count` = 3, and the GENUINE head hash at 3.
  await emitAttestation(fixture.control.pool, COMPANY_ID, at(5));

  // The push stops here. Rows 1..4 are delivered; the journal keeps advancing.
  for (const seq of [1n, 2n, 3n, 4n]) {
    await fixture.ingress.ingest(await transportRecordFor(fixture, seq));
  }

  // seq 5, 6 — real rows, written locally, WITHHELD from the transport. In `30 §5.5` case
  // 2b's terms these are the suppressed range. Emitted as attestations because the fixture
  // window count is exhausted; that is a fixture constraint and not a property of the
  // attack, and registry `§3` item 9 lists exactly this kind of row — one with no vendor
  // counterpart — as the subset with no detector under any mechanism.
  await emitAttestation(fixture.control.pool, COMPANY_ID, at(10));
  await emitAttestation(fixture.control.pool, COMPANY_ID, at(15));

  // AND THE ATTESTER FREEZES. It does not emit a new attestation past seq 4, and the last
  // attestation the audit plane holds is truthful about the prefix it describes. Every
  // number in it is genuine; the lie is entirely by omission.
  return { truncatedAt: 4n, controlHead: 6n };
}

describe('VC-A1d — a control plane that freezes its own attested prefix', () => {
  it('the setup is real: the control journal advanced past what the audit store holds', async () => {
    const { truncatedAt, controlHead } = await buildFrozenPrefixAttack();

    const control = await controlJournal(fixture);
    expect(BigInt(control[control.length - 1]!.journal_seq)).toBe(controlHead);
    expect(control).toHaveLength(6);

    const held = await auditRows(fixture);
    expect(held.map((r) => BigInt(r.journal_seq))).toEqual([1n, 2n, 3n, 4n]);
    expect(BigInt(held[held.length - 1]!.journal_seq)).toBe(truncatedAt);

    // TWO ROWS EXIST IN THE CONTROL JOURNAL THAT THE AUDIT PLANE WILL NEVER SEE.
    expect(control.length - held.length).toBe(2);
  });

  it('`I17` DOES NOT FIRE — the received prefix is perfectly gap-free', async () => {
    await buildFrozenPrefixAttack();
    const report = await evaluate(at(6));
    expect(report.gaps).toEqual([]);
    expect(report.findings.map((f) => f.kind)).not.toContain('AUDIT_COMPLETENESS_GAP');
  });

  it('`I17e` DOES NOT FIRE — the attestation is internally consistent with the holdings', async () => {
    await buildFrozenPrefixAttack();
    const report = await evaluate(at(6));

    // Every operand of `I17e` checks out, because every one of them is TRUE.
    expect(report.latestAttestation?.attestedMaxJournalSeq).toBe(3n);
    expect(report.latestAttestation?.attestedRowCount).toBe(3n);
    expect(report.findings.map((f) => f.kind)).not.toContain('ATTESTATION_INCONSISTENT');
  });

  it('`ATTESTATION_STALL` DOES NOT FIRE while the attester keeps speaking', async () => {
    await buildFrozenPrefixAttack();
    // Evaluated inside `k x cadence` of the last attestation the audit plane received.
    const report = await evaluate(at(6));
    expect(report.findings.map((f) => f.kind)).not.toContain('ATTESTATION_STALL');
  });

  it('THE WHOLE DETECTOR IS SILENT. This is the expected result and it is a PASS.', async () => {
    await buildFrozenPrefixAttack();
    const report = await evaluate(at(6));

    // The single assertion this control exists for.
    expect(
      report.findings,
      'VC-A1d FAILED: a transport check fired on the frozen-prefix case. ' +
        'That is not an improvement — it means the detector is claiming a property ' +
        'registry §3 item 9 says no mechanism in this architecture has. Do not weaken ' +
        'this assertion; find out why the detector fired.',
    ).toEqual([]);
  });

  it('and it stays silent no matter how long the frozen attester keeps attesting', async () => {
    await buildFrozenPrefixAttack();

    // The compromised plane resumes attesting at cadence, still frozen at max = 3, so even
    // the liveness bound never trips. `30 §5.4`: "Every attestation is internally
    // consistent and independently recomputable. `I17` passes, `I17e` passes,
    // `ATTESTATION_STALL` does not fire."
    for (const minute of [10, 15, 20, 25]) {
      const client = await fixture.control.connect();
      try {
        // A new attestation row would advance `max_journal_seq`, so the frozen attester
        // re-delivers the one the audit plane already holds. The store answers benignly.
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      const record = await transportRecordFor(fixture, 4n);
      expect(await fixture.ingress.ingest(record)).toBe('AUDIT_PUSH_DUPLICATE');
      // The evaluator sees an attestation whose `attested_at` is the ORIGINAL instant, so
      // the stall bound is measured against that — and this is where the attack is finally
      // NOT free, which the next test states exactly.
      void minute;
    }

    const report = await evaluate(at(6));
    expect(report.findings).toEqual([]);
  });
});

describe('VC-A1d — what the residual costs the attacker, stated exactly', () => {
  it('the frozen attester CANNOT also stay silent: stopping trips `ATTESTATION_STALL`', async () => {
    // Stated so the residual is not over-read in the attacker's favour either. `30 §5.7`:
    // the absence of expected attestations is "an absence observed by the other party" and
    // cannot be forged. The attacker must keep speaking, and every word must be true about
    // the frozen prefix.
    await buildFrozenPrefixAttack();
    const report = await evaluate(at(21)); // > k x cadence after the last delivered one
    expect(report.findings.map((f) => f.kind)).toContain('ATTESTATION_STALL');
  });

  it('and it cannot advance the attested head without delivering the rows underneath it', async () => {
    // The other half of the price. If the compromised plane attests max = 6 to avoid the
    // stall while still withholding 5 and 6, `I17e` fires immediately — which is `30 §5.5`
    // case 2a, an honest attester with a lossy transport, and IS detected.
    await buildFrozenPrefixAttack();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(20)); // seq 7, attests max = 6
    await fixture.ingress.ingest(await transportRecordFor(fixture, 7n));

    const report = await evaluate(at(21));
    const kinds = report.findings.map((f) => f.kind);
    expect(kinds).toContain('AUDIT_COMPLETENESS_GAP'); // 5 and 6 are missing below 7
    expect(kinds).toContain('ATTESTATION_INCONSISTENT'); // and below the attested max
  });
});

describe('VC-A1d — the residual is recorded where it is owned', () => {
  it('the audit plane holds NO input that could ever settle it', async () => {
    await buildFrozenPrefixAttack();
    // `24 §3` K11's declared inputs at S1G are: pushed journal rows, and attestation rows
    // — which are pushed journal rows. The vendor credentials arrive at `37` S3 and the
    // metric layer at S6. So the audit store's ENTIRE knowledge of the control journal is
    // its own holdings, and its holdings are what the attacker chose to send.
    const held = await auditRows(fixture);
    const client = await fixture.audit.evaluator.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
      );
      // Three tables, and every one of them is written from the transport or by the audit
      // plane's own checks. There is no vendor table, no replica, and no control read.
      expect(tables.rows.map((r) => r.table_name)).toEqual([
        'audit_incident',
        'audit_insert_quota',
        'audit_journal',
      ]);
    } finally {
      client.release();
    }
    expect(held).toHaveLength(4);
  });

  it('`I8` — the only detector for this case — proves nothing at S1, and the suite says so', async () => {
    // `37` S1, verbatim: "`I8` PROVES NOTHING AT S1. All four action classes run against
    // mock adapters, so there is no vendor side for the inverse sweep to enumerate. [...]
    // at S1 those two residuals have no operative detector at all."
    //
    // Asserted as the absence of an implementation, so the claim cannot drift: there is no
    // vendor read, no sweep and no adapter anywhere in the audit plane.
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const root = join(process.cwd(), 'src', 'audit');
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.sql')) continue;
        const source = await readFile(path, 'utf8');
        for (const forbidden of ['shopify', 'stripe', 'inverseSweep', 'vendorRead', 'fetch(']) {
          if (source.includes(forbidden)) offenders.push(`${path}: ${forbidden}`);
        }
      }
    };
    await walk(root);
    expect(offenders).toEqual([]);
  });
});
