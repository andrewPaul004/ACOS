import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  actionCatalogue,
  type ActionCatalogueEntry,
} from '../../src/kernel/canonicalisation/actionCatalogue.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import {
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from '../support/canonicalisationFixture.js';

/**
 * v1.3.6 (`50 §2a`, `50 §3f`): the catalogue is READ FROM THE ACTIVE VERIFIED BUNDLE.
 *
 * Before S1K this was a frozen literal imported from `actionCatalogue.ts`. `50 §3f`'s single
 * source of authority rule moved it into the signed class-3 artifact, so this binding now
 * resolves the same rows out of the bundle `tests/support/controlArtifactSetup.ts`
 * bootstrapped — which is what production reads.
 */
const ACTION_CATALOGUE = actionCatalogue().entries;


/**
 * S1B.2, FINDING 1B — the action catalogue entry is not arbitrary context.
 *
 * `recoverability` (`26 §5`), `value_direction` (`26 §11.2`, `I59`), the adapter, the method
 * and the money-carrying / cost-component-free declarations are properties of the CLOSED
 * ACTION CATALOGUE, keyed by `action_class`. `26 §2.1` says so of the first two verbatim:
 * "From the catalogue, never null (I59)."
 *
 * The original S1B carried a branded `context.catalogueEntry` and trusted it. A caller that
 * wired state incorrectly — or a future code path that assembled a context from the wrong
 * place — could then give a `refund.create` request `campaign.pause`'s recoverability, its
 * value_direction, its adapter or its method, with the catalogue itself unchanged and
 * nothing in the request recording that a substitution had occurred.
 *
 * ---------------------------------------------------------------------------------
 * THE REPAIR IS REMOVAL, NOT VALIDATION
 *
 * The field is gone from `AuthoritativeCanonicalisationContext`. The canonicaliser reads
 * `ACTION_CATALOGUE[intent.actionClass]` itself, after `action_class` has passed the
 * closed-catalogue check, and passes the row to the constructor on `ConstructorInput`.
 *
 * That makes the substitution STRUCTURALLY IMPOSSIBLE rather than merely rejected, so the
 * negative test this finding asks for cannot be written as a runtime fixture at all — there
 * is no field to populate. It is written three ways instead:
 *
 *   1. as a compile-negative — tests/type-negative/catalogue-entry-into-context.ts, run by
 *      i21-type-boundary.test.ts against a real `tsc`;
 *   2. as a structural assertion on the type and on the source, below;
 *   3. as a behavioural assertion that the emitted authority fields track the CATALOGUE and
 *      nothing else, below.
 * ---------------------------------------------------------------------------------
 */

const CANONICALISATION_ROOT = join('src', 'kernel', 'canonicalisation');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('1 — the substitution has no expressible form', () => {
  it('the authoritative context type declares no catalogue entry field', () => {
    const code = codeOf(join(CANONICALISATION_ROOT, 'types.ts'));
    const block = /export interface AuthoritativeCanonicalisationContext \{([\s\S]*?)\n\}/.exec(
      code,
    )![1]!;
    const fields = [...block.matchAll(/readonly (\w+)[?]?:/g)].map((match) => match[1]!);
    expect(fields).not.toContain('catalogueEntry');
    // And the rule is not vacuous: the type still carries the fields it is supposed to.
    expect(fields).toContain('ledgerCurrency');
    expect(fields).toContain('grantWindows');
  });

  it('the shared fixture has no override that could supply one', () => {
    const code = codeOf(join('tests', 'support', 'canonicalisationFixture.ts'));
    expect(code).not.toContain('catalogueEntry');
  });

  it('nothing in the canonicaliser reads a catalogue entry off the context', () => {
    for (const file of walk(CANONICALISATION_ROOT)) {
      expect(codeOf(file), `${file} reads a catalogue entry from the context`).not.toMatch(
        /context\.catalogueEntry/,
      );
    }
  });

  it('the canonicaliser reads the VERIFIED catalogue, keyed by the validated action class', () => {
    // v1.3.6 (`50 §2a`, `50 §3f`): the row comes from the signed class-3 artifact through
    // `actionCatalogueEntry`, not from a frozen literal. The key is still the validated
    // `intent.actionClass` and nothing else, which is what this assertion has always been
    // about.
    const code = codeOf(join(CANONICALISATION_ROOT, 'canonicaliser.ts'));
    expect(code).toContain('actionCatalogueEntry(intent.actionClass)');
    expect(code).not.toContain('ACTION_CATALOGUE');
  });
});

describe('2 — a refund cannot acquire another class authority through context', () => {
  /**
   * The behavioural half. `campaign.pause` is REVERSIBLE with value_direction NONE and
   * dispatches through `mock_ads`; `refund.create` is COMPENSABLE with
   * INBOUND_ORIGINAL_INSTRUMENT through `mock_processor`. Every one of those four is a field
   * the original S1B would have taken from whatever row the context carried.
   */
  const option = makeRefundOption();
  const { canonicaliser } = makeCanonicaliser();
  const { request, dispatchPayload } = canonicaliser.canonicalise(
    parseProposedIntent(makeRawIntent(option)),
    makeContext(),
    option,
  );

  const refund = ACTION_CATALOGUE['refund.create'];
  const pause = ACTION_CATALOGUE['campaign.pause'];

  it('the four substitutable fields differ between the two classes, so the test discriminates', () => {
    expect(refund.recoverability).not.toBe(pause.recoverability);
    expect(refund.valueDirection).not.toBe(pause.valueDirection);
    expect(refund.adapter).not.toBe(pause.adapter);
    expect(refund.method).not.toBe(pause.method);
  });

  it('recoverability is the refund row, never campaign.pause REVERSIBLE', () => {
    expect(request.recoverability).toBe(refund.recoverability);
    expect(request.recoverability).toBe('COMPENSABLE');
    expect(request.recoverability).not.toBe(pause.recoverability);
  });

  it('value_direction is the refund row, never campaign.pause NONE', () => {
    expect(request.valueDirection).toBe(refund.valueDirection);
    expect(request.valueDirection).toBe('INBOUND_ORIGINAL_INSTRUMENT');
    expect(request.valueDirection).not.toBe(pause.valueDirection);
  });

  it('the adapter and method are the refund row, never campaign.pause mock_ads', () => {
    expect(dispatchPayload.adapter).toBe(refund.adapter);
    expect(dispatchPayload.method).toBe(refund.method);
    expect(dispatchPayload.adapter).not.toBe(pause.adapter);
    expect(dispatchPayload.method).not.toBe(pause.method);
  });

  it('and the money-carrying declaration is the refund row too, which I18a reads', () => {
    // `campaign.pause` carries no vendor monetary field. Had its row been substituted, I18a
    // would have demanded a NULL monetary effect for a refund of $25.00.
    expect(refund.carriesVendorMonetaryField).toBe(true);
    expect(pause.carriesVendorMonetaryField).toBe(false);
    expect(dispatchPayload.monetaryEffect).not.toBeNull();
  });
});

describe('3 — the catalogue itself is closed and frozen', () => {
  it('every class row is frozen, so a row cannot be mutated in place', () => {
    for (const entry of Object.values(ACTION_CATALOGUE) as ActionCatalogueEntry[]) {
      expect(Object.isFrozen(entry), entry.actionClass).toBe(true);
    }
    expect(Object.isFrozen(ACTION_CATALOGUE)).toBe(true);
  });

  it('each row names its own action class, so a row cannot be filed under another key', () => {
    for (const [key, entry] of Object.entries(ACTION_CATALOGUE)) {
      expect(entry.actionClass).toBe(key);
    }
  });
});
