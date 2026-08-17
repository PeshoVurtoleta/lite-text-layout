/**
 * T6 -- the zero-alloc gate. Lane 1 (TL0): the exact TL-20 shape.
 *
 * computeWrap on the 360-char TL20 paragraph into a reused Float32Array(256),
 * measured with lite-gc-profiler and gated at maxMajor:0 / maxPauseMs:4 /
 * maxArrayBuffersGrowth:0. Two independent witnesses run back-to-back (the
 * profiler is one-measurement-at-a-time, so never nested):
 *   - runOpsGate: a 20,000-op window, warmup 1,000, stabilize 'deep'.
 *   - runAllocGate: measureAllocs over 2,000 iterations, maxBytesPerCall 0.
 * plus the structural assertion no heap gate substitutes for: out.buffer's
 * backing store byteLength is identical before and after both windows.
 *
 * TEXTLAYOUT_TORTURE_BREAK=1 injects a retained Float64Array(64) into the hot
 * body: both gates must then reject, and T6 die()s to force the non-zero exit
 * that proves the gate bites. Reaching the end of T6 with BREAK set is itself a
 * die().
 *
 * Lane 2 (countLines) arrives in TL1 and lane 3 (doors on valid input) in TL2;
 * each is registered as a todo below so the obligation is visible now.
 */

import { TextLayout } from '../../TextLayout.js';
import {
    FONT,
    TL20_TEXT,
    BREAK,
    runOpsGate,
    runAllocGate,
    check,
    die,
    todo,
} from './harness.mjs';

const OPS = 20000;
const WARMUP = 1000;
const ITERATIONS = 2000;

/** Retained sink for the BREAK control -- survives GC so arrayBuffers grows. */
const leak = [];

/** Reused output buffer, allocated ONCE. The hot body writes into it in place. */
const out = new Float32Array(256);

export function run() {
    todo('T6-lane2', 'countLines zero-alloc gate -- lands in TL1');
    todo('T6-lane3', 'doors-on-valid-input zero-alloc gate -- lands in TL2');

    const hot = () => {
        TextLayout.computeWrap(TL20_TEXT, FONT, 200, 0, 16, out);
        if (BREAK) leak.push(new Float64Array(64));
    };

    const bufBytes = out.buffer.byteLength;

    const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
    const { report: allocReport, allocs } = runAllocGate(hot, { iterations: ITERATIONS });

    // Structural witness: the reused buffer's backing store must not have grown
    // across either measured window.
    check(out.buffer.byteLength === bufBytes,
        () => 'T6: out buffer backing store grew ' + bufBytes + ' -> ' + out.buffer.byteLength);

    if (BREAK) {
        if (report.ok) {
            die('T6: BREAK set but the ops gate accepted an allocating body -- the gate is blind');
        }
        if (allocReport.verdict !== 'fail') {
            die('T6: BREAK set but the alloc gate did not reject (verdict=' + allocReport.verdict + ')');
        }
        die('T6: BREAK control confirmed -- both gates rejected the injected allocation');
    }

    if (!report.ok) {
        const g = summary.gc;
        die('T6 ops gate rejected -- verdict=' + report.verdict + ' source=' + summary.source +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3));
    }
    if (allocReport.verdict !== 'pass') {
        die('T6 alloc gate rejected -- verdict=' + allocReport.verdict +
            ' bytesPerCall=' + allocs.bytesPerCall + ' settled=' + allocs.settled);
    }
}
