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
 * TEXTLAYOUT_TORTURE_BREAK=<lane> injects a retained Float64Array(64) into the
 * SELECTED lane's hot body: both that lane's gates must then reject, and it die()s
 * to force the non-zero exit that proves the gate bites. `=1` targets lane 1,
 * `=4` targets the TL5 pipeline lane. Lane 1 die()s at the end of its BREAK block,
 * so lane 4 needs its own selector to be reachable at all.
 *
 * Lane 2 (countLines, TL1): the same zero-alloc discipline over
 * TextLayout.countLines, measured strictly AFTER lane 1 (never nested). A SINK
 * accumulator defeats dead-code elimination -- V8 may drop a call whose result is
 * discarded, and a dropped call passes as zero-alloc for the wrong reason. Lane 3
 * (doors on valid input, TL2) drives the full input-door comparison chain.
 *
 * Lane 4 (the allocation-free PIPELINE, TL5): computeWrap lays a full wrapped
 * paragraph into the reused buffer, then bmfont's drawWrapped (>= 1.6.0) renders
 * it through that buffer into a singleton non-allocating recorder -- 0 bytes/frame
 * end to end, across the package boundary, under the SAME unrelaxed RULES.
 */

import { TextLayout } from '../../TextLayout.js';
import {
    FONT,
    TL20_TEXT,
    BREAK_LANE,
    runOpsGate,
    runAllocGate,
    check,
    die,
} from './harness.mjs';
import { BF, REC_MIN } from './bmfixture.mjs';

const OPS = 20000;
const WARMUP = 1000;
const ITERATIONS = 2000;

/** Retained sink for the BREAK control -- survives GC so arrayBuffers grows. */
const leak = [];

/** Reused output buffer, allocated ONCE. The hot body writes into it in place. */
const out = new Float32Array(256);

/** Lane 2 sink -- a number store, not an allocation. Defeats DCE of countLines. */
let SINK = 0;

export function run() {
    const hot = () => {
        TextLayout.computeWrap(TL20_TEXT, FONT, 200, 0, 16, out);
        if (BREAK_LANE === 1) leak.push(new Float64Array(64));
    };

    const bufBytes = out.buffer.byteLength;

    const { report, summary } = runOpsGate(hot, { ops: OPS, warmup: WARMUP });
    const { report: allocReport, allocs } = runAllocGate(hot, { iterations: ITERATIONS });

    // Structural witness: the reused buffer's backing store must not have grown
    // across either measured window.
    check(out.buffer.byteLength === bufBytes,
        () => 'T6: out buffer backing store grew ' + bufBytes + ' -> ' + out.buffer.byteLength);

    if (BREAK_LANE === 1) {
        if (report.ok) {
            die('T6 lane1: BREAK=1 set but the ops gate accepted an allocating body -- the gate is blind');
        }
        if (allocReport.verdict !== 'fail') {
            die('T6 lane1: BREAK=1 set but the alloc gate did not reject (verdict=' + allocReport.verdict + ')');
        }
        die('T6 lane1: BREAK=1 control confirmed -- both gates rejected the injected allocation');
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

    // -- Lane 2 (TL1): countLines, same zero-alloc discipline. Strictly AFTER
    // lane 1 -- the profiler measures one window at a time, never nested. countLines
    // takes no buffer, so there is nothing to reuse; the gate proves the linear
    // pass allocates nothing on its own. SINK accumulates the return value so a
    // dead-code-eliminated call cannot pass as a zero-alloc call.
    const hot2 = () => {
        SINK += TextLayout.countLines(TL20_TEXT, FONT, 200, 0, 16);
        if (BREAK_LANE === 1) leak.push(new Float64Array(64));
    };

    const { report: r2, summary: s2 } = runOpsGate(hot2, { ops: OPS, warmup: WARMUP });
    const { report: a2, allocs: allocs2 } = runAllocGate(hot2, { iterations: ITERATIONS });

    check(SINK > 0, () => 'T6 lane2: SINK is 0 -- the countLines call was optimised away');

    if (!r2.ok) {
        const g = s2.gc;
        die('T6 lane2 ops gate rejected -- verdict=' + r2.verdict + ' source=' + s2.source +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3));
    }
    if (a2.verdict !== 'pass') {
        die('T6 lane2 alloc gate rejected -- verdict=' + a2.verdict +
            ' bytesPerCall=' + allocs2.bytesPerCall + ' settled=' + allocs2.settled);
    }

    // -- Lane 3 (TL2): the DOORS on valid input. The input door added in 1.2.0
    // runs eight comparisons and two `.length` reads before the loop, on every
    // single call. Lanes 1 and 2 barely exercise it: boxHeight 0 short-circuits
    // the conditional lineHeight rule and the default scale skips the seventh
    // argument entirely. Lane 3 drives the FULL comparison chain -- an explicit
    // scale, a truncating boxHeight, and the seventh argument supplied -- so a
    // door that allocates (a template literal built eagerly, a shared options
    // object, an array of check names) is caught here and nowhere else.
    //
    // Strictly AFTER lanes 1 and 2, never nested: the profiler measures one
    // window at a time. NO LANE MAY CALL A THROWING PATH -- error construction
    // allocates by design, and measuring it would gate a cost the contract
    // deliberately accepts. Every argument below is VALID.
    const hot3 = () => {
        SINK += TextLayout.computeWrap(TL20_TEXT, FONT, 200, 64, 16, out, 2);
        if (BREAK_LANE === 1) leak.push(new Float64Array(64));
    };

    const bufBytes3 = out.buffer.byteLength;
    const { report: r3, summary: s3 } = runOpsGate(hot3, { ops: OPS, warmup: WARMUP });
    const { report: a3, allocs: allocs3 } = runAllocGate(hot3, { iterations: ITERATIONS });

    check(SINK > 0, () => 'T6 lane3: SINK is 0 -- the doors-on-valid-input call was optimised away');
    check(out.buffer.byteLength === bufBytes3,
        () => 'T6 lane3: out buffer backing store grew ' + bufBytes3 + ' -> ' + out.buffer.byteLength);

    if (!r3.ok) {
        const g = s3.gc;
        die('T6 lane3 ops gate rejected -- verdict=' + r3.verdict + ' source=' + s3.source +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3));
    }
    if (a3.verdict !== 'pass') {
        die('T6 lane3 alloc gate rejected -- verdict=' + a3.verdict +
            ' bytesPerCall=' + allocs3.bytesPerCall + ' settled=' + allocs3.settled);
    }

    // -- Lane 4 (TL5): the ALLOCATION-FREE PIPELINE, end to end. The whole point
    // of reporting [startIdx, endIdx) into the ORIGINAL string is that a renderer
    // never has to slice(): computeWrap lays a full wrapped paragraph into the
    // reused Float32Array, then bmfont's drawWrapped (>= 1.6.0) renders it through
    // that buffer -- no per-frame allocation on EITHER side. REC_MIN is a
    // singleton non-allocating recorder (drawImage only bumps `draws`, named
    // params so V8 never materialises an `arguments` object), so the ctx is not a
    // source of garbage and the gate measures the PEER's hot path as much as this
    // one. Strictly AFTER lanes 1-3, never nested. RULES are NOT relaxed: the
    // peer's drawWrapped must survive zero scavenges (maxMinor:0). If it cannot,
    // the finding belongs to the peer and is filed there -- do not widen the gate.
    const hot4 = () => {
        const n = TextLayout.computeWrap(TL20_TEXT, BF, 200, 0, 16, out, 1);
        BF.drawWrapped(REC_MIN, TL20_TEXT, out, n, 200, 0, 0, 0, 1, 2, 0);
        SINK += REC_MIN.draws;
        if (BREAK_LANE === 4) leak.push(new Float64Array(64));
    };

    const bufBytes4 = out.buffer.byteLength;
    const { report: r4, summary: s4 } = runOpsGate(hot4, { ops: OPS, warmup: WARMUP });
    const { report: a4, allocs: allocs4 } = runAllocGate(hot4, { iterations: ITERATIONS });

    // Structural witness: the reused layout buffer's backing store did not grow.
    check(out.buffer.byteLength === bufBytes4,
        () => 'T6 lane4: out buffer backing store grew ' + bufBytes4 + ' -> ' + out.buffer.byteLength);
    // Non-vacuity: drawWrapped must actually have drawn glyphs through REC_MIN, or
    // a no-op peer would pass the gate for the wrong reason.
    check(SINK > 0, () => 'T6 lane4: SINK is 0 -- drawWrapped drew nothing or the pipeline was optimised away');

    if (BREAK_LANE === 4) {
        if (r4.ok) {
            die('T6 lane4: BREAK=4 set but the ops gate accepted an allocating body -- the gate is blind');
        }
        if (a4.verdict !== 'fail') {
            die('T6 lane4: BREAK=4 set but the alloc gate did not reject (verdict=' + a4.verdict + ')');
        }
        die('T6 lane4: BREAK=4 control confirmed -- both gates rejected the injected allocation');
    }

    if (!r4.ok) {
        const g = s4.gc;
        die('T6 lane4 ops gate rejected -- verdict=' + r4.verdict + ' source=' + s4.source +
            ' major=' + g.major + ' minor=' + g.minor + ' maxMs=' + g.maxMs.toFixed(3) +
            ' -- if drawWrapped (>= 1.6.0) allocates under maxMinor:0 this is a PEER finding, not a gate to widen');
    }
    if (a4.verdict !== 'pass') {
        die('T6 lane4 alloc gate rejected -- verdict=' + a4.verdict +
            ' bytesPerCall=' + allocs4.bytesPerCall + ' settled=' + allocs4.settled +
            ' -- a non-zero drawWrapped bytes/call is a PEER finding, not a gate to widen');
    }
}
