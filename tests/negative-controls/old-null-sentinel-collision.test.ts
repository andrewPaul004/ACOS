import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createHarness, type Harness } from '../support/fixture.js';
import { createAuditHarness, type AuditHarness } from '../support/auditHarness.js';
import { frameField, jcsBytes, jcsText } from '../support/jcs1Oracle.js';
import {
  OLD_NULL_SENTINEL,
  unsafeOldBytes,
  unsafeOldFrameField,
  unsafeOldText,
} from './unsafe-old-null-sentinel.js';

/**
 * THE MANDATORY REGRESSION PROOF FOR v1.3.2 ERRATUM JCS-01.
 *
 * `36 §2`'s `VC-A3` case, as v1.3.2 issued it, requires that "a seeded implementation
 * restoring v1.2's one-byte `0x00` NULL sentinel **must fail this case**". This file is
 * that seeded implementation's discrimination test.
 *
 * =================================================================================
 * WHAT MUST HAPPEN, AND WHY EACH HALF IS NECESSARY
 *
 *   1. Under the WITHDRAWN rule, SQL NULL and a `bytea` of exactly one `0x00` byte
 *      produce IDENTICAL bytes. If they did not, `unsafe-old-null-sentinel.ts` would have
 *      drifted off v1.2's rule and this test would prove nothing.
 *
 *   2. Under the CURRENT rule they differ — in the ORACLE, in the CONTROL database and in
 *      the AUDIT database, each checked separately. Two of three would leave one
 *      implementation on the withdrawn rule and the two chains permanently divergent on
 *      NULL-bearing rows.
 *
 * A test that only asserted (2) would pass against a specification that had never had the
 * defect, which is exactly the reassurance a regression proof must not offer.
 * =================================================================================
 *
 * NOT A PRODUCTION PATH. `unsafe-old-null-sentinel.ts` is never imported from `src/`, and
 * the last test in this file is what enforces that rather than a comment claiming it.
 */

let control: Harness;
let audit: AuditHarness;

const ONE_ZERO_BYTE = Buffer.from([0x00]);
const RESERVED = Buffer.from([0xff, 0xff, 0xff, 0xff]);

beforeAll(async () => {
  control = await createHarness();
  audit = await createAuditHarness();
  await control.reset();
  await audit.reset();
});

afterAll(async () => {
  await control.close();
  await audit.close();
});

/** Every file under `src/`, recursively. */
async function sourceFiles(dir: string): Promise<readonly string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else out.push(path);
  }
  return out;
}

async function controlFramedBytes(value: Buffer | null): Promise<Buffer> {
  const client = await control.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT acos_jcs1_field(acos_jcs1_bytes($1::BYTEA)) AS bytes`,
      [value],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

async function auditFramedBytes(value: Buffer | null): Promise<Buffer> {
  const client = await audit.owner.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT audit_jcs1_field(audit_jcs1_bytes($1::BYTEA)) AS bytes`,
      [value],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

describe('the withdrawn v1.2 rule COLLIDES — the defect is real', () => {
  it('SQL NULL and a one-byte `0x00` bytea frame IDENTICALLY under the old sentinel', () => {
    const asNull = unsafeOldFrameField(null);
    const asByte = unsafeOldFrameField(ONE_ZERO_BYTE);

    // The exact five bytes `phase2-v1.3.2-errata.md §1` prints, twice.
    expect(asNull).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]));
    expect(asByte).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]));
    expect(asNull.equals(asByte)).toBe(true);

    // And the payloads themselves are the same one byte, which is the root of it.
    expect(unsafeOldBytes(null)).toEqual(OLD_NULL_SENTINEL);
    expect(unsafeOldBytes(ONE_ZERO_BYTE)).toEqual(OLD_NULL_SENTINEL);
  });

  it('so a NULL field and a real one-byte value were INDISTINGUISHABLE to a verifier', () => {
    // Stated as the consequence rather than the mechanism: a chain verifier handed the old
    // bytes could not tell which of two distinct rows it had been handed, so two
    // conforming implementations could hash different logical rows to one value.
    const rowWithNull = Buffer.concat([
      unsafeOldFrameField(Buffer.from('x', 'utf8')),
      unsafeOldFrameField(null),
    ]);
    const rowWithByte = Buffer.concat([
      unsafeOldFrameField(Buffer.from('x', 'utf8')),
      unsafeOldFrameField(ONE_ZERO_BYTE),
    ]);
    expect(rowWithNull.equals(rowWithByte)).toBe(true);
  });

  it('and TEXT was accidentally safe, which is why the defect survived S1B and S1F', () => {
    // Under the old rule a one-character NUL string would have imitated the sentinel too.
    // It could not arise: S1B-C8 excludes `U+0000` from ACOS canonical text and PostgreSQL
    // `text` cannot store one. `bytea` had no equivalent rule, and the specification
    // declared its NULL rule generically.
    const nulString = String.fromCharCode(0);
    expect(unsafeOldText(nulString)).toEqual(OLD_NULL_SENTINEL);
    expect(unsafeOldText(nulString).equals(unsafeOldText(null))).toBe(true);
    // The current text rule refuses that input, unchanged from S1B.
    expect(() => jcsText(nulString)).toThrow(/U\+0000/);
  });
});

describe('the CURRENT rule does not collide — in all three implementations, separately', () => {
  it('the ORACLE separates them', () => {
    expect(frameField(jcsBytes(null))).toEqual(RESERVED);
    expect(frameField(jcsBytes(ONE_ZERO_BYTE))).toEqual(Buffer.from([0, 0, 0, 1, 0]));
    expect(frameField(jcsBytes(null)).equals(frameField(jcsBytes(ONE_ZERO_BYTE)))).toBe(false);
  });

  it('the CONTROL database separates them', async () => {
    const asNull = await controlFramedBytes(null);
    const asByte = await controlFramedBytes(ONE_ZERO_BYTE);
    expect(asNull.equals(RESERVED)).toBe(true);
    expect(asByte.equals(Buffer.from([0, 0, 0, 1, 0]))).toBe(true);
    expect(asNull.equals(asByte)).toBe(false);
  });

  it('the AUDIT database separates them', async () => {
    const asNull = await auditFramedBytes(null);
    const asByte = await auditFramedBytes(ONE_ZERO_BYTE);
    expect(asNull.equals(RESERVED)).toBe(true);
    expect(asByte.equals(Buffer.from([0, 0, 0, 1, 0]))).toBe(true);
    expect(asNull.equals(asByte)).toBe(false);
  });

  it('THE TEST DISCRIMINATES — the old bytes and the new bytes are not the same bytes', async () => {
    // The property that makes this a control rather than a restatement: what the withdrawn
    // rule produced for NULL is exactly what the current rule produces for the one-byte
    // value, and the current rule produces something else entirely for NULL.
    const oldNull = unsafeOldFrameField(null);
    const newNull = frameField(jcsBytes(null));
    const newByte = frameField(jcsBytes(ONE_ZERO_BYTE));

    expect(oldNull.equals(newNull)).toBe(false);
    expect(oldNull.equals(newByte)).toBe(true);

    // And both production implementations agree with the NEW value, not the old one.
    for (const framed of [await controlFramedBytes(null), await auditFramedBytes(null)]) {
      expect(framed.equals(newNull)).toBe(true);
      expect(framed.equals(oldNull)).toBe(false);
    }
  });

  it('and NOTHING IN `src/` REACHES the withdrawn rule — it is test-only, asserted', async () => {
    // The seeded implementation exists so the correction can be shown to close a defect.
    // If production could reach it, it would be the defect.
    const files = await sourceFiles(join(process.cwd(), 'src'));
    const offenders: string[] = [];
    for (const path of files) {
      const code = await readFile(path, 'utf8');
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '');
      for (const pattern of [/unsafe-old-null-sentinel/, /unsafeOld/, /OLD_NULL_SENTINEL/]) {
        if (pattern.test(stripped)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `the withdrawn rule is reachable from src/:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('a whole ROW that was ambiguous under the old rule is unambiguous under the new one', async () => {
    const rowWithNull = Buffer.concat([
      frameField(jcsBytes(Buffer.from('x', 'utf8'))),
      frameField(jcsBytes(null)),
    ]);
    const rowWithByte = Buffer.concat([
      frameField(jcsBytes(Buffer.from('x', 'utf8'))),
      frameField(jcsBytes(ONE_ZERO_BYTE)),
    ]);
    expect(rowWithNull.equals(rowWithByte)).toBe(false);

    // The same two rows, assembled from each production implementation's own bytes.
    for (const framer of [controlFramedBytes, auditFramedBytes]) {
      const x = await framer(Buffer.from('x', 'utf8'));
      const withNull = Buffer.concat([x, await framer(null)]);
      const withByte = Buffer.concat([x, await framer(ONE_ZERO_BYTE)]);
      expect(withNull.equals(withByte)).toBe(false);
      expect(withNull.equals(rowWithNull)).toBe(true);
      expect(withByte.equals(rowWithByte)).toBe(true);
    }
  });
});
