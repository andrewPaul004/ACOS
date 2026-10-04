/**
 * `ingress_identity` — A MECHANICALLY COMPARED URL, NOT A LABEL. `50 §2h` (v1.3.8, `S1P-W5`).
 *
 * =================================================================================
 * THE GRAMMAR, TRANSCRIBED — AND NOTHING MORE PERMISSIVE
 *
 * `https://<host><fixed-path>`, where:
 *
 *   * the scheme is exactly `https`, lowercase;
 *   * `<host>` is a DNS name, lowercase ASCII (an IDN appears in A-label `xn--` form), with no
 *     trailing dot, no IP literal and no wildcard label;
 *   * there is no port, no userinfo, no query and no fragment;
 *   * `<fixed-path>` is one absolute path of literal segments: no empty segment, no `.` or `..`
 *     segment, no percent-encoding, no trailing `/`, no pattern, no wildcard, no parameter.
 *
 * THIS MODULE IS A RECOGNISER, NOT A NORMALISER. `50 §2h`: "Every comparison below is **exact
 * octet equality** against that canonical string; nothing is case-folded, normalised or
 * prefix-matched at run time, because the stored value is already canonical." A value that is
 * not already canonical is refused; it is never rewritten into one.
 *
 * WHAT THE BINDING IS, AND IS NOT. A configuration-scope control: it stops one trust root being
 * live at an endpoint the owner did not sign. It is NOT sender authentication — `Host` is
 * attacker-choosable, which is exactly why every comparison here can only REFUSE.
 * =================================================================================
 */

/** The scheme prefix. A literal compared byte for byte; never a request-derived value. */
const SCHEME_PREFIX = 'https://';

/** One DNS label: 1 to 63 of `[a-z0-9-]`, not starting or ending with `-`. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** One literal path segment: RFC 3986 unreserved characters only. */
const PATH_SEGMENT = /^[A-Za-z0-9\-._~]+$/;

/** The parsed parts of a canonical ingress identity. */
export interface IngressIdentity {
  /** The whole canonical string, byte for byte as signed. */
  readonly value: string;
  readonly host: string;
  readonly path: string;
}

/** Why a value is not a canonical ingress identity. A closed set. */
export const INGRESS_IDENTITY_REFUSALS = [
  'INGRESS_NOT_HTTPS',
  'INGRESS_HOST_INVALID',
  'INGRESS_HOST_IS_IP_LITERAL',
  'INGRESS_HAS_PORT',
  'INGRESS_HAS_USERINFO',
  'INGRESS_HAS_QUERY',
  'INGRESS_HAS_FRAGMENT',
  'INGRESS_PATH_INVALID',
] as const;

export type IngressIdentityRefusal = (typeof INGRESS_IDENTITY_REFUSALS)[number];

function validHost(host: string): IngressIdentityRefusal | null {
  if (host.length === 0 || host.length > 253) return 'INGRESS_HOST_INVALID';
  if (host.endsWith('.')) return 'INGRESS_HOST_INVALID';
  const labels = host.split('.');
  if (!labels.every((label) => DNS_LABEL.test(label))) return 'INGRESS_HOST_INVALID';
  // No top-level label is all digits, so an all-digit final label is an IPv4 literal (or a
  // name that would be read as one). IPv6 literals need `[`, which the label grammar refuses.
  if (/^[0-9]+$/.test(labels[labels.length - 1]!)) return 'INGRESS_HOST_IS_IP_LITERAL';
  return null;
}

function validPath(path: string): boolean {
  if (!path.startsWith('/') || path.length < 2) return false;
  if (path.endsWith('/')) return false;
  const segments = path.slice(1).split('/');
  return segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment),
  );
}

/**
 * Recognise a canonical ingress identity, or refuse it.
 *
 * Used for the SIGNED class-28 field (a record failure on refusal) and for nothing a request
 * supplies — the per-request comparison below is equality against the value this accepted.
 */
export function parseIngressIdentity(
  value: string,
): { readonly ok: true; readonly identity: IngressIdentity } | { readonly ok: false; readonly refusal: IngressIdentityRefusal } {
  if (!value.startsWith(SCHEME_PREFIX)) return { ok: false, refusal: 'INGRESS_NOT_HTTPS' };
  const rest = value.slice(SCHEME_PREFIX.length);
  if (rest.includes('#')) return { ok: false, refusal: 'INGRESS_HAS_FRAGMENT' };
  if (rest.includes('?')) return { ok: false, refusal: 'INGRESS_HAS_QUERY' };
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash);
  if (authority.includes('@')) return { ok: false, refusal: 'INGRESS_HAS_USERINFO' };
  if (authority.includes(':')) return { ok: false, refusal: 'INGRESS_HAS_PORT' };
  const hostRefusal = validHost(authority);
  if (hostRefusal !== null) return { ok: false, refusal: hostRefusal };
  if (!validPath(path)) return { ok: false, refusal: 'INGRESS_PATH_INVALID' };
  return { ok: true, identity: Object.freeze({ value, host: authority, path }) };
}

/**
 * `50 §2h` comparison 1 — THE STARTUP BINDING.
 *
 * The launch echo is the deployment's statement of which URL this receiver was deployed to
 * serve. It is NOT authority: it is compared against the signed value and can only stop the
 * receiver. There is no code path in which it replaces, widens or redirects the signed value —
 * this function returns a boolean and nothing else.
 */
export function launchEchoMatches(signed: IngressIdentity, launchEcho: string | undefined): boolean {
  return launchEcho !== undefined && launchEcho === signed.value;
}

/**
 * `50 §2h` comparison 2 — THE PER-REQUEST TARGET.
 *
 * `https://` ‖ the lowercase request host (from `Host`, exactly once, as delivered by the
 * declared TLS-terminating front end; an explicit port is REFUSED rather than stripped) ‖ the
 * exact request path, which must equal the signed value exactly.
 *
 * NO FORWARDED HEADER IS READ. Not `X-Forwarded-Host`, not `X-Forwarded-Proto`, not
 * `Forwarded` — the function is not handed them, because it is handed only the `Host` values
 * and the request target. The scheme is never reconstructed from a header: HTTPS is
 * guaranteed by the front end's TLS-only configuration (`48 §8` G3) and by the grammar.
 */
export function requestTargetMatches(
  signed: IngressIdentity,
  request: { readonly hostValues: readonly string[]; readonly requestTarget: string },
): boolean {
  if (request.hostValues.length !== 1) return false;
  const host = request.hostValues[0]!.toLowerCase();
  // An explicit port — including `:443` — is a different authority, refused not stripped.
  if (host.includes(':') || host.includes('@')) return false;
  // Origin-form only. An absolute-form target, a query and a fragment all fail equality, but
  // they are refused explicitly so the rule does not rest on that.
  if (!request.requestTarget.startsWith('/')) return false;
  if (request.requestTarget.includes('?') || request.requestTarget.includes('#')) return false;
  return `${SCHEME_PREFIX}${host}${request.requestTarget}` === signed.value;
}
