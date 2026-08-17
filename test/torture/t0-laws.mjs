/**
 * T0 -- metamorphic laws over the shared 512-case corpus (boxHeight = 0).
 *
 * The ten laws (see BRIEF THE HARNESS SPEC / T0):
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
 *   9. Agreement (TL-02): over the 512 cases crossed with
 *      BOX_HEIGHTS = [0, 16, 32, 48, 1e9] and LH = 16, countLines equals
 *      computeWrap into an unbounded buffer with no FLAG_OVERFLOW. This runs
 *      through harness.agreeCount -- the SAME comparator T9 control 3 uses, so
 *      neither can drift to a weaker comparison. agreeCount die()s on a vacuous
 *      comparison (a FLAG_OVERFLOW on the computeWrap side).
 *  10. Sizing round trip: computeWrap into an exact-size Float32Array(4*need),
 *      need = countLines(...), returns need and carries no FLAG_OVERFLOW.
 *
 * sumWidth is the harness's independent width; the oracle is NOT used here.
 */

import { TextLayout, FLAG_OVERFLOW } from '../../TextLayout.js';
import { SEED, FONT, POISON, makePrng, makeCorpus, sumWidth, check, agreeCount } from './harness.mjs';

const CASES = 512;
const LH = 16;
const MAXLINES = 1024;
const FROUND_POISON = Math.fround(POISON);

// Box-height sweep for the countLines agreement law (law 9). Includes 0 (no
// truncation) and 1e9 (effectively unbounded) so agreement is proved on
// non-truncating AND truncating input, not just one regime.
// `8` (TL2) is a box UNDER one line at LH 16: it exercises C4's zero-line
// policy, which is the one rule deliberately duplicated in both entry points.
// Without this row the policy would ship untested by the law that exists to
// catch exactly that kind of drift.
const BOX_HEIGHTS = [0, 8, 16, 32, 48, 1e9];

const CORPUS = makeCorpus(makePrng(SEED), CASES);
const OUT = new Float32Array(4 * MAXLINES);
const OUT2 = new Float32Array(4 * MAXLINES);

// The 512 cases crossed with the box-height sweep (2560 comparisons), built once
// at module load. T0 is NOT a measured tier, so this allocation is fine here --
// do not copy this shape into T6. Both law 9 (agreement) and law 10 (round trip)
// run over it.
const AGREE_CORPUS = (() => {
    const out = [];
    for (let ci = 0; ci < CASES; ci++) {
        for (let bi = 0; bi < BOX_HEIGHTS.length; bi++) {
            out.push({
                text: CORPUS[ci].text,
                boxWidth: CORPUS[ci].boxWidth,
                boxHeight: BOX_HEIGHTS[bi],
                lineHeight: LH,
                scale: CORPUS[ci].scale,
            });
        }
    }
    return out;
})();

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

    // Law 9 -- countLines agreement (TL-02). Run the SHARED comparator over the
    // 512 cases crossed with the box-height sweep. Zero mismatches; agreeCount
    // die()s on its own if the computeWrap side ever overflows (a vacuous
    // comparison). This is the one instrument that catches drift between
    // countLines and computeWrap, and T9 control 3 proves it is not vacuous by
    // feeding it a capped stub.
    const mism = agreeCount(TextLayout.countLines, AGREE_CORPUS);
    check(mism === 0,
        () => 'T0 law9 agreement: countLines disagreed with computeWrap on ' + mism + ' of ' +
            AGREE_CORPUS.length + ' crossed cases');

    // Law 11 (TL2) -- the f32 index ceiling, TL-15's policy-C pin as a named
    // law. `startIdx`/`endIdx` are Float32 slots, so indices are exact only to
    // 2^24 = 16777216. These two round trips are the documented boundary, and
    // the day the buffer element type changes they fail and the four
    // documentation surfaces follow.
    check(Math.fround(16777217) === 16777216,
        () => 'T0 law11 TL-15: Math.fround(16777217) is ' + Math.fround(16777217) +
            ', expected 16777216 -- the documented f32 index ceiling moved');
    check(Math.fround(16777219) === 16777220,
        () => 'T0 law11 TL-15: Math.fround(16777219) is ' + Math.fround(16777219) +
            ', expected 16777220 -- the documented f32 index rounding moved');
    // Not an IEEE identity in isolation: tie it to the SUBJECT's slot type, so
    // the law is about this library and not about floating point.
    const ceilBuf = new Float32Array(4);
    ceilBuf[1] = 16777217;
    check(ceilBuf[1] === 16777216,
        () => 'T0 law11 TL-15: an endIdx slot stored 16777217 as ' + ceilBuf[1] +
            ' -- the output buffer is no longer Float32 and the docs are stale');

    // Law 12 (TL2) -- SCALE INVARIANCE, the single assertion that catches
    // TL-03 through TL-06 at once. Scaling the box and the scale together must
    // reproduce the s=1 partition exactly and multiply every width by s
    // exactly. Powers of two ONLY: 0.1 would make this a float-equality
    // lottery, and a flaky gate is worse than no gate.
    const SCALE_INV = [0.5, 2, 4];
    const invRef = new Float32Array(4 * MAXLINES);
    const invGot = new Float32Array(4 * MAXLINES);
    let invViolations = 0;
    for (let ci = 0; ci < CASES; ci++) {
        const text = CORPUS[ci].text;
        const bw = Math.ceil(CORPUS[ci].boxWidth);   // integral, so s*bw is exact
        const bh = 64;
        const nRef = TextLayout.computeWrap(text, FONT, bw, bh, LH, invRef, 1);
        for (let si = 0; si < SCALE_INV.length; si++) {
            const s = SCALE_INV[si];
            const ns = TextLayout.computeWrap(text, FONT, bw * s, bh * s, LH, invGot, s);
            if (ns !== nRef) { invViolations++; continue; }
            for (let k = 0; k < nRef; k++) {
                if (invGot[k * 4] !== invRef[k * 4] || invGot[k * 4 + 1] !== invRef[k * 4 + 1]) {
                    invViolations++;
                    break;
                }
                if (invGot[k * 4 + 2] !== invRef[k * 4 + 2] * s) { invViolations++; break; }
            }
        }
    }
    check(invViolations === 0,
        () => 'T0 law12 scale invariance: ' + invViolations + ' violations across ' + CASES +
            ' cases x ' + SCALE_INV.length + ' scales -- scaling the box and the scale together ' +
            'must reproduce the s=1 partition with widths multiplied by s exactly');

    // Law 10 -- the sizing round trip. A buffer sized from countLines returns
    // exactly that count and never overflows. T0 is NOT a measured tier, so the
    // per-case allocation is allowed here ONLY -- do not copy it into T6.
    for (let i = 0; i < AGREE_CORPUS.length; i++) {
        const c = AGREE_CORPUS[i];
        const need = TextLayout.countLines(c.text, FONT, c.boxWidth, c.boxHeight, c.lineHeight, c.scale);
        const sized = new Float32Array(4 * need);
        const nr = TextLayout.computeWrap(c.text, FONT, c.boxWidth, c.boxHeight, c.lineHeight, sized, c.scale);
        check(nr === need,
            () => 'T0 law10 round trip: case ' + i + ' sized returned ' + nr + ' != ' + need);
        for (let k = 0; k < nr; k++) {
            check(sized[k * 4 + 3] !== FLAG_OVERFLOW,
                () => 'T0 law10 round trip: case ' + i + ' line ' + k + ' carries FLAG_OVERFLOW');
        }
    }
}
