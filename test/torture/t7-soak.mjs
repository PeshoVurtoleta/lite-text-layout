/**
 * T7 -- soak and retention.
 *
 * A pool of 64 strings is built ONCE before the loop, each with its expected
 * line count (from the oracle). 4096 cycles pick pool[i & 63], wrap into one
 * reused Float32Array(256), track then immediately untrack a per-cycle object
 * through lite-leak, and assert the line count matches the pooled expectation.
 * After the last cycle tracker.size() must be 0. heapUsed is sampled only at
 * cycle boundaries, after globalThis.gc(), never inside a cycle; growth across
 * all 4096 cycles must stay under 512 KB.
 *
 * WHICH ASSERTION IS THE SUBJECT GATE: the heap-growth bound is the real
 * TextLayout retention witness -- it proves repeated computeWrap calls into a
 * reused buffer retain nothing. `tracker.size() === 0` exercises lite-leak's own
 * track/untrack bookkeeping, not TextLayout; it is kept as a SECOND, independent
 * witness that the churn objects are released, and must not be mistaken for a
 * subject-level retention check.
 */

import { TextLayout } from '../../TextLayout.js';
import { SEED, FONT, makePrng, check, die } from './harness.mjs';
import { oracleWrap } from './oracle.mjs';
import { createLeakTracker } from '@zakkster/lite-leak';

const CYCLES = 4096;
const POOL = 64;
const BOXW = 120;
const NOOP = () => {};
const WORDS = ['AAA', 'BB', 'CCCC', 'D', 'EEE', 'FF', 'GGGG', 'HH'];

export function run() {
    // Build the pool ONCE, with expected line counts. Allocation here is fine --
    // it is outside the measured churn.
    const prng = makePrng(SEED);
    const texts = new Array(POOL);
    const expected = new Int32Array(POOL);
    for (let p = 0; p < POOL; p++) {
        const wc = 1 + (prng() % 8);
        const parts = [];
        for (let w = 0; w < wc; w++) {
            parts.push(WORDS[prng() % WORDS.length]);
            if (w < wc - 1) parts.push((prng() & 3) === 0 ? '\n' : ' ');
        }
        const t = parts.join('');
        texts[p] = t;
        expected[p] = oracleWrap(t, FONT, BOXW, 1).length;
        check(expected[p] <= 64, () => 'T7: pool string ' + p + ' expects ' + expected[p] + ' lines > 64');
    }

    const out = new Float32Array(256);   // reused, allocated once (64 lines max)
    const tracker = createLeakTracker({ name: 'textlayout-soak' });

    globalThis.gc();
    const baseHeap = process.memoryUsage().heapUsed;
    let maxGrowth = 0;

    for (let i = 0; i < CYCLES; i++) {
        const idx = i & (POOL - 1);
        const nLines = TextLayout.computeWrap(texts[idx], FONT, BOXW, 0, 16, out, 1);
        // Per-cycle churn object. NOOP does not close over it; the tag is a
        // constant primitive -- neither captures the target.
        const obj = { cycle: i };
        const handle = tracker.track(obj, NOOP, 'soak');
        tracker.untrack(handle);
        check(nLines === expected[idx],
            () => 'T7: cycle ' + i + ' text ' + idx + ' lines ' + nLines + ' != ' + expected[idx]);

        if ((i & 511) === 511) {
            globalThis.gc();
            const g = process.memoryUsage().heapUsed - baseHeap;
            if (g > maxGrowth) maxGrowth = g;
        }
    }

    const size = tracker.size();
    if (size !== 0) die('T7: tracker.size() ' + size + ' != 0 after ' + CYCLES + ' cycles');

    globalThis.gc();
    const finalGrowth = process.memoryUsage().heapUsed - baseHeap;
    if (finalGrowth > maxGrowth) maxGrowth = finalGrowth;
    const heapGrowthKB = Math.round(maxGrowth / 1024);

    process.stderr.write('torture: T7 cycles=' + CYCLES + ' trackerSize=' + size +
        ' heapGrowthKB=' + heapGrowthKB + '\n');
    check(maxGrowth < 512 * 1024,
        () => 'T7: heap grew ' + heapGrowthKB + ' KB across ' + CYCLES + ' cycles (>= 512 KB)');
}
