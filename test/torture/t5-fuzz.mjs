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
 *
 * TL2 adds the FLAGS TRIPWIRE: `flagslots=<n> badvalue=<n> bothflags=<n>` on the
 * T5 stderr line. It walks the flags slots of the capped run through the shared
 * `harness.scanFlags`, which T9 control 8 gates in both directions.
 */

import { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW } from '../../TextLayout.js';
import { SEED, FONT, makePrng, makeCorpus, check, die, scanFlags, crlfInRange } from './harness.mjs';
import { oracleWrap } from './oracle.mjs';

const CASES = 50000;
const MAXLINES = 1024;   // corpus text length is bounded well under 1024 lines

/** Reused output buffer, allocated once. */
const OUT = new Float32Array(4 * MAXLINES);

// --- D1 fixtures: countLines agreement, prefix law, FLAG_OVERFLOW iff --------
// All allocated ONCE. The oracle is NOT involved and its domain stays
// boxHeight 0; these draw a per-case box height instead.
const BOX_HEIGHTS = [0, 16, 32, 48, 1e9];
/** Unbounded buffer for the agreement + prefix comparison, allocated once. */
const OUT_BIG = new Float32Array(4 * MAXLINES);
// Eight fixed-capacity buffers indexed by clamp(m, 8). OUT_BIG.subarray would
// allocate a view object per case -- exactly the churn T6 exists to forbid --
// so the capacities are pre-built here and reused. Index 0 is unused (m >= 1).
const CAPBUFS = [];
for (let c = 0; c <= 8; c++) CAPBUFS[c] = new Float32Array(4 * c);

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
    // A SEPARATE prng for the per-case box height and capacity draws, so the
    // corpus stream (and therefore the divergence count) is undisturbed.
    const prng2 = makePrng(SEED ^ 0x5bd1e995);

    let divergences = 0;
    let tl26 = 0;
    let unexpected = 0;

    // --- the flags tripwire (TL2) ----------------------------------------
    // TL1's QA verified BY HAND that no output ever carries a flags value
    // outside the value space, and that FLAG_TRUNCATED and FLAG_OVERFLOW never
    // appear in one output. Both claims were left uninstrumented. They are
    // instrumented HERE, before TL2 changes any behaviour, so the numbers are
    // a pre-change baseline and not the new code agreeing with itself.
    //
    // The scanned region is the CAPPED run (`buf`), the only one of the three
    // computeWrap calls per case that can carry FLAG_OVERFLOW at all -- the
    // oracle run has boxHeight 0 and the OUT_BIG run is unbounded by
    // construction (and die()s above if it ever overflows). Scanning a region
    // that cannot produce either violation would be a vacuous tripwire.
    //
    // Three module-local counters and no per-case allocation: scanFlags returns
    // a packed integer, no array, no subarray, no closure.
    let flagslots = 0;
    let badvalue = 0;
    let bothflags = 0;

    // --- the CRLF invariant, over the TRUNCATING arm (TL3) ---------------
    // The oracle differential above (OUT vs ref) covers only boxHeight === 0 --
    // oracleWrap has no boxHeight parameter and models wrapping, never
    // truncation (see oracle.mjs). That is precisely the arm TL2's blocker did
    // NOT live in; the blocker put a CR INSIDE the emitted range on the
    // TRUNCATING path, and no differential could have seen it because the oracle
    // does not reach that path. So the truncating arm's CRLF coverage is this
    // standalone INVARIANT instead: a CR is never inside an emitted range. It is
    // swept over the bh>0 OUT_BIG run below (the same run whose boxHeight is
    // drawn per case) through the SAME crlfInRange detector T9 control 13 gates,
    // and asserted 0. With ~40% of cases carrying CRLF (harness.makeCorpus) and
    // BOX_HEIGHTS mixing 0 with truncating heights, this exercises CRLF against
    // the truncating range emit on tens of thousands of cases.
    let crInRange = 0;

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

        // --- D1: agreement + prefix law + FLAG_OVERFLOW iff, per case --------
        // Independent of the oracle comparison above (it reads OUT and ref; this
        // reads OUT_BIG and CAPBUFS and touches neither). Draw a box height so
        // truncating input is exercised too.
        const bh = BOX_HEIGHTS[prng2() % 5];
        const need = TextLayout.computeWrap(text, FONT, boxWidth, bh, 16, OUT_BIG, scale);
        for (let k = 0; k < need; k++) {
            if (OUT_BIG[k * 4 + 3] === FLAG_OVERFLOW) {
                die('T5 agreement: OUT_BIG too small (case ' + ci + ' bh ' + bh + ') -- comparison vacuous');
            }
        }
        // The CRLF invariant over the truncating-arm run: no CR inside a range.
        crInRange += crlfInRange(text, OUT_BIG, need);

        const cl = TextLayout.countLines(text, FONT, boxWidth, bh, 16, scale);
        if (cl !== need) {
            die('T5 agreement: countLines ' + cl + ' != computeWrap ' + need +
                ' (case ' + ci + ' seed=' + SEED + ' bh ' + bh + ' boxWidth ' + boxWidth + ' scale ' + scale + ')');
        }
        // Prefix law + overflow iff. Capacity = clamp(m, 8) lines.
        const m = 1 + (prng2() % (need + 1));
        const cap = m < 8 ? m : 8;
        const buf = CAPBUFS[cap];
        const got = TextLayout.computeWrap(text, FONT, boxWidth, bh, 16, buf, scale);
        const expectN = need < cap ? need : cap;
        if (got !== expectN) {
            die('T5 prefix: computeWrap into cap ' + cap + ' returned ' + got + ' != ' + expectN + ' (case ' + ci + ')');
        }
        const overflowed = need > cap;   // countLines > floor(buf.length / 4)
        for (let j = 0; j < expectN * 4; j++) {
            if (overflowed && j === (expectN - 1) * 4 + 3) {
                if (buf[j] !== FLAG_OVERFLOW) {
                    die('T5 iff: overflow slot ' + j + ' not FLAG_OVERFLOW (case ' + ci + ' cap ' + cap + ' need ' + need + ')');
                }
            } else if (buf[j] !== OUT_BIG[j]) {
                die('T5 prefix: slot ' + j + ' ' + buf[j] + ' != unbounded ' + OUT_BIG[j] +
                    ' (case ' + ci + ' cap ' + cap + ' need ' + need + ')');
            }
        }
        if (expectN > 0) {
            const flagged = buf[(expectN - 1) * 4 + 3] === FLAG_OVERFLOW;
            if (flagged !== overflowed) {
                die('T5 iff: FLAG_OVERFLOW ' + flagged + ' != (need>cap) ' + overflowed +
                    ' (case ' + ci + ' cap ' + cap + ' need ' + need + ')');
            }
        }

        // --- the flags tripwire, over the capped run's written region -------
        const viol = scanFlags(buf, expectN);
        flagslots += expectN;
        badvalue += viol >> 1;
        bothflags += viol & 1;

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
        ' (tl26=' + tl26 + ' unexpected=' + unexpected + ')' +
        ' flagslots=' + flagslots + ' badvalue=' + badvalue + ' bothflags=' + bothflags +
        ' crInRange=' + crInRange + '\n');

    // The CRLF invariant on the truncating arm. A single CR inside an emitted
    // range is TL2's blocker resurfacing -- fail closed. Deleting the subject's
    // truncating-arm CR exclusion (TextLayout.js:407) drives this above 0, which
    // is exactly what T9 control 13 reproduces two-directionally.
    if (crInRange > 0) {
        die('T5 CRLF: ' + crInRange + ' emitted range(s) across the truncating-arm run contain a ' +
            'CR immediately before an LF -- the CR must be excluded from the range (TL-13)');
    }

    // Fail closed on either violation class. The flags are a VALUE SPACE
    // (decisions/0001-flag-overflow.md): compare by equality, never by
    // truthiness, and never widen the space silently.
    if (badvalue > 0) {
        die('T5 flags: ' + badvalue + ' of ' + flagslots + ' flags slots hold a value outside {' +
            FLAG_NORMAL + ', ' + FLAG_TRUNCATED + ', ' + FLAG_OVERFLOW + '}');
    }
    if (bothflags > 0) {
        die('T5 flags: ' + bothflags + ' output(s) carry both FLAG_TRUNCATED (' + FLAG_TRUNCATED +
            ') and FLAG_OVERFLOW (' + FLAG_OVERFLOW + ') -- the two are mutually exclusive in one call');
    }

    // TL-26 PROMOTED (TL2). The oracle was never bent: it is byte-identical to
    // the file that surfaced the finding, and the subject now agrees with it on
    // all 50,000 cases. The classifier keeps its `tl26=` counter so the stderr
    // line stays comparable with every earlier session's number, and so a
    // REGRESSION lands in the tl26 bucket rather than in `unexpected`.
    //
    // TL3: the corpus now emits CRLF (~40% of cases carry a CR before an LF),
    // and oracle.mjs models the CR as the zero-advance glyph it is (participates
    // in wrapping, trimmed from the range at the terminator). So the differential
    // below EXERCISES CRLF on the non-truncating arm and stays 0. The truncating
    // arm is covered by the crInRange invariant asserted above, not here (the
    // oracle has no boxHeight). Deleting oracle.mjs's CR handling drives this > 0.
    check(divergences === 0,
        () => 'T5: ' + divergences + ' divergence(s) from the oracle (tl26=' + tl26 +
            ' unexpected=' + unexpected + ') -- TL-26 was promoted in TL2, so any phantom line ' +
            'here is a regression');

    // `unexpected` is the abnormal counter: 0 today. A nonzero value is a NEW
    // divergence the phantom-line hypothesis does not explain. Fail closed and
    // demand triage -- never silently record an unclassified divergence.
    if (unexpected > 0) {
        die('T5: ' + unexpected + ' unexplained divergence(s) -- triage the stderr replays and ' +
            'classify (extend the filter or add a new finding) before this gate can pass');
    }
}
