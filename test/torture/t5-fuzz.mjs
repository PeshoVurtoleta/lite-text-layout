/**
 * T5 -- differential fuzz against the oracle.
 *
 * 50,000 seeded cases from makeCorpus (boxHeight = 0). Each case is wrapped by
 * the subject (into a reused buffer) and by oracle.mjs (allocates freely), then
 * compared: line ranges must match EXACTLY and every width must agree within one
 * f32 ULP of the oracle's f64 sum.
 *
 * ORACLE-PROTECTION RULE: on divergence the oracle is NEVER edited to agree with
 * the subject. The one finding this fuzz surfaces is TL-26: when whitespace
 * soft-breaks immediately before a '\n' (or end of text), the subject emits a
 * spurious zero-width line -- it violates its own "no phantom trailing line"
 * guarantee once the pre-newline content wraps. Reproduction:
 * computeWrap('    \n', FONT, 46.68, 0, 16, out, 2) -> [[0,3,36],[4,4,0]] where
 * the paragraph model (and 'A\n' -> 1 line) says [[0,3,36]]. A divergence is
 * classified TL-26 iff removing the subject's zero-width lines whose start
 * immediately follows a space makes it match the oracle. Anything else is
 * UNEXPECTED, printed with a one-line replay, and still recorded knownFailing so
 * the run stays honest while it is triaged. TL0 fixes nothing; the oracle is
 * correct and stays put.
 *
 * Case count: 50,000. If this ever blows assertion 18's 120 s wall-clock budget,
 * drop to 20,000 and record the reduced number here and in the CHANGELOG -- never
 * shrink it silently.
 *
 * `linesDiverge` and `widthClose` are exported so T9's control 2 gates against
 * the exact same comparator this tier uses.
 */

import { TextLayout } from '../../TextLayout.js';
import { SEED, FONT, makePrng, makeCorpus, knownFailing, die } from './harness.mjs';
import { oracleWrap } from './oracle.mjs';

const CASES = 50000;
const MAXLINES = 1024;   // corpus text length is bounded well under 1024 lines

/** Reused output buffer, allocated once. */
const OUT = new Float32Array(4 * MAXLINES);

/** One f32 ULP at `x`. */
export function f32ulp(x) {
    const f = Math.fround(x);
    const step = Math.fround(f + (Math.abs(f) * 1.1920929e-7) + Number.MIN_VALUE);
    const u = Math.abs(step - f);
    return u > 0 ? u : Number.MIN_VALUE;
}

/** True when two widths agree within one f32 ULP of the larger magnitude. */
export function widthClose(a, b) {
    return Math.abs(a - b) <= f32ulp(Math.abs(a) > Math.abs(b) ? a : b);
}

/**
 * True when the first `aLen` lines of `a` differ from `b` in count, any range,
 * or any width past one f32 ULP. `a` is array-like of `{start,end,width}` with
 * `aLen` valid entries; `b` is a full array.
 */
export function linesDiverge(a, aLen, b) {
    if (aLen !== b.length) return true;
    for (let i = 0; i < aLen; i++) {
        if (a[i].start !== b[i].start || a[i].end !== b[i].end) return true;
        if (!widthClose(a[i].width, b[i].width)) return true;
    }
    return false;
}

export function run() {
    // Corpus built ONCE, before the loop. Same seed as T0, so T0's 512 cases are
    // the first 512 here.
    const corpus = makeCorpus(makePrng(SEED), CASES);

    let divergences = 0;
    let tl26 = 0;
    let unexpected = 0;

    for (let ci = 0; ci < CASES; ci++) {
        const text = corpus[ci].text;
        const boxWidth = corpus[ci].boxWidth;
        const scale = corpus[ci].scale;

        const n = TextLayout.computeWrap(text, FONT, boxWidth, 0, 16, OUT, scale);
        const ref = oracleWrap(text, FONT, boxWidth, scale);

        let diverged = n !== ref.length;
        if (!diverged) {
            for (let k = 0; k < n; k++) {
                if (OUT[k * 4] !== ref[k].start || OUT[k * 4 + 1] !== ref[k].end ||
                    !widthClose(OUT[k * 4 + 2], ref[k].width)) {
                    diverged = true;
                    break;
                }
            }
        }
        if (!diverged) continue;

        divergences++;

        // Classify: TL-26 iff removing the subject's spurious zero-width lines
        // (a soft break landing on whitespace immediately before a '\n'/end --
        // start follows a space) makes it match the oracle exactly.
        const filtered = [];
        for (let k = 0; k < n; k++) {
            const s = OUT[k * 4];
            const e = OUT[k * 4 + 1];
            if (s === e && s > 0 && text.charCodeAt(s - 1) === 32) continue;
            filtered.push({ start: s, end: e, width: OUT[k * 4 + 2] });
        }

        const rep = 'case ' + ci + ' seed=' + SEED + ' boxWidth=' + boxWidth +
            ' scale=' + scale + ' textLen=' + text.length +
            ' subjectLines=' + n + ' oracleLines=' + ref.length;

        if (!linesDiverge(filtered, filtered.length, ref)) {
            tl26++;
            if (tl26 <= 3) {
                process.stderr.write('torture: T5 divergence (TL-26 phantom empty line) -- ' + rep + '\n');
            }
        } else {
            unexpected++;
            if (unexpected <= 10) {
                process.stderr.write('torture: T5 divergence (UNEXPECTED -- triage) -- ' + rep + '\n');
            }
        }
    }

    process.stderr.write('torture: T5 cases=' + CASES + ' divergences=' + divergences +
        ' (tl26=' + tl26 + ' unexpected=' + unexpected + ')\n');

    // Oracle-protection: register the finding, never bend the oracle. The
    // promotion path must be REACHABLE -- the predicate re-reads the live count
    // so the day TL2 fixes the phantom line and tl26 drops to 0, knownFailing
    // die()s here demanding the win be claimed, instead of the finding silently
    // dropping out of the ledger. This mirrors T1's stillBrokenFn shape.
    knownFailing('TL-26', () => tl26 > 0);

    // `unexpected` is the abnormal counter: 0 today. A nonzero value is a NEW
    // divergence the phantom-line hypothesis does not explain. Fail closed and
    // demand triage -- never silently record an unclassified divergence.
    if (unexpected > 0) {
        die('T5: ' + unexpected + ' unexplained divergence(s) -- triage the stderr replays and ' +
            'classify (extend the filter or add a new finding) before this gate can pass');
    }
}
