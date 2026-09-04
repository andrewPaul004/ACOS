/**
 * Money, as minor units in a bigint.
 *
 * `26 §10.1` types a ceiling as `Money | UNBOUNDED` and forbids `null`. `30 §5.3`
 * (ACOS-JCS-1) requires a per-column declared decimal scale serialised as a string at
 * exactly that scale, and states plainly that `25.0` and `25.00` are different bytes.
 *
 * Neither is expressible in a JavaScript number, so no money value in this codebase is
 * ever a `number`. The internal representation is a bigint count of minor units; the
 * wire representation to and from PostgreSQL is a fixed-scale string.
 */

export const SCALE = 2;
const SCALE_FACTOR = 100n;

declare const MoneyBrand: unique symbol;
export type Money = bigint & { readonly [MoneyBrand]?: true };

export const ZERO: Money = 0n as Money;

/** Parse a fixed-scale decimal string, as PostgreSQL returns NUMERIC(18,2). */
export function fromDb(value: string): Money {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`not a NUMERIC literal: ${JSON.stringify(value)}`);
  }
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > SCALE) {
    // Silently rounding here is how a money field acquires a scale change nobody
    // declared. `30 §5.3` treats that as a semantic change, so it is an error.
    throw new Error(
      `NUMERIC ${JSON.stringify(value)} carries more than ${SCALE} decimal places`,
    );
  }
  const padded = fraction.padEnd(SCALE, '0');
  const magnitude = BigInt(whole ?? '0') * SCALE_FACTOR + BigInt(padded === '' ? '0' : padded);
  return (sign === '-' ? -magnitude : magnitude) as Money;
}

/** Render at exactly the declared scale, for the wire and for assertions. */
export function toDb(value: Money): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE_FACTOR;
  const fraction = magnitude % SCALE_FACTOR;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(SCALE, '0')}`;
}

/** Build a Money from a literal, e.g. `money('186.00')`. Used heavily in fixtures. */
export function money(literal: string): Money {
  return fromDb(literal);
}

export function add(...values: readonly Money[]): Money {
  return values.reduce<bigint>((a, b) => a + b, 0n) as Money;
}

export function sub(a: Money, b: Money): Money {
  return (a - b) as Money;
}

export function mulByRational(value: Money, numerator: bigint, denominator: bigint): Money {
  if (denominator === 0n) throw new Error('division by zero');
  // Round half away from zero, which is the convention a currency amount takes when a
  // multiplier such as 30.4 is applied.
  const scaled = value * numerator * 2n;
  const doubled = denominator * 2n;
  const quotient = scaled / doubled;
  const remainder = scaled % doubled;
  const half = denominator;
  if (remainder === 0n) return quotient as Money;
  const roundAway = (remainder < 0n ? -remainder : remainder) * 2n >= half * 2n;
  if (!roundAway) return quotient as Money;
  return (quotient + (scaled < 0n ? -1n : 1n)) as Money;
}

export function max(a: Money, b: Money): Money {
  return (a > b ? a : b) as Money;
}

export function isZero(value: Money): boolean {
  return value === 0n;
}
