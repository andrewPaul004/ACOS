import type { ResolvedResource } from '../canonicalisation/types.js';
import { authorityDefect } from './errors.js';

/**
 * `26 §4`'s `resource_selector { type, predicate }`, as a CLOSED predicate language.
 *
 * ---------------------------------------------------------------------------------
 * WHY THE LANGUAGE IS THREE FORMS AND NOT AN EXPRESSION EVALUATOR
 *
 * `26 §4` prints the field and does not specify a syntax. The temptation is a small
 * expression language, and the reason not to build one is `26 §2.3`: "The engine reads no
 * prose." A general predicate evaluator over a string column is an interpreter sitting on
 * the money path whose inputs are rows — and rows are exactly what a compromised adapter
 * writes (`24 §10` case 6).
 *
 * So the language is closed, three forms, parsed by this file and nothing else:
 *
 *   ANY                          every resource of the declared `type`
 *   RESOURCE_REF_EQ:<ref>        exactly one resource, by the ref the kernel resolved
 *   RESOURCE_ID_PREFIX:<prefix>  a declared prefix of the resolved resource id
 *
 * An unrecognised predicate is an AUTHORITY DEFECT, not a non-match. A grant nobody can
 * parse must halt rather than silently failing to select — a silent non-match is an
 * availability failure that reads as a security success, and the next engineer "fixes" it by
 * loosening something.
 *
 * Recorded as S1E fixture decision S1E-C3.
 * ---------------------------------------------------------------------------------
 */

export interface ResourceSelector {
  readonly type: string;
  readonly predicate: string;
}

/**
 * The resource `type` S1E resolves for the one class it evaluates.
 *
 * `26 §4`'s selector carries a `type`; the resolved resource carries a ref of the form
 * `order:ORD-123`. The type is the ref's prefix, taken from the KERNEL-RESOLVED ref, so a
 * grant scoped to `order` cannot be satisfied by a resource of another type.
 */
export function resourceTypeOf(resource: ResolvedResource): string {
  const separator = resource.resourceRef.indexOf(':');
  if (separator <= 0) {
    authorityDefect(
      'I',
      `the resolved resource ref ${resource.resourceRef} does not carry a type prefix`,
    );
  }
  return resource.resourceRef.slice(0, separator);
}

/** Whether the selector selects the KERNEL-RESOLVED resource. */
export function selectorMatchesResource(
  selector: ResourceSelector,
  resource: ResolvedResource,
): boolean {
  if (selector.type !== resourceTypeOf(resource)) return false;

  if (selector.predicate === 'ANY') return true;

  const equals = 'RESOURCE_REF_EQ:';
  if (selector.predicate.startsWith(equals)) {
    return resource.resourceRef === selector.predicate.slice(equals.length);
  }

  const prefix = 'RESOURCE_ID_PREFIX:';
  if (selector.predicate.startsWith(prefix)) {
    return resource.resourceId.startsWith(selector.predicate.slice(prefix.length));
  }

  authorityDefect('I', `grant resource predicate is not in the closed language`);
}
