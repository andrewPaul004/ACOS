import type { ActionClass, ReasonCodeScope } from '../canonicalisation/actionCatalogue.js';

/**
 * The task `context_spec`, and the ONE authoritative option-description projection.
 *
 * `26 §2.0.1`, the field-visibility row, verbatim:
 *
 *   "Governed by the task's context_spec. **No field appears in any option `description`
 *    that the context_spec does not admit** (I52), enforced by a projection filter at
 *    runtime and by spec review in CI."
 *
 * Registry `I52`, verbatim:
 *
 *   "No EnumeratedOptionSet returned by enumerate_effects contains, in any option
 *    description, a field outside the requesting task's context_spec admitted-field set."
 *
 * `25 §4`, the task contract, verbatim: `context_spec` is "exactly which state/evidence the
 * assembler must fetch", and `23 §5` B9 lists `context_spec`s among the sixteen classes of
 * **control artifact** that no principal may modify.
 *
 * ---------------------------------------------------------------------------------
 * THERE IS EXACTLY ONE DESCRIPTION PROJECTION IN THIS CODEBASE
 *
 * The S1C mandate: "Do not build descriptions ad hoc inside two separate paths. Create one
 * authoritative option-description projection used by: the model-facing enumeration; the
 * selected option recorded during C′."
 *
 * S1B authored the recorded description as a template literal inside
 * `constructors/refundCreate.ts`. That was correct for S1B — there was no enumeration to
 * agree with — and it is exactly the second path the mandate forbids now. It is replaced by
 * `projectOptionDescription` below.
 *
 * The split of responsibility is deliberate:
 *
 *   the CONSTRUCTOR declares the option's CANDIDATE FIELDS      (per class, with the class)
 *   this MODULE decides which of them a task may SEE            (one filter, one renderer)
 *
 * A class cannot render its own string, so it cannot leak a field past the filter; and the
 * filter carries no per-class branch, so adding a class does not edit it. That is the same
 * division S1B.2 finding 6 applied to the semantic digest, for the same reason.
 * ---------------------------------------------------------------------------------
 */

/**
 * One candidate field of an option description, declared by the registered constructor.
 *
 * `name` is the admitted-field key the `context_spec` grants or withholds. `value` is
 * already rendered to text by the constructor — a description is prose for a model, not a
 * typed structure, and rendering money here would put a second `toDb` on a display path.
 */
export interface OptionDescriptionField {
  readonly name: string;
  readonly value: string;
}

/**
 * The task's `context_spec`, in the shape S1C needs.
 *
 * This is NOT the whole `25 §4` contract. It is the three parts the enumeration READ is
 * governed by — the resource scope, the admitted description fields, and the reason-code
 * scope — plus the identity the enumeration is bound to. `task_type`, `evidence_scope`,
 * `tool_scope`, `output_schema`, `budgets` and the rest belong to the work-orchestration
 * slice and are not invented here.
 */
export interface TaskContextSpec {
  readonly companyId: string;
  readonly taskId: string;
  readonly principalId: string;

  /**
   * `26 §2.0.1` resource-scope row: "resource_ref must resolve to a RECORD-grade entity
   * inside the task's context_spec scope".
   *
   * `24 §3` K4, on what AI may not do: "Enumerate outside the resource set its context_spec
   * admits."
   */
  readonly admittedResourceRefs: ReadonlySet<string>;

  /**
   * `I52`'s admitted-field set, per action class.
   *
   * A class absent from this map admits NO description field, so the default is closed. A
   * `context_spec` that forgot to declare a class produces empty descriptions rather than
   * full ones, which is the direction a field-visibility control must fail in.
   */
  readonly admittedDescriptionFields: Readonly<Partial<Record<ActionClass, ReadonlySet<string>>>>;

  /**
   * The reason-code scope this task enumerates under — S1C fixture decision S1C-C5.
   *
   * `refund.create`'s `semantic_option_digest` includes `reason_code_scope` (`26 §2.2`), but
   * `enumerate_effects(action_class, resource_ref)` takes no reason code. Enumerating the
   * cross product over every scope would make the refund enumeration three-dimensional,
   * which contradicts `26 §8`'s "two-dimensional over (line, parent_transaction)".
   *
   * S1C therefore takes the scope from the TASK — kernel-owned, part of a control artifact,
   * never a model input. S1B's existing cohesion check then does the work it was written
   * for: a proposed `reason_code` whose scope differs from the selected option's denies
   * `SELECTOR_INVALID` (`constructors/refundCreate.ts`, S1B.2 finding 1D).
   *
   * The architecture does not say where the scope comes from at enumeration time, so this
   * is recorded as a fixture decision and not as a reading of it. See
   * docs/implementation/S1C-owner-clarifications.md S1C-C5.
   */
  readonly reasonCodeScope: ReasonCodeScope;
}

/** Whether the task's `context_spec` admits this resource at all. */
export function admitsResource(spec: TaskContextSpec, resourceRef: string): boolean {
  return spec.admittedResourceRefs.has(resourceRef);
}

/**
 * Project an option's candidate fields through the task's `context_spec`.
 *
 * The single authoritative projection. Both the model-facing enumeration and the selected
 * option recorded at C′ call THIS function, on the same authoritative option and the same
 * spec, so the recorded description cannot drift from the one the model saw.
 *
 * The rendering is deterministic and declared here:
 *
 *   - fields are emitted in the ORDER THE CONSTRUCTOR DECLARED them, not in the admitted
 *     set's iteration order, so a `context_spec` edit that reorders a set cannot reorder a
 *     description;
 *   - each admitted field renders as `name=value`;
 *   - fields join with a single space.
 *
 * A field the `context_spec` does not admit is DROPPED — its name does not appear, its
 * value does not appear, and no placeholder marks its absence. A placeholder would restore
 * the oracle the filter exists to remove: "this option has a field you may not see" is
 * itself information about the option.
 */
export function projectOptionDescription(
  spec: TaskContextSpec,
  actionClass: ActionClass,
  fields: readonly OptionDescriptionField[],
): string {
  const admitted = spec.admittedDescriptionFields[actionClass];
  if (admitted === undefined) return '';
  return fields
    .filter((field) => admitted.has(field.name))
    .map((field) => `${field.name}=${field.value}`)
    .join(' ');
}

/**
 * The field NAMES a projection would emit for the given candidates under the given spec.
 *
 * Exported for `I52`'s runtime assertion: a test asserts that the emitted name set is a
 * subset of the admitted set, which is the invariant's statement in executable form. It is
 * derived from the same filter the renderer uses rather than by re-parsing the rendered
 * string, so the assertion cannot pass against a renderer that leaked.
 */
export function projectedFieldNames(
  spec: TaskContextSpec,
  actionClass: ActionClass,
  fields: readonly OptionDescriptionField[],
): readonly string[] {
  const admitted = spec.admittedDescriptionFields[actionClass];
  if (admitted === undefined) return [];
  return fields.filter((field) => admitted.has(field.name)).map((field) => field.name);
}
