/**
 * T0 -- metamorphic laws over the shared 512-case corpus (boxHeight = 0).
 *
 * The nine laws (see BRIEF THE HARNESS SPEC / T0):
 *   1. Partition: 0 <= start <= end <= len, starts non-decreasing, every char
 *      skipped between two lines is a space (32) or newline (10).
 *   2. Width agreement against the independent sumWidth, within one f32 ULP.
 *   3. boxWidth 0 gives exactly one line per non-empty paragraph.
 *   4. Line count is monotonic non-increasing in boxWidth for boxWidth >= 24
 *      (the widest scaled glyph, so no single-glyph overflow perturbs it).
 *   5. Purity: two calls into two distinct buffers are byte-identical.
 *   6. No read-back: a POISON-prefilled run equals a clean run over the written
 *      slots, and every slot past lineCount*4 is left untouched.
 *   7. No empty line unless it came from an explicit newline.
 *   8. Scale invariance at boxWidth 0: identical ranges, widths multiplied by
 *      exactly the scale within one f32 ULP.
 *   9. TL-02 todo: the countLines agreement law lands in TL1. Guarded so it
 *      deletes itself the moment countLines exists.
 *
 * sumWidth is the harness's independent width; the oracle is NOT used here.
 */

import { TextLayout } from '../../TextLayout.js';
import { SEED, FONT, POISON, makePrng, makeCorpus, sumWidth, check, todo } from './harness.mjs';

const CASES = 512;
const LH = 16;
const MAXLINES = 1024;
const FROUND_POISON = Math.fround(POISON);

const CORPUS = makeCorpus(makePrng(SEED), CASES);
const OUT = new Float32Array(4 * MAXLINES);
const OUT2 = new Float32Array(4 * MAXLINES);

function f32ulp(x) {
    const f = Math.fround(x);
    const step = Math.fround(f + (Math.abs(f) * 1.1920929e-7) + Number.MIN_VALUE);
    const u = Math.abs(step - f);
    return u > 0 ? u : Number.MIN_VALUE;
}

function widthClose(a, b) {
    return Math.abs(a - b) <= f32ulp(Math.abs(a) > Math.abs(b) ? a : b);
}

function countNewlines(text) {
    let c = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) c++;
    return c;
}

// True when [start, end) is non-empty and every char is a space (code 32).
function lineIsAllSpaces(text, start, end) {
    if (end <= start) return false;
    for (let c = start; c < end; c++) if (text.charCodeAt(c) !== 32) return false;
    return true;
}

// True when index `start` begins a paragraph: the text start, or immediately
// after an explicit newline. A whitespace-only line is legitimate ONLY at a
// paragraph start -- that is TL-14 leading whitespace, which the subject does
// not skip and counts as content. A whitespace-only line that begins MID
// paragraph can only come from a soft break whose space-eater failed to skip the
// leftover spaces, and every mid-paragraph line (soft- or hard-break) must
// otherwise begin on a non-space glyph.
function atParagraphStart(text, start) {
    return start === 0 || text.charCodeAt(start - 1) === 10;
}

// With boxWidth 0 (no wrapping, boxHeight 0) the only breaks are newlines: one
// line per newline plus one, minus a phantom trailing line when text ends in a
// newline; empty text is zero lines.
function expectNoWrapLines(text) {
    const len = text.length;
    if (len === 0) return 0;
    const endsNl = text.charCodeAt(len - 1) === 10;
    return countNewlines(text) + 1 - (endsNl ? 1 : 0);
}

const SWEEP = [24, 32, 48, 96, 192, 384];
const SCALES = [0.5, 2];

export function run() {
    for (let ci = 0; ci < CASES; ci++) {
        const text = CORPUS[ci].text;
        const boxWidth = CORPUS[ci].boxWidth;
        const scale = CORPUS[ci].scale;
        const len = text.length;

        // Main run at the case's own boxWidth/scale -- laws 1, 2, 7 read this.
        const n = TextLayout.computeWrap(text, FONT, boxWidth, 0, LH, OUT, scale);

        let prevEnd = 0;
        for (let k = 0; k < n; k++) {
            const s = OUT[k * 4];
            const e = OUT[k * 4 + 1];

            // Law 1 -- partition.
            check(s >= 0 && s <= e && e <= len,
                () => 'T0 law1 partition: case ' + ci + ' line ' + k + ' [' + s + ',' + e + '] len ' + len);
            if (k > 0) {
                check(s >= prevEnd,
                    () => 'T0 law1 order: case ' + ci + ' line ' + k + ' start ' + s + ' < prev end ' + prevEnd);
                for (let c = prevEnd; c < s; c++) {
                    const cc = text.charCodeAt(c);
                    if (cc !== 32 && cc !== 10) {
                        check(false,
                            () => 'T0 law1 skipped: case ' + ci + ' char ' + c + ' code ' + cc + ' not space/newline');
                    }
                }
            }
            prevEnd = e;

            // Law 2 -- width agreement.
            const w = OUT[k * 4 + 2];
            const expect = sumWidth(text, FONT, s, e, scale);
            check(widthClose(w, expect),
                () => 'T0 law2 width: case ' + ci + ' line ' + k + ' got ' + w + ' expect ' + expect);

            // Law 7 -- an empty line only ever comes from an explicit newline.
            if (s === e) {
                check(s < len && text.charCodeAt(s) === 10,
                    () => 'T0 law7 empty: case ' + ci + ' zero-width line at ' + s + ' not a newline');
            }

            // Law 7b -- an all-space line is legitimate only at a paragraph
            // start (TL-14 leading whitespace). A mid-paragraph all-space line
            // means the soft-break space-eater failed.
            if (lineIsAllSpaces(text, s, e)) {
                check(atParagraphStart(text, s),
                    () => 'T0 law7b spaces: case ' + ci + ' line ' + k + ' [' + s + ',' + e +
                        '] is all spaces mid-paragraph (space-eater failed)');
            }
        }

        // Law 5 -- purity: a second call into a distinct buffer is byte-identical.
        const n2 = TextLayout.computeWrap(text, FONT, boxWidth, 0, LH, OUT2, scale);
        check(n2 === n, () => 'T0 law5 count: case ' + ci + ' ' + n2 + ' != ' + n);
        let pureBad = -1;
        for (let j = 0; j < n * 4; j++) {
            if (OUT[j] !== OUT2[j]) { pureBad = j; break; }
        }
        check(pureBad === -1,
            () => 'T0 law5 purity: case ' + ci + ' slot ' + pureBad + ' ' + OUT[pureBad] + ' != ' + OUT2[pureBad]);

        // Law 6 -- no read-back. Prefill POISON; output must match the clean run
        // over written slots and leave every later slot untouched.
        OUT2.fill(FROUND_POISON);
        const n3 = TextLayout.computeWrap(text, FONT, boxWidth, 0, LH, OUT2, scale);
        check(n3 === n, () => 'T0 law6 count: case ' + ci + ' ' + n3 + ' != ' + n);
        let readBad = -1;
        for (let j = 0; j < n * 4; j++) {
            if (OUT2[j] !== OUT[j]) { readBad = j; break; }
        }
        check(readBad === -1,
            () => 'T0 law6 readback: case ' + ci + ' slot ' + readBad + ' depends on prefill');
        let overBad = -1;
        for (let j = n * 4; j < OUT2.length; j++) {
            if (OUT2[j] !== FROUND_POISON) { overBad = j; break; }
        }
        check(overBad === -1,
            () => 'T0 law6 overwrite: case ' + ci + ' slot ' + overBad + ' past lineCount was written');

        // Law 3 -- boxWidth 0 gives one line per non-empty paragraph.
        const n0 = TextLayout.computeWrap(text, FONT, 0, 0, LH, OUT2, scale);
        check(n0 === expectNoWrapLines(text),
            () => 'T0 law3: case ' + ci + ' boxWidth0 lines ' + n0 + ' expect ' + expectNoWrapLines(text));
        if (len > 0 && text.charCodeAt(len - 1) !== 10) {
            check(n0 === 1 + countNewlines(text),
                () => 'T0 law3b: case ' + ci + ' lines ' + n0 + ' != 1 + newlines');
        }

        // Law 4 -- monotonic line count in boxWidth for boxWidth >= widest glyph.
        let prevLc = Infinity;
        for (let si = 0; si < SWEEP.length; si++) {
            const lc = TextLayout.computeWrap(text, FONT, SWEEP[si], 0, LH, OUT2, scale);
            check(lc <= prevLc,
                () => 'T0 law4 monotonic: case ' + ci + ' boxWidth ' + SWEEP[si] + ' lines ' + lc + ' > ' + prevLc);
            prevLc = lc;
        }

        // Law 8 -- scale invariance at boxWidth 0.
        const nRef = TextLayout.computeWrap(text, FONT, 0, 0, LH, OUT, 1);
        for (let si = 0; si < SCALES.length; si++) {
            const s2 = SCALES[si];
            const ns = TextLayout.computeWrap(text, FONT, 0, 0, LH, OUT2, s2);
            check(ns === nRef, () => 'T0 law8 count: case ' + ci + ' scale ' + s2 + ' ' + ns + ' != ' + nRef);
            for (let k = 0; k < nRef; k++) {
                check(OUT[k * 4] === OUT2[k * 4] && OUT[k * 4 + 1] === OUT2[k * 4 + 1],
                    () => 'T0 law8 range: case ' + ci + ' line ' + k + ' scale ' + s2 + ' range moved');
                const expect = OUT[k * 4 + 2] * s2;
                check(widthClose(OUT2[k * 4 + 2], expect),
                    () => 'T0 law8 width: case ' + ci + ' line ' + k + ' scale ' + s2 +
                        ' got ' + OUT2[k * 4 + 2] + ' expect ' + expect);
            }
        }
    }

    // Law 9 -- the countLines agreement law lands in TL1; this removes itself
    // the moment countLines exists.
    check(typeof TextLayout.countLines === 'undefined',
        () => 'T0 law9: TextLayout.countLines now exists -- promote the TL-02 agreement law');
    todo('TL-02', 'countLines absent -- the agreement law lands in TL1');
}
