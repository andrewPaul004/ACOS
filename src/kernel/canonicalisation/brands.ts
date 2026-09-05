/**
 * The three nominal brands that make `I21` a type boundary rather than a convention.
 *
 * Registry §1.2 `I21`, statement column, verbatim:
 *
 *   "No AuthorizationRequest field is populated from ProposedIntent other than
 *    action_class, resource_ref, selector and reason_code."
 *
 * and its test column, verbatim:
 *
 *   "Type-level property; a test constructing an AuthorizationRequest from a fifth
 *    ProposedIntent field must not compile."
 *
 * `36 §2` says the same thing and adds why it is not the vacuous v1.0 property:
 *
 *   "Unlike v1.0's version this is not vacuous, because the fields that bound money are
 *    now on the other side of the boundary."
 *
 * ---------------------------------------------------------------------------------
 * HOW THE BOUNDARY IS BUILT
 *
 * Three brands, mutually non-assignable:
 *
 *   PermittedIntentField<T>  the four fields ADR-006 permits to cross
 *   KernelComputed<T>        every other authority-bearing field
 *   OpaqueRationale          the fifth field, which is not a string at all
 *
 * A raw `string` off a parsed intent is not assignable to `KernelComputed<string>`, so a
 * constructor cannot quietly pass a model-chosen value into an authority position. A
 * `KernelComputed<string>` IS assignable to `string`, so reading a computed value stays
 * ordinary. The asymmetry is the whole mechanism.
 *
 * `computed()` is the only mint. It is exported for `src/kernel/canonicalisation/` and is
 * deliberately not re-exported from this package's public surface (`index.ts`), so a
 * caller outside canonicalisation cannot fabricate an authority-bearing field.
 * ---------------------------------------------------------------------------------
 */

declare const KernelComputedBrand: unique symbol;
declare const PermittedIntentFieldBrand: unique symbol;

/**
 * A field the kernel computed from authoritative state.
 *
 * `26 §2.1`, on the AuthorizationRequest block, verbatim: "every field below is
 * kernel-computed".
 */
export type KernelComputed<T> = T & { readonly [KernelComputedBrand]: 'kernel' };

/**
 * One of exactly the four fields `I21` permits to cross from `ProposedIntent`.
 *
 * Distinct from `KernelComputed` on purpose: the type system records *which* of the two
 * permitted provenances a field has, so a reviewer reading the request type can see the
 * boundary without reading the constructor.
 */
export type PermittedIntentField<T> = T & { readonly [PermittedIntentFieldBrand]: 'intent' };

/** Mint a kernel-computed field. The only mint; see the module header. */
export function computed<T>(value: T): KernelComputed<T> {
  return value as KernelComputed<T>;
}

/**
 * Mint one of the four permitted intent fields. Called only by `intent.ts`, which is the
 * single place a `ProposedIntent` is parsed.
 */
export function fromPermittedIntentField<T>(value: T): PermittedIntentField<T> {
  return value as PermittedIntentField<T>;
}
