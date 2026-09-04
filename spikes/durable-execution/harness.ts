import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'child.ts');

export interface ChildOutcome {
  /** 'COMPLETED' | 'KILLED' | 'FAILED' */
  readonly result: 'COMPLETED' | 'KILLED' | 'FAILED';
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run one candidate in a child process, with a named kill point.
 *
 * The child SIGKILLs itself, so the outcome is distinguished by how the process ended:
 * a `KILLED_AT` line on stdout followed by a non-zero exit or a signal is a real crash;
 * `COMPLETED` is a clean run.
 */
export function runChild(
  candidate: 'A' | 'B',
  killPoint: string,
  workflowId: string,
  workItemId: string,
  delta: string,
  env: NodeJS.ProcessEnv,
): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        CHILD,
        candidate,
        killPoint,
        workflowId,
        workItemId,
        delta,
      ],
      {
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code, signal) => {
      const killed = stdout.includes('KILLED_AT');
      const completed = stdout.includes('COMPLETED');
      resolve({
        result: killed ? 'KILLED' : completed ? 'COMPLETED' : 'FAILED',
        exitCode: code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}
