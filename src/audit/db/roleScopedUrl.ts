/**
 * S1P-WD — THE ONE RULE FOR A ROLE-SPECIFIC DEPLOYMENT DATABASE URL.
 *
 * =================================================================================
 * WHAT A DEPLOYMENT CREDENTIAL MUST BE BEFORE IT IS USED VERBATIM
 *
 * A deployed audit-plane process is handed ITS OWN role's audit-store URL (a platform secret the
 * template cannot show) and uses it unchanged. Because the template cannot show it, the process
 * itself checks it, and refuses anything else:
 *
 *   1. `postgres:` or `postgresql:`;
 *   2. the decoded user is EXACTLY the expected role;
 *   3. a non-empty host, 4. a non-empty database, 5. a non-empty password;
 *   6. EXACTLY ONE `sslmode` parameter, 7. whose value is EXACTLY `verify-full` (TLS with chain
 *      AND hostname verification in `pg` 8.16 / `pg-connection-string` 2.14);
 *   8. no `ssl` parameter (it would compete with `sslmode`), no case-variant of either, and no
 *      `host`/`hostaddr` parameter (it would connect somewhere other than the verified host).
 *
 * The URL is NEVER rewritten, normalised or upgraded: a weaker mode is a refusal, not a repair,
 * and everything else in it (e.g. `sslrootcert=…`) is preserved byte for byte. The URL is the
 * sole database TLS authority — no `PGSSL*` environment fallback is consulted.
 *
 * This module holds no password and derives none. It is imported by the provider-evidence ingress
 * (inside its container image) and by the evaluator path in `auditPool.ts` (outside it), so the
 * two deployed roles are held to the same rule. LOCAL development derivation from an owner URL is
 * not a role-specific deployment credential and is not subject to it.
 * =================================================================================
 */

export const ROLE_SCOPED_URL_REFUSALS = [
  'AUDIT_STORE_URL_MISSING',
  'AUDIT_STORE_URL_MALFORMED',
  'AUDIT_STORE_ROLE_MISMATCH',
  'AUDIT_STORE_HOST_MISSING',
  'AUDIT_STORE_DATABASE_MISSING',
  'AUDIT_STORE_PASSWORD_MISSING',
  /** `sslmode` absent, or any value but `verify-full`. Never upgraded. */
  'AUDIT_STORE_TLS_NOT_VERIFY_FULL',
  /** A duplicate or case-variant `sslmode`, any `ssl` parameter, or a `host`/`hostaddr` override. */
  'AUDIT_STORE_TLS_PARAMETER_CONFLICT',
] as const;

export type RoleScopedUrlRefusal = (typeof ROLE_SCOPED_URL_REFUSALS)[number];

/** The only accepted TLS mode for a role-specific deployment URL. */
export const REQUIRED_SSLMODE = 'verify-full';

/** Validate a role-specific deployment URL. Returns it UNCHANGED, or a refusal. */
export function validateRoleScopedUrl(
  url: string | undefined,
  role: string,
): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly refusal: RoleScopedUrlRefusal } {
  const refuse = (refusal: RoleScopedUrlRefusal): { readonly ok: false; readonly refusal: RoleScopedUrlRefusal } => ({
    ok: false,
    refusal,
  });
  if (url === undefined || url.length === 0) return refuse('AUDIT_STORE_URL_MISSING');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse('AUDIT_STORE_URL_MALFORMED');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return refuse('AUDIT_STORE_URL_MALFORMED');

  let user: string;
  let password: string;
  let database: string;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    return refuse('AUDIT_STORE_URL_MALFORMED');
  }
  if (user !== role) return refuse('AUDIT_STORE_ROLE_MISMATCH');
  if (parsed.hostname.length === 0) return refuse('AUDIT_STORE_HOST_MISSING');
  if (database.length === 0 || database.includes('/')) return refuse('AUDIT_STORE_DATABASE_MISSING');
  if (password.length === 0) return refuse('AUDIT_STORE_PASSWORD_MISSING');

  const names = [...parsed.searchParams.keys()];
  const lowered = names.map((name) => name.toLowerCase());
  const sslmodeNames = names.filter((name) => name.toLowerCase() === 'sslmode');
  if (
    sslmodeNames.length > 1 ||
    sslmodeNames.some((name) => name !== 'sslmode') ||
    lowered.includes('ssl') ||
    lowered.includes('host') ||
    lowered.includes('hostaddr')
  ) {
    return refuse('AUDIT_STORE_TLS_PARAMETER_CONFLICT');
  }
  if (parsed.searchParams.get('sslmode') !== REQUIRED_SSLMODE) return refuse('AUDIT_STORE_TLS_NOT_VERIFY_FULL');
  return { ok: true, url };
}
