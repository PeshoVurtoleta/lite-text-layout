/**
 * @zakkster/lite-text-layout -- torture gate.
 *
 * The DONE-WHEN of every session is a single command:
 *
 *     node --expose-gc test/torture.mjs        -> prints exactly "ok", exit 0
 *     npm run torture
 *
 * Eight tiers share one shape (see BRIEF THE HARNESS SPEC). TL0 stands up the
 * harness and wires the tiers this package needs:
 *
 *     T0  metamorphic laws          T1  degenerate values
 *     T2  buffer capacity + type    T5  differential fuzz vs oracle
 *     T6  the zero-alloc gate       T7  soak + retention
 *     T8  cross-package (empty, TL3)   T9  controls (must be able to fail)
 *
 * lite-gc-profiler is one-measurement-at-a-time, so tiers run STRICTLY
 * SEQUENTIALLY -- never nested, never concurrent.
 *
 * Control: `TEXTLAYOUT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs`
 * injects a retained allocation into the T6 hot loop and must exit non-zero.
 * A gate that cannot fail is decorative.
 *
 * Peers (lite-gc-profiler, lite-leak) are devDependencies only. TextLayout.js
 * has zero runtime dependencies.
 *
 * WATCHDOG: the tiers run synchronously, so a non-terminating tier (see TL-27 --
 * a broken countLines invariant hangs instead of failing) would block the event
 * loop forever. A same-process `setTimeout` cannot fire while the loop is wedged,
 * so it would be useless against exactly that hang. Instead this entry point
 * FORKS itself: the parent spawns the child that runs the tiers and guards it
 * with a wall-clock timer from its own free event loop, killing the child and
 * exiting non-zero if the run exceeds WATCHDOG_MS. The guard lives in a separate
 * process, so it cannot perturb the T6/T7 measured windows. A gate that can hang
 * forever has stopped being a gate.
 *
 * @license MIT
 */

import { spawn } from 'node:child_process';
import { SEED, BREAK, finish } from './torture/harness.mjs';
import { run as t0 } from './torture/t0-laws.mjs';
import { run as t1 } from './torture/t1-degenerate.mjs';
import { run as t2 } from './torture/t2-capacity.mjs';
import { run as t5 } from './torture/t5-fuzz.mjs';
import { run as t6 } from './torture/t6-alloc.mjs';
import { run as t7 } from './torture/t7-soak.mjs';
import { run as t8 } from './torture/t8-cross.mjs';
import { run as t9 } from './torture/t9-controls.mjs';

const TIERS = [
    ['T0 laws', t0],
    ['T1 degenerate', t1],
    ['T2 capacity', t2],
    ['T5 fuzz', t5],
    ['T6 alloc', t6],
    ['T7 soak', t7],
    ['T8 cross', t8],
    ['T9 controls', t9],
];

function main() {
    if (typeof globalThis.gc !== 'function') {
        process.stderr.write(
            'torture: FAIL -- run with --expose-gc:  node --expose-gc test/torture.mjs\n');
        process.exit(1);
    }

    for (const [name, run] of TIERS) {
        try {
            run();
        } catch (err) {
            // Tiers normally fail via die() (which exits). A thrown error is an
            // unexpected fault -- surface it with the replay seed and stop.
            process.stderr.write(
                'torture: FAIL -- ' + name + ' threw: ' + (err && err.stack || err) +
                '\n  replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs\n');
            process.exit(1);
        }
    }

    // Reaching here in BREAK mode means T6's control did not trip -- a fault.
    if (BREAK) {
        process.stderr.write(
            'torture: FAIL -- TEXTLAYOUT_TORTURE_BREAK set but the gate still passed\n');
        process.exit(1);
    }

    finish();
    process.stdout.write('ok\n');
    process.exit(0);
}

/** Generous wall-clock bound. The full run is ~1.5s; 120s only ever trips on a
 * real hang (TL-27), never on a slow-but-progressing run. */
const WATCHDOG_MS = 120000;

/**
 * Parent side: spawn this file again as a child (same node flags, so --expose-gc
 * carries over via execArgv) with the tiers running there, and watchdog it. The
 * parent event loop stays free, so it can kill a child that has wedged itself in
 * a synchronous infinite loop -- which a same-process timer could never do.
 */
function runWithWatchdog() {
    const child = spawn(
        process.execPath,
        [...process.execArgv, ...process.argv.slice(1)],
        { stdio: 'inherit', env: { ...process.env, TEXTLAYOUT_TORTURE_CHILD: '1' } },
    );
    const timer = setTimeout(() => {
        process.stderr.write(
            'torture: FAIL -- watchdog fired: run exceeded ' + WATCHDOG_MS +
            ' ms; a tier is not terminating (see TL-27). Killing child.\n');
        child.kill('SIGKILL');
        process.exit(1);
    }, WATCHDOG_MS);
    child.on('error', (err) => {
        clearTimeout(timer);
        process.stderr.write('torture: FAIL -- could not spawn child: ' + (err && err.message || err) + '\n');
        process.exit(1);
    });
    child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (signal) {
            process.stderr.write('torture: FAIL -- child terminated by ' + signal + '\n');
            process.exit(1);
        }
        process.exit(code === null ? 1 : code);
    });
}

if (process.env.TEXTLAYOUT_TORTURE_CHILD === '1') {
    main();
} else {
    runWithWatchdog();
}
