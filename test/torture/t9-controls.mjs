/**
 * T9 -- controls. Every gate must be provably able to fail.
 *
 * This tier runs deliberately-broken variants IN PROCESS and asserts the
 * matching detector flags each one. A gate that cannot fail is decorative.
 *
 * Shipping now (TL0):
 *   - Control 1: an allocating hot body MUST be rejected by runOpsGate.
 *   - Control 2: a corrupted copy of the oracle's output (drop the last line,
 *     add 1 to one width) MUST be flagged divergent by the range/width
 *     comparator. The oracle module is never edited -- only a COPY is corrupted.
 *   - Control 5: the freeze detector. TextLayout is NOT frozen today (TL-11,
 *     knownFailing until TL1 freezes it), and the detector itself is proven by
 *     freezing a throwaway object and asserting a strict-mode write throws.
 *
 * Deferred, registered as todo with their session:
 *   - Control 3: countLines stub -- TL1.
 *   - Control 4: overflow without FLAG_OVERFLOW -- TL1.
 *   - Control 6: double-scaled width -- TL3.
 *
 * The whole-suite control is Control 7: TEXTLAYOUT_TORTURE_BREAK=1, which trips
 * the T6 alloc gate and exits non-zero.
 */

import { TextLayout } from '../../TextLayout.js';
import { FONT, runOpsGate, check, die, knownFailing, todo } from './harness.mjs';
import { oracleWrap } from './oracle.mjs';
import { linesDiverge } from './t5-fuzz.mjs';

/** Retained sink so the control's allocations survive GC (arrayBuffers grows). */
const leak = [];

export function run() {
    // Control 1 -- the alloc gate. A hot body that retains an allocation every
    // iteration MUST be rejected by runOpsGate (maxArrayBuffersGrowth:0).
    const { report } = runOpsGate(() => { leak.push(new Float64Array(64)); }, {
        ops: 4000,
        warmup: 0,
    });
    if (report.ok) {
        die('T9 control 1: an allocating hot loop passed the zero-alloc gate');
    }
    leak.length = 0; // release the control's garbage

    // Control 2 -- the oracle comparator. Corrupt a COPY of the oracle's output
    // and assert the comparator flags it. boxWidth 40 seats each 36-wide word on
    // its own line, so the reference has four lines to perturb.
    const ref = oracleWrap('AAA BBB CCC DDD', FONT, 40, 1);
    if (!(ref.length >= 2)) {
        die('T9 control 2: the oracle produced ' + ref.length + ' lines -- need >= 2 to corrupt');
    }
    // Drop the last line AND add 1 to one width, on a COPY. `linesDiverge` is
    // the exact comparator T5 fuzzes with.
    const corrupted = ref.map((l) => ({ start: l.start, end: l.end, width: l.width }));
    corrupted.pop();
    corrupted[0].width += 1;
    if (!linesDiverge(ref, ref.length, corrupted)) {
        die('T9 control 2: comparator did not flag a corrupted oracle (dropped line + width+1)');
    }
    // And prove the comparator is width-sensitive on its own, not just by count.
    const widthOnly = ref.map((l) => ({ start: l.start, end: l.end, width: l.width }));
    widthOnly[0].width += 1;
    if (!linesDiverge(ref, ref.length, widthOnly)) {
        die('T9 control 2: comparator blind to a 1px width divergence at equal line count');
    }

    // Control 5 -- the freeze detector. TextLayout is not frozen today; that is
    // TL-11, still-failing until TL1 freezes the namespace.
    knownFailing('TL-11', () => Object.isFrozen(TextLayout) === false);
    // Prove the detector works: a write to a frozen object throws in strict mode
    // (this module is an ESM module, so strict is already in force).
    const throwaway = Object.freeze({ x: 1 });
    let threw = false;
    try { throwaway.x = 2; } catch (err) { threw = true; }
    check(threw,
        () => 'T9 control 5: assignment to a frozen object did not throw -- the freeze detector is blind');

    // Controls deferred to their session.
    todo('control-3', 'countLines stub -- lands in TL1');
    todo('control-4', 'overflow without FLAG_OVERFLOW -- lands in TL1');
    todo('control-6', 'double-scaled width -- lands in TL3');
}
