/**
 * THE KILL-POINT-3 EXIT CODE, ALONE IN ITS OWN MODULE.
 *
 * `§9`'s point 3 is produced by launching the integration runtime from a DIFFERENT adapter
 * module that exits after the real send returned. There are two such modules — the live one in
 * `killPointAdapter.ts` and the offline double in `tests/sendgrid-doubles/` — and a run's
 * process table has to say which kill a non-zero exit was.
 *
 * ONE constant, in a module with no `fetch` and no adapter, so the OFFLINE double can name the
 * SAME exit code as the live module without importing a real vendor send client to get it. A
 * second literal would be a second thing to keep in step, and the whole point of the code is
 * that a reviewer reading an exit status knows exactly which mechanism produced it.
 */
export const KILL_POINT_3_EXIT_CODE = 33;
