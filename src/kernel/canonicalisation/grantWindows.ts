/**
 * The authoritative grant/window-resolution boundary.
 *
 * `26 §2.1`, the `AuthorizationRequest` field this supplies, verbatim:
 *
 *   `window_refs[]        // every named window the matching grants reference`
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A BOUNDARY AND NOT A CATALOGUE READ — S1B.1, owner clarification S1B-C5a
 *
 * The original S1B populated `window_refs` from the closed action catalogue's declared
 * windows for the class and called the result superset-safe. That is too strong to become
 * production semantics. The architecture defines `window_refs` as the windows the MATCHING
 * GRANTS reference, and the action catalogue alone does not determine the active grant set:
 * a grant may scope to fewer windows, to none, or to a set the catalogue never enumerated.
 * "This action class normally uses these windows, therefore these are the matching grant
 * windows" is a policy conclusion drawn without policy, which is exactly the kind of
 * reasoning the canonicaliser must not do.
 *
 * So canonicalisation stays separated from policy. `window_refs` arrive through this narrow
 * kernel-owned input, and the canonicaliser CARRIES them into the request. It does not
 * derive them, and it has no path to a catalogue window field — there is no longer one to
 * read (`actionCatalogue.ts` declares no windows).
 *
 * WHAT THIS IS NOT. It is not Cedar. It is not grant matching. It is not an implementation
 * of `26 §7` step I, and no S1B artefact claims that the values it carries are the result
 * of actual matching-grant resolution. For S1B fixtures the boundary is supplied directly
 * by the test fixture, which is kernel/test-controlled, never model-supplied, never
 * inferred from `rationale`, and never manufactured from catalogue membership. Deriving the
 * matching grant set remains OPEN to the Cedar/policy slice.
 * ---------------------------------------------------------------------------------
 */
export interface AuthoritativeGrantWindowContext {
  /**
   * The named windows the matching grants reference, as resolved by the authoritative
   * boundary named in `resolvedBy`.
   */
  readonly windowRefs: readonly string[];
  /**
   * The boundary that resolved them, recorded so an audit reader can tell a fixture-supplied
   * set from a grant-resolved one without reading this file. S1B fixtures carry a ref that
   * says so in as many words.
   */
  readonly resolvedBy: string;
}
