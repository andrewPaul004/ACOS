import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * `§17` — THE EXTERNAL-WRITE PERIMETER CHECK. `48 §4` ITEM 2, AS A BUILD GATE.
 *
 * =================================================================================
 * WHAT `48` ASKS FOR, VERBATIM
 *
 * `48 §4` item 2: "**Every vendor-call site carries `authorisation_ref` or
 * `PERIMETER_EXEMPT(reason, ticket)`.** **CI fails the build on an unannotated site** (I24).
 * This is the mechanism that survives the enumeration being incomplete."
 *
 * `48 §1` says why that sentence, rather than the enumeration in `48 §2`, is the control:
 * "*'The only permitted path'* is a policy. *'The only capable path'* is an architecture.
 * v1.0 established the first and claimed the second. The CI check in §4 is what converts one
 * into the other, and it is the only mechanism that survives this enumeration being
 * incomplete — **an unannotated vendor-call site fails the build whether or not anyone has
 * thought about it.**"
 *
 * So this scanner is deliberately NOT a list of known call sites. It looks for the SHAPES
 * that can reach outside the process and reports every one it finds, annotated or not; the
 * enumeration it produces is an output, never an input.
 * =================================================================================
 *
 * =================================================================================
 * `§18` — THERE ARE NO BROAD EXEMPTIONS
 *
 * "Do not create broad exemptions like `INTERNAL` or `TEST`. If a test synthetic provider
 * needs an exemption from a specific network rule, it remains TEST-ONLY and is not a
 * production perimeter entry. Production external writes require authorisation_ref."
 *
 * Two mechanisms implement that. First, an exemption must carry BOTH a reason and a ticket
 * and the reason may not be one of the banned words — `BANNED_EXEMPTION_REASONS`. Second,
 * every site carries the ROOT it was found under, and a site under `tests/` is reported as
 * `TEST_ONLY` and is excluded from the production perimeter count entirely: a test fixture
 * cannot become a production perimeter entry by being annotated, because annotation is not
 * what decides which list it lands on.
 * =================================================================================
 */

/**
 * The call-site shapes. Each is something that can reach outside this process.
 *
 * `PROVIDER_CLIENT` is the S1N addition and the one that makes the check non-vacuous today:
 * this repository has no vendor HTTP, so a scanner that only looked for `fetch` would report
 * zero sites forever and would prove nothing on the day the first one appears. A provider
 * client is recognised by its DECLARATION — a function whose name matches
 * `PROVIDER_CLIENT_DECLARATION` — and by every call to it, which is `48 §4` item 1's "one
 * vendor-HTTP client per adapter" expressed as something a scanner can see.
 */
export const CALL_SITE_KINDS = [
  'NETWORK_PRIMITIVE',
  'HTTP_LIBRARY',
  'PROVIDER_CLIENT',
  /**
   * `PROVIDER_READ_CLIENT` is the S1O addition. `48 §2` row 13 — "Audit plane vendor reads"
   * — is `EXEMPT (read-only; §3.6)`, and `48 §3` is explicit about what an exemption is:
   * "An exemption is not a hole. It is a **named, annotated, reviewed** hole, and the
   * difference is that a reviewer can find it."
   *
   * **AN UNENUMERATED READ IS NOT EXEMPT; IT IS UNREVIEWED.** So an audit-plane provider
   * read is a perimeter SITE that must be annotated, and it is reported separately from a
   * SEND site because the two carry different annotations: a send carries
   * `PERIMETER_AUTHORISED(authorisation_ref)` and a read carries
   * `PERIMETER_EXEMPT(audit_plane_read_only, 48-3.6)`.
   */
  'PROVIDER_READ_CLIENT',
] as const;

export type CallSiteKind = (typeof CALL_SITE_KINDS)[number];

/** A provider-client declaration: `sendToProvider`, `sendToProviderB`, and future kin. */
const PROVIDER_CLIENT_DECLARATION =
  /(?:export\s+(?:async\s+)?function|export\s+const)\s+(sendToProvider[A-Za-z0-9_]*)\b/g;

/**
 * An audit-plane provider-READ declaration: `readFromProvider`, `readFromProviderActivity`.
 *
 * A SEPARATE pattern rather than a widened one, because the two shapes must never be
 * confused: `48 §2` row 13's exemption rests on the read being read-only, and a scanner
 * that reported a read as a `PROVIDER_CLIENT` would let a send site inherit a read's
 * exemption by being renamed.
 */
const PROVIDER_READ_CLIENT_DECLARATION =
  /(?:export\s+(?:async\s+)?function|export\s+const)\s+(readFromProvider[A-Za-z0-9_]*)\b/g;

const NETWORK_PRIMITIVES: readonly RegExp[] = [
  /\bglobalThis\.fetch\s*\(/,
  // A CALL to a bare `fetch`, and not a DECLARATION of one. `26 §7` step G's precondition
  // port declares an interface METHOD named `fetch` — "the engine fetches; the proposer does
  // not supply" — and that is a read against the control database, not a network call. The
  // ACCEPTED `no-real-transport-boundary.test.ts` makes the same distinction for the same
  // reason and scopes its bare pattern rather than its `globalThis.` one.
  /(?<![.\w$])(?<!function\s)(?<!async\s)(?<!get\s)fetch\s*\(/,
  /from\s+['"](?:node:)?https?['"]/,
  /require\(['"](?:node:)?https?['"]\)/,
  /from\s+['"](?:node:)?net['"]/,
  /from\s+['"](?:node:)?tls['"]/,
  /from\s+['"](?:node:)?dgram['"]/,
  /new\s+WebSocket\b/,
  /\bXMLHttpRequest\b/,
];

const HTTP_LIBRARIES: readonly RegExp[] = [
  /from\s+['"]axios['"]/,
  /from\s+['"]undici['"]/,
  /from\s+['"]node-fetch['"]/,
  /from\s+['"]got['"]/,
  /from\s+['"]superagent['"]/,
];

/** `§18`. A reason that says nothing is not a reason. */
export const BANNED_EXEMPTION_REASONS: readonly string[] = [
  'INTERNAL',
  'TEST',
  'TESTS',
  'TEST_ONLY',
  'TEMP',
  'TEMPORARY',
  'TODO',
  'NA',
  'N/A',
  'NONE',
];

const AUTHORISED_ANNOTATION = /PERIMETER_AUTHORISED\(\s*authorisation_ref\s*\)/;
const EXEMPT_ANNOTATION = /PERIMETER_EXEMPT\(\s*([A-Za-z0-9_\-. ]+?)\s*,\s*([A-Za-z0-9_\-#]+?)\s*\)/;

/** How many lines above a call site an annotation may sit and still cover it. */
const ANNOTATION_WINDOW_LINES = 12;

export type SiteScope = 'PRODUCTION' | 'TEST_ONLY';

export type SiteAnnotation =
  | { readonly kind: 'AUTHORISED' }
  | { readonly kind: 'EXEMPT'; readonly reason: string; readonly ticket: string }
  | { readonly kind: 'NONE' }
  | { readonly kind: 'INVALID_EXEMPTION'; readonly reason: string };

export interface PerimeterCallSite {
  readonly file: string;
  readonly line: number;
  readonly kind: CallSiteKind;
  readonly scope: SiteScope;
  readonly annotation: SiteAnnotation;
}

export interface PerimeterReport {
  readonly roots: readonly string[];
  readonly sites: readonly PerimeterCallSite[];
  readonly productionTotal: number;
  readonly productionAuthorised: number;
  readonly productionExempt: number;
  readonly productionUnannotated: number;
  readonly testOnlyTotal: number;
  readonly testOnlyUnannotated: number;
  /** `48 §2` row 13. Read sites, counted separately from write sites. */
  readonly providerReadTotal: number;
  readonly providerReadUnannotated: number;
  /** The gate. `48 §4` item 2: an unannotated site fails the build. */
  readonly pass: boolean;
}

/**
 * The roots the check covers.
 *
 * `src/` is the production control plane. `tests/integration-plane/` is where S1N's
 * synthetic Z2 runtimes live, and `§17` admits them: "S1N synthetic adapter may be
 * included." They are scanned under `TEST_ONLY` scope, so their sites must be annotated and
 * are never counted as production perimeter entries (`§18`).
 */
export const DEFAULT_PERIMETER_ROOTS: readonly string[] = [
  'src',
  join('tests', 'integration-plane'),
  // S1O's synthetic Z4 audit reader. Scanned under TEST_ONLY scope for the same reason
  // `tests/integration-plane/` is: its sites must be annotated and are never counted as
  // production perimeter entries (`§18`), and including it is what makes the
  // `PROVIDER_READ_CLIENT` kind non-vacuous today — the repository has no real audit
  // read, so a scanner looking only at `src/` would report zero read sites forever.
  join('tests', 'audit-plane'),
  /*
   * S1P's Twilio SendGrid non-production validation package, AND THE FIRST ROOT HERE WHOSE
   * SITES ARE REAL.
   *
   * **ITS FIRST PATH SEGMENT IS NOT `tests`, SO ITS SITES ARE SCANNED AT `PRODUCTION`
   * SCOPE, AND THAT IS THE POINT.** `§18` scopes the `TEST_ONLY` carve-out to a "test
   * synthetic provider"; `validation/sendgrid/` is not synthetic — its clients reach
   * `api.sendgrid.com`. Admitting a real vendor client into the scope that is EXCLUDED
   * from the production perimeter count is exactly the quiet weakening `48 §7` question 4
   * exists to catch, so the send sites here must carry
   * `PERIMETER_AUTHORISED(authorisation_ref)`, the audit-plane read sites must carry
   * `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)`, the operator-invoked capability
   * probes must carry `PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13)`, and an
   * unannotated site fails the build.
   */
  'validation',
];

async function typescriptFilesUnder(root: string): Promise<readonly string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out.sort();
}

/**
 * Strip comments EXCEPT the perimeter annotations.
 *
 * The annotation lives in a comment — that is what "annotated at its call site" means in
 * `48 §3` — so a scanner that stripped comments before looking would find none of them, and
 * a scanner that did not strip them at all would find a call site in every paragraph that
 * mentions `fetch(`. This replaces each comment with a blank line-preserving placeholder
 * that retains only an annotation if one was present, which keeps line numbers exact.
 */
function stripCommentsKeepingAnnotations(source: string): readonly string[] {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    let code = line;
    if (inBlock) {
      const end = code.indexOf('*/');
      if (end === -1) {
        out.push(preserveAnnotation(code));
        continue;
      }
      code = ' '.repeat(end + 2) + code.slice(end + 2);
      inBlock = false;
      // The commented part may still hold an annotation.
      const commented = line.slice(0, end);
      const kept = preserveAnnotation(commented);
      out.push(kept.trim().length > 0 ? kept : code);
      continue;
    }
    const blockStart = code.indexOf('/*');
    const lineStart = code.indexOf('//');
    if (blockStart !== -1 && (lineStart === -1 || blockStart < lineStart)) {
      const end = code.indexOf('*/', blockStart + 2);
      if (end === -1) {
        inBlock = true;
        const kept = preserveAnnotation(code.slice(blockStart));
        out.push(kept.trim().length > 0 ? kept : code.slice(0, blockStart));
        continue;
      }
      const commented = code.slice(blockStart, end + 2);
      const kept = preserveAnnotation(commented);
      out.push(code.slice(0, blockStart) + (kept.trim().length > 0 ? kept : '') + code.slice(end + 2));
      continue;
    }
    if (lineStart !== -1) {
      const commented = code.slice(lineStart);
      const kept = preserveAnnotation(commented);
      out.push(code.slice(0, lineStart) + (kept.trim().length > 0 ? kept : ''));
      continue;
    }
    out.push(code);
  }
  return out;
}

function preserveAnnotation(commented: string): string {
  if (AUTHORISED_ANNOTATION.test(commented)) {
    return commented.match(AUTHORISED_ANNOTATION)?.[0] ?? '';
  }
  const exempt = commented.match(EXEMPT_ANNOTATION);
  if (exempt !== null) return exempt[0];
  return '';
}

function annotationNear(lines: readonly string[], index: number): SiteAnnotation {
  const from = Math.max(0, index - ANNOTATION_WINDOW_LINES);
  for (let cursor = index; cursor >= from; cursor -= 1) {
    const line = lines[cursor] ?? '';
    if (AUTHORISED_ANNOTATION.test(line)) return { kind: 'AUTHORISED' };
    const exempt = line.match(EXEMPT_ANNOTATION);
    if (exempt !== null) {
      const reason = (exempt[1] ?? '').trim();
      const ticket = (exempt[2] ?? '').trim();
      if (reason.length === 0 || ticket.length === 0) {
        return { kind: 'INVALID_EXEMPTION', reason: 'a reason and a ticket are both required' };
      }
      if (BANNED_EXEMPTION_REASONS.includes(reason.toUpperCase())) {
        return {
          kind: 'INVALID_EXEMPTION',
          reason: `"${reason}" is a broad exemption and §18 forbids one`,
        };
      }
      return { kind: 'EXEMPT', reason, ticket };
    }
  }
  return { kind: 'NONE' };
}

/** Scan one tree. `cwd` is a parameter so the focused suite can point it at a fixture. */
export async function scanPerimeter(
  cwd: string = process.cwd(),
  roots: readonly string[] = DEFAULT_PERIMETER_ROOTS,
): Promise<PerimeterReport> {
  const sites: PerimeterCallSite[] = [];

  /*
   * PASS ONE — EVERY DECLARED PROVIDER CLIENT, ACROSS EVERY ROOT.
   *
   * A provider client is DECLARED in one module and CALLED from another: `48 §4` item 1 puts
   * "one vendor-HTTP client per adapter", and item 2 annotates the SITES that use it. A
   * per-file pass would see a declaration and a call as unrelated and would report only the
   * declaration, which is the half that matters least — the call sites are where an
   * `authorisation_ref` either is or is not carried.
   */
  const declaredClients = new Set<string>();
  const declaredReadClients = new Set<string>();
  const discovered: { readonly file: string; readonly root: string }[] = [];
  for (const root of roots) {
    for (const file of await typescriptFilesUnder(join(cwd, root))) {
      discovered.push({ file, root });
      const source = await readFile(file, 'utf8');
      PROVIDER_CLIENT_DECLARATION.lastIndex = 0;
      for (const match of source.matchAll(PROVIDER_CLIENT_DECLARATION)) {
        if (match[1] !== undefined) declaredClients.add(match[1]);
      }
      PROVIDER_READ_CLIENT_DECLARATION.lastIndex = 0;
      for (const match of source.matchAll(PROVIDER_READ_CLIENT_DECLARATION)) {
        if (match[1] !== undefined) declaredReadClients.add(match[1]);
      }
    }
  }

  // PASS TWO — every call site, in every file, of anything pass one found.
  {
    for (const { file, root } of discovered) {
      const scope: SiteScope = root.split(sep)[0] === 'tests' ? 'TEST_ONLY' : 'PRODUCTION';
      const source = await readFile(file, 'utf8');
      const lines = stripCommentsKeepingAnnotations(source);
      const relativeFile = relative(cwd, file);

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const kinds: CallSiteKind[] = [];
        if (NETWORK_PRIMITIVES.some((pattern) => pattern.test(line))) {
          kinds.push('NETWORK_PRIMITIVE');
        }
        if (HTTP_LIBRARIES.some((pattern) => pattern.test(line))) kinds.push('HTTP_LIBRARY');
        for (const client of declaredClients) {
          // A call, not the declaration: the declaration is the client, the calls are the
          // sites. `48 §4` item 2 annotates SITES.
          const callPattern = new RegExp(`(?<!function\\s)(?<!const\\s)\\b${client}\\s*\\(`);
          const declarationPattern = new RegExp(`(?:function|const)\\s+${client}\\b`);
          if (callPattern.test(line) && !declarationPattern.test(line)) {
            kinds.push('PROVIDER_CLIENT');
            break;
          }
        }
        for (const client of declaredReadClients) {
          const callPattern = new RegExp(`(?<!function\\s)(?<!const\\s)\\b${client}\\s*\\(`);
          const declarationPattern = new RegExp(`(?:function|const)\\s+${client}\\b`);
          if (callPattern.test(line) && !declarationPattern.test(line)) {
            kinds.push('PROVIDER_READ_CLIENT');
            break;
          }
        }
        if (kinds.length === 0) continue;
        const annotation = annotationNear(lines, index);
        for (const kind of kinds) {
          sites.push({ file: relativeFile, line: index + 1, kind, scope, annotation });
        }
      }

      // The DECLARATION of a provider client is itself a perimeter entry: it is the place a
      // real vendor client would be constructed, and `48 §4` item 1 puts one per adapter.
      for (const client of declaredClients) {
        const declarationPattern = new RegExp(
          `(?:export\\s+(?:async\\s+)?function|export\\s+const)\\s+${client}\\b`,
        );
        const index = lines.findIndex((line) => declarationPattern.test(line));
        if (index === -1) continue;
        sites.push({
          file: relativeFile,
          line: index + 1,
          kind: 'PROVIDER_CLIENT',
          scope,
          annotation: annotationNear(lines, index),
        });
      }

      // AND THE DECLARATION OF A PROVIDER-READ CLIENT, for the same reason and with the
      // same force: `48 §2` row 13's exemption is "a named, annotated, reviewed hole", so
      // the place an audit-plane vendor read would be constructed is enumerated too.
      for (const client of declaredReadClients) {
        const declarationPattern = new RegExp(
          `(?:export\\s+(?:async\\s+)?function|export\\s+const)\\s+${client}\\b`,
        );
        const index = lines.findIndex((line) => declarationPattern.test(line));
        if (index === -1) continue;
        sites.push({
          file: relativeFile,
          line: index + 1,
          kind: 'PROVIDER_READ_CLIENT',
          scope,
          annotation: annotationNear(lines, index),
        });
      }
    }
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));

  const production = sites.filter((site) => site.scope === 'PRODUCTION');
  const testOnly = sites.filter((site) => site.scope === 'TEST_ONLY');
  const unannotated = (site: PerimeterCallSite): boolean =>
    site.annotation.kind === 'NONE' || site.annotation.kind === 'INVALID_EXEMPTION';

  const productionUnannotated = production.filter(unannotated).length;
  const testOnlyUnannotated = testOnly.filter(unannotated).length;

  /*
   * `48 §2` ROW 13 — READ SITES, COUNTED SEPARATELY AND GATED THE SAME.
   *
   * Separately because a read and a write carry different annotations and earn different
   * exemptions, and a single total would let one inherit the other's justification. Gated
   * the same because `48 §3`'s exemption is a REVIEWED hole, and an unannotated read is an
   * unreviewed one whatever scope it sits in.
   */
  const providerRead = sites.filter((site) => site.kind === 'PROVIDER_READ_CLIENT');
  const providerReadUnannotated = providerRead.filter(unannotated).length;

  return Object.freeze({
    roots,
    sites,
    productionTotal: production.length,
    productionAuthorised: production.filter((site) => site.annotation.kind === 'AUTHORISED').length,
    productionExempt: production.filter((site) => site.annotation.kind === 'EXEMPT').length,
    productionUnannotated,
    testOnlyTotal: testOnly.length,
    testOnlyUnannotated,
    providerReadTotal: providerRead.length,
    providerReadUnannotated,
    // BOTH SCOPES GATE. A test-only site still has to be annotated — `§18` says a test
    // fixture "remains TEST-ONLY and is not a production perimeter entry", which is about
    // which LIST it lands on, not about whether it may be unannotated.
    pass: productionUnannotated === 0 && testOnlyUnannotated === 0,
  });
}

/** Render the report. Deterministic, and the artifact `48` calls maintained. */
export function renderPerimeterReport(report: PerimeterReport): string {
  const lines: string[] = [];
  lines.push('ACOS EXTERNAL-WRITE PERIMETER — I24 / 48 §4 item 2');
  lines.push('');
  lines.push(`roots:                        ${report.roots.join(', ')}`);
  lines.push(`provider READ sites (48 §2 13): ${report.providerReadTotal}`);
  lines.push(`  unannotated:                ${report.providerReadUnannotated}`);
  lines.push(`production call sites:        ${report.productionTotal}`);
  lines.push(`  carrying authorisation_ref: ${report.productionAuthorised}`);
  lines.push(`  annotated PERIMETER_EXEMPT: ${report.productionExempt}`);
  lines.push(`  UNANNOTATED:                ${report.productionUnannotated}`);
  lines.push(`test-only call sites:         ${report.testOnlyTotal}`);
  lines.push(`  UNANNOTATED:                ${report.testOnlyUnannotated}`);
  lines.push('');
  for (const site of report.sites) {
    const annotation =
      site.annotation.kind === 'EXEMPT'
        ? `EXEMPT(${site.annotation.reason}, ${site.annotation.ticket})`
        : site.annotation.kind === 'INVALID_EXEMPTION'
          ? `INVALID_EXEMPTION — ${site.annotation.reason}`
          : site.annotation.kind;
    lines.push(`${site.scope.padEnd(10)} ${site.kind.padEnd(18)} ${annotation.padEnd(34)} ${site.file}:${site.line}`);
  }
  lines.push('');
  lines.push(report.pass ? 'RESULT: PASS' : 'RESULT: FAIL — an unannotated vendor-call site');
  return lines.join('\n');
}
