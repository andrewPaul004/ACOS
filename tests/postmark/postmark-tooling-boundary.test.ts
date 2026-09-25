import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `§8`, `§29`, `§30`, `§31`, `§48` — THE CONFINEMENT, AS IT ACTUALLY STANDS AT S1M.
 *
 * =================================================================================
 * `§48` ASKED FOR A CONFINEMENT TRANSITION. THIS SLICE PERFORMS NONE, AND SAYS WHY.
 *
 * `§48`: "S1K/S1L previously prohibited all provider networking. Update those source-boundary
 * tests NARROWLY: ALLOW one Postmark adapter external-write path; one provider-read path
 * where architecture permits; audit-plane independent Postmark read path."
 *
 * **NO SUCH PATH WAS BUILT, SO NO ALLOWANCE WAS OPENED.** `tests/integration/gateway/`'s
 * `no-real-transport-boundary.test.ts` is UNAMENDED by S1M: `/postmark/i` is still refused
 * over the whole of `src/`, the gateway directory's import allow-list is unchanged, and
 * production's adapter registry is still empty. Widening a security test in the same commit
 * that adds nothing which needs the width is how a perimeter quietly stops being one, and
 * `48 §7`'s question 4 — "Has the CI check been disabled, weakened, or worked around for any
 * build?" — is the question this file exists to let a reviewer answer NO to.
 *
 * What S1M adds is a THIRD tooling directory, and this file holds its boundaries: the S1M
 * gate names a provider, so a reader must be able to check, mechanically, that naming one is
 * all it does.
 * =================================================================================
 */

const TOOLING_DIR = join('tools', 'postmark-sandbox');

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const TOOLING_FILES = filesUnder(TOOLING_DIR);
const PRODUCTION_FILES = filesUnder('src');

/** Source with comments stripped: these prohibitions are about CODE, not about prose. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Module specifiers only.
 *
 * The terminating `;` matters: a detail string that wraps mid-sentence across a `+` renders
 * as `... from ' + 'its own environment ...`, which a bare `from '…'` pattern reads as an
 * import of ` + `. The gate's own precondition text does exactly that, so the pattern is
 * anchored on the statement's semicolon and forbidden from crossing a line.
 */
function importsOf(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [
    ...[...source.matchAll(/\bfrom '([^'\n]+)';/g)].map((match) => match[1]!),
    // AND THE DYNAMIC ONES. `gate.ts` reaches the adapter registry through `await import(…)`
    // because a static import of it raises `NO_ACTIVE_VERIFIED_BUNDLE` at module-evaluation
    // time (`50 §3f`). A closed-set check that counted only static specifiers would have a
    // hole exactly the shape of the one dependency that matters.
    ...[...source.matchAll(/\bimport\('([^'\n]+)'\)/g)].map((match) => match[1]!),
  ];
}

describe('§31 — the S1M tooling holds NO transport, and that is checkable rather than asserted', () => {
  it('the directory exists and is small', () => {
    expect(TOOLING_FILES.length).toBeGreaterThanOrEqual(3);
    expect(TOOLING_FILES.length).toBeLessThanOrEqual(6);
  });

  it('no HTTP client, no socket, no vendor SDK and no request construction', () => {
    const offenders: string[] = [];
    for (const path of TOOLING_FILES) {
      const code = codeOf(path);
      for (const pattern of [
        /globalThis\.fetch/,
        /\bfetch\s*\(/,
        /\bnew\s+Request\b/,
        /\bnew\s+Headers\b/,
        /from '(node:)?https?'/,
        /from '(node:)?net'/,
        /from '(node:)?tls'/,
        /from '(node:)?dgram'/,
        /from 'axios'/,
        /from 'undici'/,
        /from 'node-fetch'/,
        /from 'postmark'/,
        /new\s+WebSocket/,
        /XMLHttpRequest/,
        /\brequest\s*\(/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `a transport surface in ${TOOLING_DIR}:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('no API ORIGIN appears anywhere in it — `§30`’s closed trusted configuration is absent too', () => {
    /*
     * The capability record cites PUBLISHED DOCUMENTATION pages, which are URLs. What must be
     * absent is the API ORIGIN a request would be sent to: a documentation link cannot be
     * dialled, and an origin constant is the first half of a client.
     */
    for (const path of TOOLING_FILES) {
      const source = readFileSync(path, 'utf8');
      expect(source, `${path} names the API origin`).not.toContain('api.postmarkapp.com');
      expect(codeOf(path), `${path} builds a URL`).not.toMatch(/new\s+URL\s*\(/);
    }
  });

  it('no Authorization header, no bearer scheme and no provider token header name', () => {
    for (const path of TOOLING_FILES) {
      const code = codeOf(path);
      for (const pattern of [
        /Authorization/,
        /Bearer/,
        /X-Postmark-Server-Token/i,
        /X-Postmark-Account-Token/i,
      ]) {
        expect(code, `${path} matches ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('no retry construct of any kind — `§33`’s ZERO automatic send retries has nothing to disable', () => {
    /*
     * The patterns target CONSTRUCTS rather than the word: the capability record legitimately
     * records, as documentation evidence, that the provider publishes no idempotent-RETRY
     * contract, and a check that could not tell that sentence from a retry loop would be a
     * check nobody could keep.
     */
    for (const path of TOOLING_FILES) {
      const code = codeOf(path);
      for (const pattern of [
        /setTimeout/,
        /setInterval/,
        /setImmediate/,
        /\bretry\s*\(/i,
        /\bbackoff\s*\(/i,
        /\bretries\s*[:=]/i,
        /\bmaxAttempts\b/i,
        /while\s*\(true\)/,
        /for\s*\(;;\)/,
      ]) {
        expect(code, `${path} matches ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('it signs nothing, and reaches no release ceremony', () => {
    for (const path of TOOLING_FILES) {
      const code = codeOf(path);
      expect(code, `${path} signs`).not.toMatch(/\bsign\s*\(/);
      expect(code, `${path} imports the release ceremony`).not.toMatch(/control-release/);
    }
  });
});

describe('§8 — the S1M tooling imports a closed set, so a new dependency fails out loud', () => {
  it('the import list is exactly the hand-enumerated one', () => {
    /*
     * The positive form, which is stronger than a denylist. `tools/prelive/` and
     * `src/kernel/gateway/` are each pinned this way for the same reason: a NEW dependency
     * has to be added HERE, in a commit somebody reads.
     */
    const allowed = [
      'node:crypto',
      // `48 §2` row 2's adapter would be resolved from this registry, and its EMPTINESS is
      // the mechanically checked evidence that no external write can leave.
      '../../src/kernel/gateway/adapterRegistry.js',
      // `§37` rows 1 to 5, composed rather than re-decided.
      '../prelive/preliveGate.js',
      './capabilityRecord.js',
      './gate.js',
    ];
    const seen = new Set<string>();
    for (const path of TOOLING_FILES) {
      for (const specifier of importsOf(path)) {
        seen.add(specifier);
        expect(allowed, `${path} imports ${specifier}`).toContain(specifier);
      }
    }
    expect(seen).toContain('../../src/kernel/gateway/adapterRegistry.js');
    expect(seen).toContain('../prelive/preliveGate.js');
  });

  it('it reaches NO gateway module other than the registry — no port, no envelope, no outcome', () => {
    for (const path of TOOLING_FILES) {
      for (const specifier of importsOf(path)) {
        for (const forbidden of [
          'effectGateway.js',
          'adapterPort.js',
          'dispatchEnvelope.js',
          'dispatchCapability.js',
          'outcomeTransaction.js',
          'outcomePolicy.js',
          'claim.js',
        ]) {
          expect(specifier, `${path} imports ${forbidden}`).not.toContain(forbidden);
        }
      }
    }
  });
});

describe('§48 — the ACCEPTED source boundary is UNCHANGED, and the vendor name is still confined', () => {
  it('`postmark` appears nowhere under `src/`, in any case', () => {
    const offenders = PRODUCTION_FILES.filter((path) => /postmark/i.test(readFileSync(path, 'utf8')));
    expect(offenders, `a vendor surface in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('nothing under `src/` imports the S1M tooling', () => {
    for (const path of PRODUCTION_FILES) {
      for (const specifier of importsOf(path)) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/postmark/i);
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/tools\//);
      }
    }
  });

  it('exactly ONE production file calls `.dispatch(` on an adapter, and it is still the gateway', () => {
    /*
     * `36 §7`: "Every adapter method is reachable only through the Effect Gateway." S1M adds
     * no second write path, so the assertion the ACCEPTED S1J made still holds verbatim.
     */
    const callers = PRODUCTION_FILES.filter(
      (path) => !path.endsWith(`${sep}adapterPort.ts`),
    ).filter((path) => /\.dispatch\s*\(/.test(codeOf(path)));
    expect(callers).toEqual([join('src', 'kernel', 'gateway', 'effectGateway.ts')]);
  });

  it('and `src/` still contains NO adapter implementation at all', () => {
    const offenders: string[] = [];
    for (const path of PRODUCTION_FILES) {
      if (path.endsWith(`${sep}adapterPort.ts`)) continue;
      for (const pattern of [
        /adapterId\s*:\s*'/,
        /resolutionCapabilities\s*:\s*\[/,
        /async\s+dispatch\s*\(/,
      ]) {
        if (pattern.test(codeOf(path))) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `an adapter implementation in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
