import { main } from './cli.js';

/**
 * THE S1P LIVE-VALIDATION ENTRY POINT — `npm run validate:sendgrid`.
 *
 * It exists so `cli.ts` can have NO module-evaluation side effect: a module that runs itself
 * when imported is a module whose safety depends on nobody importing it, and the offline
 * suite imports `cli.ts` to exercise `establishFacts` and the preflight.
 *
 * `§8.5`: a real provider call requires explicit invocation. THIS FILE IS THAT INVOCATION,
 * and even it performs none until every preflight gate has passed.
 */
void main().then((code) => {
  process.exitCode = code;
});
