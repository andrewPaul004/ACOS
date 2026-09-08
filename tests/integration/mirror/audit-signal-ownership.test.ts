import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  AUDIT_INSTANCE_ID,
  createMirrorHarness,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import { transportRecordFor } from '../../support/replicationFixture.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
import { runStallObservationCycle } from '../../../src/audit/mirrorInputStall.js';

/**
 * `§27` — THE AUDIT SIGNAL REMAINS AUDIT-OWNED. EVERY FORBIDDEN OPERATION, ATTEMPTED.
 *
 * =================================================================================
 * `§27` OF THE S1H MANDATE, verbatim:
 *
 *   "The control plane must not be able to: INSERT audit `MIRROR_INPUT_STALL`; UPDATE it;
 *    DELETE it; re-sign it; change its timestamp; extend its interval; alter its freshness
 *    metadata. **Use real audit PostgreSQL roles and real cryptographic verification where
 *    applicable. Test each forbidden operation directly.**"
 *
 * `30 §5.7`: "Signed under a key held only by the audit plane; the control plane holds the
 * public key and can verify **but not mint or extend**."
 *
 * `30 §5.7.1`, Transport: "**The audit plane accepts no writes on this path**, so the fetch
 * opens no new suppression channel and `58 §13` condition 2 is not engaged."
 *
 * TWO CONTROL-PLANE ROLES ARE ATTEMPTED, because the control plane holds two credentials
 * into the audit store and each must be refused separately:
 *
 *   `acos_audit_replication`    the WRITE direction (S1G's push path)
 *   `acos_audit_signal_reader`  the READ direction (S1H's fetch path)
 * =================================================================================
 */

let h: MirrorHarness;

const ATTESTED_AT = new Date('2026-03-01T12:00:00.000Z');
const STALLED_AT = new Date(ATTESTED_AT.getTime() + 16 * 60_000);

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  const seq = await emitAttestation(h.control, COMPANY_ID, ATTESTED_AT);
  await h.replication.ingress.ingest(await transportRecordFor(h.replication, seq));
  await runStallObservationCycle(
    h.auditEvaluator,
    COMPANY_ID,
    STALLED_AT,
    AUDIT_INSTANCE_ID,
    h.auditKey.privateKey,
  );
});

async function signalIdOf(): Promise<string> {
  const client = await h.auditOwner.connect();
  try {
    const row = await client.query<{ signal_id: string }>(
      'SELECT signal_id FROM audit_mirror_input_stall_signal WHERE company_id = $1',
      [COMPANY_ID],
    );
    return row.rows[0]!.signal_id;
  } finally {
    client.release();
  }
}

describe('there IS a signal to attack', () => {
  it('the audit plane published an interval and issued a signed signal', async () => {
    const client = await h.auditOwner.connect();
    try {
      const signals = await client.query<{ signature: Buffer; signed_bytes: Buffer }>(
        'SELECT signature, signed_bytes FROM audit_mirror_input_stall_signal',
      );
      expect(signals.rows).toHaveLength(1);
      expect(signals.rows[0]!.signature.length).toBe(64);
      const intervals = await client.query('SELECT 1 FROM audit_mirror_stall_interval');
      expect(intervals.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });
});

describe('the REPLICATION role — the control plane`s WRITE credential — holds NOTHING', () => {
  const forbidden: readonly [string, string, unknown[]][] = [
    [
      'INSERT a signal',
      `INSERT INTO audit_mirror_input_stall_signal
         (company_id, signal_id, interval_id, observed_at, interval_start,
          last_attestation_seq, last_attestation_received_at, reason, expires_at,
          audit_instance_id, signature, signed_bytes)
       SELECT company_id, 'signal:forged', interval_id, $2, interval_start,
              0, NULL, 'ATTESTATION_STALL', $2::TIMESTAMPTZ + INTERVAL '5 minutes',
              'forged', $3, $3
         FROM audit_mirror_stall_interval WHERE company_id = $1`,
      [COMPANY_ID, STALLED_AT, Buffer.alloc(64, 1)],
    ],
    [
      'UPDATE a signal',
      `UPDATE audit_mirror_input_stall_signal SET reason = 'PUSH_PATH_UNREACHABLE'
        WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    [
      'DELETE a signal',
      `DELETE FROM audit_mirror_input_stall_signal WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    [
      're-sign a signal',
      `UPDATE audit_mirror_input_stall_signal SET signature = $2 WHERE company_id = $1`,
      [COMPANY_ID, Buffer.alloc(64, 2)],
    ],
    [
      'change a signal timestamp',
      `UPDATE audit_mirror_input_stall_signal SET observed_at = $2 WHERE company_id = $1`,
      [COMPANY_ID, new Date('2030-01-01T00:00:00Z')],
    ],
    [
      'alter freshness metadata',
      `UPDATE audit_mirror_input_stall_signal SET expires_at = $2 WHERE company_id = $1`,
      [COMPANY_ID, new Date('2030-01-01T00:00:00Z')],
    ],
    [
      'INSERT a stall interval',
      `INSERT INTO audit_mirror_stall_interval
         (company_id, interval_id, interval_start, reason, opening_last_attestation_seq)
       VALUES ($1, 'interval:forged', $2, 'ATTESTATION_STALL', 0)`,
      [COMPANY_ID, STALLED_AT],
    ],
    [
      'extend a stall interval',
      `UPDATE audit_mirror_stall_interval SET interval_start = $2 WHERE company_id = $1`,
      [COMPANY_ID, new Date('2020-01-01T00:00:00Z')],
    ],
    [
      'DELETE a stall interval',
      `DELETE FROM audit_mirror_stall_interval WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    [
      'read a signal at all',
      `SELECT signature FROM audit_mirror_input_stall_signal WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    [
      'call the canonicaliser to prepare its own bytes',
      `SELECT audit_mirror_signal_canonical_bytes('x',$1,now(),now(),0,NULL,
                'ATTESTATION_STALL',now(),'x')`,
      [COMPANY_ID],
    ],
  ];

  for (const [name, sql, params] of forbidden) {
    it(`cannot ${name}`, async () => {
      const client = await h.replication.audit.replication.connect();
      try {
        await expect(client.query(sql, params)).rejects.toThrow(/permission denied/);
      } finally {
        client.release();
      }
    });
  }
});

describe('the SIGNAL READER role — the control plane`s FETCH credential — can only READ', () => {
  it('CAN select the signal, which is the whole point of the credential', async () => {
    const client = await h.auditReader.connect();
    try {
      const rows = await client.query('SELECT signal_id FROM audit_mirror_input_stall_signal');
      expect(rows.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  const forbidden: readonly [string, string, unknown[]][] = [
    [
      'INSERT a signal',
      `INSERT INTO audit_mirror_input_stall_signal
         (company_id, signal_id, interval_id, observed_at, interval_start,
          last_attestation_seq, last_attestation_received_at, reason, expires_at,
          audit_instance_id, signature, signed_bytes)
       VALUES ($1,'signal:forged','x',now(),now(),0,NULL,'ATTESTATION_STALL',
               now() + INTERVAL '5 minutes','x',$2,$2)`,
      [COMPANY_ID, Buffer.alloc(64, 1)],
    ],
    [
      'UPDATE a signal',
      `UPDATE audit_mirror_input_stall_signal SET expires_at = now() + INTERVAL '1 day'
        WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    [
      'DELETE a signal',
      `DELETE FROM audit_mirror_input_stall_signal WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    [
      'INSERT a stall interval',
      `INSERT INTO audit_mirror_stall_interval
         (company_id, interval_id, interval_start, reason, opening_last_attestation_seq)
       VALUES ($1,'interval:forged',now(),'ATTESTATION_STALL',0)`,
      [COMPANY_ID],
    ],
    [
      'UPDATE a stall interval',
      `UPDATE audit_mirror_stall_interval SET interval_end = NULL WHERE company_id = $1`,
      [COMPANY_ID],
    ],
    // `30 §5.7.1`: the credential is "scoped to this endpoint and to V7". It is NOT a
    // credential for the audit record itself.
    ['read the audit holdings', `SELECT 1 FROM audit_journal WHERE company_id = $1`, [COMPANY_ID]],
    ['read audit findings', `SELECT 1 FROM audit_incident WHERE company_id = $1`, [COMPANY_ID]],
    ['read the insert quota', `SELECT 1 FROM audit_insert_quota`, []],
    ['write a finding about itself', `INSERT INTO audit_incident (company_id, kind, severity, detail) VALUES ($1,'ATTESTATION_DIVERGENCE','CRITICAL','{}')`, [COMPANY_ID]],
  ];

  for (const [name, sql, params] of forbidden) {
    it(`cannot ${name}`, async () => {
      const client = await h.auditReader.connect();
      try {
        await expect(client.query(sql, params)).rejects.toThrow(/permission denied/);
      } finally {
        client.release();
      }
    });
  }
});

describe('even the audit EVALUATOR cannot rewrite what it published', () => {
  it('the signal is append-only under its OWN issuer', async () => {
    // `30 §5.7.1`: "Extending a signal's life by rewriting `expires_at` breaks the
    // signature." It is ALSO refused at the store, because `I17f(a)` reads this record and a
    // record its own writer could edit would not be evidence.
    // TWO MECHANISMS, and each is shown on its own. The evaluator holds SELECT and INSERT
    // and no UPDATE, so its rewrite fails at the GRANT; the trigger refuses the same rewrite
    // even as the OWNER, so the property does not rest on the grant alone (`36 §0`).
    const client = await h.auditEvaluator.connect();
    try {
      await expect(
        client.query(
          `UPDATE audit_mirror_input_stall_signal SET expires_at = $2 WHERE company_id = $1`,
          [COMPANY_ID, new Date('2030-01-01T00:00:00Z')],
        ),
      ).rejects.toThrow(/permission denied for table audit_mirror_input_stall_signal/);
    } finally {
      client.release();
    }
    const owner = await h.auditOwner.connect();
    try {
      await expect(
        owner.query(
          `UPDATE audit_mirror_input_stall_signal SET expires_at = $2 WHERE company_id = $1`,
          [COMPANY_ID, new Date('2030-01-01T00:00:00Z')],
        ),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_audit_mirror_input_stall_signal/);
      await expect(
        owner.query(`DELETE FROM audit_mirror_input_stall_signal WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_audit_mirror_input_stall_signal/);
    } finally {
      owner.release();
    }
  });

  it('and cannot issue a SECOND signal reusing an existing `signal_id`', async () => {
    // `30 §5.7.1`: `signal_id` is "unique per issuance; **never reused**".
    const signalId = await signalIdOf();
    const client = await h.auditEvaluator.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO audit_mirror_input_stall_signal
             (company_id, signal_id, interval_id, observed_at, interval_start,
              last_attestation_seq, last_attestation_received_at, reason, expires_at,
              audit_instance_id, signature, signed_bytes)
           SELECT company_id, $2, interval_id, observed_at, interval_start,
                  last_attestation_seq, last_attestation_received_at, reason, expires_at,
                  audit_instance_id, signature, signed_bytes
             FROM audit_mirror_input_stall_signal WHERE company_id = $1`,
          [COMPANY_ID, signalId],
        ),
      ).rejects.toThrow(/duplicate key|audit_mirror_input_stall_signal_pkey/);
    } finally {
      client.release();
    }
  });
});

describe('SOURCE RULE — the signature is produced in `src/audit/` and nowhere else', () => {
  it('no file outside `src/audit/` signs a corroboration signal', async () => {
    // `30 §5.7.1`: the private key is "generated on and never leaving the audit-plane host",
    // and `30 §5.7`: the control plane "can verify but not mint or extend". A signer in the
    // kernel would be a signer the control plane could reach, whatever the key custody said.
    const files = await sourceFiles();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      if (path.includes(`${sep}audit${sep}`)) continue;
      // The construction that produces a signature over the signal's bytes.
      if (/signEd25519\s*\([^)]*signalSigningBytes|signalSigningBytes[^;]*sign\(/.test(code)) {
        offenders.push(path);
      }
      // And no module outside `src/audit/` may reach the audit signal tables at all.
      for (const pattern of [
        /audit_mirror_input_stall_signal/,
        /audit_mirror_stall_interval/,
        /audit_mirror_signal_canonical_bytes/,
      ]) {
        // `src/replication/corroborationFetch.ts` is the declared exception: it is the
        // control plane's PULL client, `30 §5.7.1` requires exactly one, and it holds a
        // SELECT-only credential that `audit-signal-ownership.test.ts` attacks above.
        if (path.endsWith(join('replication', 'corroborationFetch.ts'))) continue;
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `corroboration-signal write or signing surface outside src/audit:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and the fetch client SELECTs — it contains no INSERT, UPDATE or DELETE', async () => {
    const code = await readFile(
      join(process.cwd(), 'src', 'replication', 'corroborationFetch.ts'),
      'utf8',
    );
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const pattern of [/INSERT\s+INTO/i, /UPDATE\s+\w/i, /DELETE\s+FROM/i]) {
      expect(stripped, String(pattern)).not.toMatch(pattern);
    }
    expect(stripped).toMatch(/SELECT/);
  });
});

/** Every `.ts` file under `src/`, with comments stripped. */
async function sourceFiles(): Promise<readonly { path: string; code: string }[]> {
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
