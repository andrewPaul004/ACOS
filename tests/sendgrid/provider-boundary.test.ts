import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SENDGRID_ACCEPTED_STATUS,
  SENDGRID_API_ORIGIN,
  SENDGRID_SANDBOX_VALIDATED_STATUS,
  classifySendGridSendResponse,
} from '../../validation/sendgrid/integration/providerClient.js';
import { isAuditProviderReader } from '../../src/audit/provider/runtime/auditProviderReader.js';
import { auditProviderReader } from '../../validation/sendgrid/audit/reader.js';

/**
 * `§8.1`, `§8.2`, `§19` — THE PROVIDER BOUNDARY IS NARROW, AND THE NARROWNESS IS CHECKABLE.
 *
 * =================================================================================
 * WHAT A SOURCE SCAN CAN PROVE THAT A UNIT TEST CANNOT
 *
 * `§19` forbids "a generic arbitrary-HTTP escape hatch". No unit test can prove the ABSENCE
 * of one, because absence is a property of the whole tree rather than of any function's
 * behaviour. So this file does what the ACCEPTED `postmark-tooling-boundary.test.ts` and
 * `no-real-transport-boundary.test.ts` do: it reads the source and asserts the shapes that
 * are not there.
 *
 * **NO FUNCTION IN THIS FILE IS CALLED WITH A REAL CREDENTIAL AND NONE REACHES A NETWORK.**
 * `classifySendGridSendResponse` and the reader's shape check are pure; everything else is a
 * read of the files on disk.
 * =================================================================================
 */

const INTEGRATION_DIR = join('validation', 'sendgrid', 'integration');
const AUDIT_DIR = join('validation', 'sendgrid', 'audit');
const HARNESS_DIR = join('validation', 'sendgrid', 'harness');

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Source with comments stripped: these prohibitions are about CODE, not about prose. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const VALIDATION_FILES = [
  ...filesUnder(INTEGRATION_DIR),
  ...filesUnder(AUDIT_DIR),
  ...filesUnder(HARNESS_DIR),
];

describe('`§19` — THERE IS NO ARBITRARY-URL CAPABILITY ANYWHERE IN THE PACKAGE', () => {
  it('exactly ONE origin constant exists, and no file names a second host', () => {
    expect(SENDGRID_API_ORIGIN).toBe('https://api.sendgrid.com');
    for (const path of VALIDATION_FILES) {
      const code = codeOf(path);
      for (const url of code.match(/https?:\/\/[^'"`\s)]+/g) ?? []) {
        expect(url, `${path} names ${url}`).toBe('https://api.sendgrid.com');
      }
    }
  });

  it('every `fetch` destination is a template of module constants — never an argument', () => {
    /*
     * The discriminating shape: a destination built from a parameter would render as
     * `fetch(url` , `fetch(input.url`, `fetch(request.` or `fetch(`${base}` where `base` is
     * not one of the two declared constants. Each `fetch` call site is checked by hand
     * against the enumerated safe forms.
     */
    const SAFE_DESTINATIONS = [
      '`${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}`',
      '`${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search.toString()}`',
      '`${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}/${segment}`',
    ];
    const sites: string[] = [];
    for (const path of VALIDATION_FILES) {
      const code = codeOf(path);
      for (const match of code.matchAll(/globalThis\.fetch\(\s*([^,\n]+)/g)) {
        sites.push((match[1] ?? '').trim());
      }
    }
    expect(sites.length, 'the scan found no fetch site at all').toBeGreaterThanOrEqual(4);
    for (const destination of sites) {
      expect(SAFE_DESTINATIONS, `an unrecognised fetch destination: ${destination}`).toContain(
        destination,
      );
    }
  });

  it('no HTTP library, no socket, no vendor SDK', () => {
    for (const path of VALIDATION_FILES) {
      const code = codeOf(path);
      for (const pattern of [
        /from '(node:)?https?'/,
        /from '(node:)?net'/,
        /from '(node:)?tls'/,
        /from '(node:)?dgram'/,
        /from 'axios'/,
        /from 'undici'/,
        /from 'node-fetch'/,
        /from '@sendgrid\//,
        /from 'sendgrid'/,
        /new\s+WebSocket/,
        /XMLHttpRequest/,
      ]) {
        expect(code, `${path} matches ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('`§19`, `§33` — NO RETRY CONSTRUCT ON ANY SEND PATH', () => {
    /*
     * "no automatic provider retry that can resend a claimed effect", and no retry in the
     * observation loop either. The patterns target CONSTRUCTS: `setTimeout` IS present — it
     * is each client's abort deadline — so the check is for the shapes a retry takes.
     */
    for (const path of VALIDATION_FILES) {
      const code = codeOf(path);
      for (const pattern of [
        /\bretry\b/i,
        /\bbackoff\b/i,
        /\bretries\s*[:=]/i,
        /\bmaxAttempts\s*[:=]\s*\d/,
        /while\s*\(true\)/,
        /for\s*\(;;\)/,
        /setInterval/,
      ]) {
        expect(code, `${path} matches ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('the send call sites are exactly the two enumerated ones, and NEITHER is in `audit/`', () => {
    /*
     * TWO, and each is accounted for: the adapter's own client, and `§8.7`'s attempted-write
     * probe — which is a deliberate write with the READ-ONLY credential and lives in
     * `harness/` for exactly that reason. A third would be an unreviewed send path.
     */
    const sendingFiles = VALIDATION_FILES.filter((path) =>
      /globalThis\.fetch\([\s\S]{0,200}?method:\s*'POST'/.test(codeOf(path)),
    );
    expect(sendingFiles.sort()).toEqual(
      [
        join(INTEGRATION_DIR, 'providerClient.ts'),
        join(HARNESS_DIR, 'scopeProbes.ts'),
      ].sort(),
    );
    for (const path of filesUnder(AUDIT_DIR)) {
      expect(codeOf(path), `${path} performs a POST`).not.toMatch(/method:\s*'POST'/);
      expect(codeOf(path), `${path} declares a send client`).not.toMatch(
        /(?:export\s+(?:async\s+)?function|export\s+const)\s+sendToProvider/,
      );
    }
  });
});

describe('`§8.1` — THE SEND OUTCOME TAXONOMY IS NARROW AND CLAIMS NOTHING UNMEASURED', () => {
  it('only 202 is acceptance; 200 is the sandbox status and is NOT acceptance', () => {
    expect(SENDGRID_ACCEPTED_STATUS).toBe(202);
    expect(SENDGRID_SANDBOX_VALIDATED_STATUS).toBe(200);
    expect(
      classifySendGridSendResponse({
        kind: 'PROVIDER_ANSWERED',
        httpStatus: 202,
        providerMessageId: 'abc',
      }),
    ).toEqual({ kind: 'ACCEPTED', providerMessageId: 'abc' });
    expect(
      classifySendGridSendResponse({
        kind: 'PROVIDER_ANSWERED',
        httpStatus: 200,
        providerMessageId: null,
      }).kind,
    ).toBe('SANDBOX_SUPPRESSED');
  });

  it('5xx and 429 are UNKNOWN — "could the write have escaped?" is answered honestly', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(
        classifySendGridSendResponse({
          kind: 'PROVIDER_ANSWERED',
          httpStatus: status,
          providerMessageId: null,
        }).kind,
        String(status),
      ).toBe('UNKNOWN');
    }
    expect(classifySendGridSendResponse({ kind: 'NO_ANSWER' }).kind).toBe('UNKNOWN');
  });

  it('a 4xx is REJECTED, and NOT a no-mutation guarantee', () => {
    /*
     * `25 §7.2`'s second `NOT_SENT_CONFIRMED` basis needs a MEASURED vendor guarantee and
     * `36 §7` says where it comes from. S1P measured none, so no status may produce it.
     * The assertion is that the classification has no such member at all.
     */
    for (const status of [400, 401, 403, 413]) {
      const classification = classifySendGridSendResponse({
        kind: 'PROVIDER_ANSWERED',
        httpStatus: status,
        providerMessageId: null,
      });
      expect(classification.kind, String(status)).toBe('REJECTED');
    }
    const source = codeOf(join(INTEGRATION_DIR, 'providerClient.ts'));
    expect(source).not.toContain('NOT_SENT_CONFIRMED');
    expect(codeOf(join(INTEGRATION_DIR, 'adapter.ts'))).not.toContain('NOT_SENT_CONFIRMED');
  });
});

describe('`§8.2` — THE AUDIT READER IS STRUCTURALLY READ-ONLY', () => {
  it('the ACCEPTED host shape check admits it', () => {
    expect(isAuditProviderReader(auditProviderReader)).toBe(true);
  });

  it('it carries EXACTLY three members, and none of them is a mutation', () => {
    expect(Object.keys(auditProviderReader).sort()).toEqual([
      'boundary',
      'providerId',
      'readFromProvider',
    ]);
    expect(auditProviderReader.providerId).toBe('twilio_sendgrid');
  });

  it('adding ANY mutation member to it makes the accepted host refuse it', () => {
    // The discriminating control: the shape check is what stops a reader that gained a send.
    for (const member of ['send', 'post', 'write', 'dispatch', 'fetch', 'invoke']) {
      const widened = { ...auditProviderReader, [member]: (): void => undefined };
      expect(isAuditProviderReader(widened), member).toBe(false);
    }
  });

  it('the audit package does not import the scope probes', () => {
    for (const path of filesUnder(AUDIT_DIR)) {
      const source = readFileSync(path, 'utf8');
      expect(source, `${path} imports the probe`).not.toMatch(/scopeProbes/);
    }
  });
});
