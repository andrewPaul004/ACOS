import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildProbeEnvironment,
  type ProbeOperands,
  type S1PProbePlane,
  type S1PProbeRole,
} from './probeEnvironment.js';
import { PROBE_REPLY_PREFIX, type ProbeReply } from './probeResult.js';

/**
 * THE COORDINATOR'S SIDE OF THE ONE-SHOT CREDENTIAL BOUNDARY — `§5`.
 *
 * =================================================================================
 * **THIS MODULE HOLDS NO CREDENTIAL, READS NO LOCATOR, AND IMPORTS NO SECRET SOURCE.**
 *
 * It imports a path builder, a result type and `node:child_process`. It has no
 * `readFileSync`, no `fetch`, and no import of either plane's secret source or provider
 * client. `tests/sendgrid/credential-process-isolation.test.ts` computes this module's import
 * closure and asserts exactly that, which is the coordinator-side half of correction 5: the
 * rejected harness could resolve both credentials because it imported both sources.
 *
 * What it does hold is two LOCATORS — paths, not material — because it is the process that
 * knows which document each plane's child should read. `§30` of the S1N mandate draws the
 * same line for the control plane: "A LOCATOR, NOT A SECRET."
 *
 * =================================================================================
 * ONE PROCESS PER QUESTION, AND THE DEADLINE IS THE PROCESS'S WHOLE LIFE
 *
 * `fork` with a CONSTRUCTED environment — which REPLACES rather than extends — a stdout pipe,
 * and a timer that kills the child if it has not answered. There is no reuse, no pool and no
 * long-lived handle: a credential-holding process that outlives its one question is a
 * credential in memory for longer than the question needed it.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one-shot child's entry point. Computed from THIS file's location, never configured. */
export const PROBE_ENTRY_POINT = join(HERE, 'probeMain.ts');

/** A one-shot probe's whole life. Above the probes' own 12s transport deadline. */
export const PROBE_PROCESS_DEADLINE_MS = 30_000;

/** What the parent may conclude when no reply arrived. Never a pass, never a refusal. */
export type ProbeLaunchResult =
  | { readonly kind: 'REPLY'; readonly reply: ProbeReply; readonly pid: number | null }
  | { readonly kind: 'PROBE_PROCESS_FAILED'; readonly detail: 'NO_REPLY' | 'TIMED_OUT' };

/**
 * Launch ONE one-shot credential process and read its single reply.
 *
 * The caller supplies a role, a plane, ONE source module, ONE locator and the signed expected
 * credential identity. There is no parameter through which a second locator could be passed,
 * because `buildProbeEnvironment` has no slot for one.
 */
export async function runCredentialProbe(input: {
  readonly role: S1PProbeRole;
  readonly plane: S1PProbePlane;
  readonly sourceModule: string;
  readonly locator: string;
  readonly expectedCredentialId: string;
  readonly operands?: ProbeOperands;
  readonly deadlineMs?: number;
}): Promise<ProbeLaunchResult> {
  const child = fork(PROBE_ENTRY_POINT, [], {
    /*
     * EVERY OPTION HERE IS LOAD-BEARING, and mirrors `integrationClient.ts`'s own fork.
     *
     *   env        the CONSTRUCTED seven-key allowlist. `fork` REPLACES the child's
     *              environment, so nothing this process holds reaches the child.
     *   execArgv   the TypeScript loader and nothing else. No `--inspect`, which would open
     *              a debug port on a process that is about to hold a vendor credential.
     *   stdio      stdout is a PIPE so the reply is read rather than printed; stderr is
     *              IGNORED because `§23` forbids an exception's text from crossing, and a
     *              pipe nobody reads is a buffer that fills.
     */
    env: buildProbeEnvironment({
      role: input.role,
      plane: input.plane,
      sourceModule: input.sourceModule,
      locator: input.locator,
      expectedCredentialId: input.expectedCredentialId,
      operands: input.operands ?? {},
    }),
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
  });

  const pid = child.pid ?? null;
  let buffered = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    // Bounded: a child that printed more than one reply's worth of text is a child that is
    // not behaving as a one-shot probe, and the excess is discarded rather than accumulated.
    if (buffered.length < 64_000) buffered += chunk;
  });

  const deadlineMs = input.deadlineMs ?? PROBE_PROCESS_DEADLINE_MS;
  const exited = await new Promise<'EXITED' | 'TIMED_OUT'>((settle) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle('TIMED_OUT');
    }, deadlineMs);
    child.once('exit', () => {
      clearTimeout(timer);
      settle('EXITED');
    });
    child.once('error', () => {
      clearTimeout(timer);
      settle('EXITED');
    });
  });

  if (exited === 'TIMED_OUT') return { kind: 'PROBE_PROCESS_FAILED', detail: 'TIMED_OUT' };

  const line = buffered
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(PROBE_REPLY_PREFIX));
  if (line === undefined) return { kind: 'PROBE_PROCESS_FAILED', detail: 'NO_REPLY' };
  try {
    return {
      kind: 'REPLY',
      reply: JSON.parse(line.slice(PROBE_REPLY_PREFIX.length)) as ProbeReply,
      pid,
    };
  } catch {
    return { kind: 'PROBE_PROCESS_FAILED', detail: 'NO_REPLY' };
  }
}
