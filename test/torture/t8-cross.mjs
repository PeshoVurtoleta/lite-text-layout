/**
 * T8 -- cross-package conformance against @zakkster/lite-bmfont (TL3).
 *
 * lite-bmfont enters as a TEST-ONLY devDependency (never a runtime dependency,
 * either direction). This tier makes the FORMAT contract falsifiable across the
 * package boundary: the layout buffer this package writes and the widths bmfont
 * measures/draws must read the same numbers.
 *
 * It ALLOCATES FREELY (like the T5 oracle) and is never inside a measured
 * window. bmfont's `BitmapFont` is duck-typed as a `font` for `computeWrap`
 * (it has `glyphs`/`kerning`), and every typed array here is built in THIS realm
 * so `outBuffer instanceof Float32Array` holds -- no cross-realm views.
 *
 * Five sections:
 *   1. Width agreement, ASCII-SCOPED (decisions/0004): for every line of a
 *      wrapped corpus, `lineWidth === font.measure(text.slice(s, e), scale)`
 *      within one f32 ulp, for scale in {0.5, 1, 2}. ASCII-only BY DECISION --
 *      TL-28 is where the two packages legitimately disagree and it is carved
 *      out in section 5, not hidden by a corpus that never emits a EURO.
 *   2. The truncated-line exception (TL-12): on a FLAG_TRUNCATED line the
 *      difference between `lineWidth` and the measured content is EXACTLY
 *      `3 * xadvance('.') * scale` -- asserted as a literal.
 *   3. The TL-25 detector (decisions/0003): computeWrap's `lineWidth` is at the
 *      RENDERED scale; bmfont's `drawWrapped` aligns with `lineWidth * scale`,
 *      double-scaling by `scale`. FAILS today at 0.5 and 2, passes at 1, against
 *      the INSTALLED peer -- registered as the one named knownFailing('TL-25').
 *      It closes in the PEER, not here.
 *   4. Format conformance: stride 4, slot order [startIdx, endIdx, lineWidth,
 *      flags], and `drawWrapped` compares `flags === 1` by EQUALITY, so
 *      FLAG_OVERFLOW (2) is inert there -- an overflow line draws no ellipsis.
 *   5. The TL-28 probe (decisions/0004): a single non-ASCII case documenting the
 *      kerning-reset seam as DEFINED divergence, NOT a they-agree assertion.
 *
 * NOT YET, stated rather than silently omitted: a FORMAT_VERSION handshake is
 * bmfont's M9 (v2.0.0); a range-aware public `measure` and `layoutGlyphs` are
 * M5/M6; the 0-bytes-per-frame end-to-end claim is TL5 and is BLOCKED. This tier
 * does not plan against an API that does not exist. bmfont's public width/render
 * surface is `measure` / `drawWrapped` only, and the `.slice()` in section 1 is
 * test-only until bmfont ships the range API (TL5).
 */

import { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW } from '../../TextLayout.js';
import { BitmapFont } from '@zakkster/lite-bmfont';
import { SEED, check, die, knownFailing, makePrng, makeCorpus } from './harness.mjs';
import { widthClose } from './t5-fuzz.mjs';

// A BitmapFont whose glyph ADVANCES match harness.FONT (letters 12, space 6,
// '.' 6) so its `measure` agrees with computeWrap's rendered-scale lineWidth on
// ASCII. Every drawable glyph also carries a 1x1 cell (offsets 2,3), which the
// ellipsis geometry needs (TextLayout.js:330 reads glyphs['.'*7+2] > 0 before it
// counts an ellipsis width) and which makes drawWrapped's drawImage fire so the
// TL-25 placement detector can observe it. Built once, in this realm.
const BF_GLYPHS = new Int16Array(256 * 7);
for (let id = 65; id <= 90; id++) { BF_GLYPHS[id * 7 + 2] = 1; BF_GLYPHS[id * 7 + 3] = 1; BF_GLYPHS[id * 7 + 6] = 12; }
for (let id = 97; id <= 122; id++) { BF_GLYPHS[id * 7 + 2] = 1; BF_GLYPHS[id * 7 + 3] = 1; BF_GLYPHS[id * 7 + 6] = 12; }
BF_GLYPHS[32 * 7 + 6] = 6;                                                 // space, no cell
BF_GLYPHS[46 * 7 + 2] = 1; BF_GLYPHS[46 * 7 + 3] = 1; BF_GLYPHS[46 * 7 + 6] = 6;   // '.'

/** A bmfont instance carrying those tables. `measure`/`drawWrapped` read only
 * glyphs, kerning, atlas, base, lineHeight -- all set here; the atlas is never
 * sampled because drawImage is intercepted by the capturing ctx. */
const BF = Object.create(BitmapFont.prototype);
BF.glyphs = BF_GLYPHS;
BF.kerning = new Int16Array(65536);
BF.atlas = {};
BF.base = 0;
BF.lineHeight = 16;

const DOT_XADVANCE = BF_GLYPHS[46 * 7 + 6];   // 6, at scale 1
const SCALES = [0.5, 1, 2];
const OUT = new Float32Array(4 * 512);

/** A canvas2d stub that records the dx of the FIRST drawImage and counts all
 * draws. drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh): dx is arg index 5. */
function makeCtx() {
    return {
        draws: 0,
        firstDx: null,
        drawImage() {
            if (this.firstDx === null) this.firstDx = arguments[5];
            this.draws++;
        },
    };
}

export function run() {
    // -- Section 1: width agreement, ASCII-scoped (bh=0, non-truncating) ------
    // The corpus is harness.makeCorpus, whose alphabet is ASCII letters, space
    // and CRLF -- every id < 256, so it is ASCII-scoped BY CONSTRUCTION and the
    // TL-28 seam (id >= 256) never appears. The CR is excluded from every emitted
    // range, so no slice ever contains one. A DIFFERENT prng stream than T0/T5 so
    // this corpus is its own 200 cases.
    const corpus = makeCorpus(makePrng(SEED ^ 0x7f4a7c15), 200);
    let lines = 0;
    for (let ci = 0; ci < corpus.length; ci++) {
        const text = corpus[ci].text;
        const boxWidth = corpus[ci].boxWidth;
        for (let si = 0; si < SCALES.length; si++) {
            const scale = SCALES[si];
            const n = TextLayout.computeWrap(text, BF, boxWidth, 0, 16, OUT, scale);
            for (let k = 0; k < n; k++) {
                const startIdx = OUT[k * 4];
                const endIdx = OUT[k * 4 + 1];
                const lineWidth = OUT[k * 4 + 2];
                const flags = OUT[k * 4 + 3];
                if (flags === FLAG_OVERFLOW) {
                    die('T8 width: OUT too small (case ' + ci + ') -- the agreement is vacuous');
                }
                const measured = BF.measure(text.slice(startIdx, endIdx), scale);
                check(widthClose(lineWidth, measured),
                    () => 'T8 width agreement: case ' + ci + ' line ' + k + ' scale ' + scale +
                        ' lineWidth ' + lineWidth + ' != measure(slice) ' + measured +
                        ' slice=[' + startIdx + ',' + endIdx + ']');
                lines++;
            }
        }
    }

    // -- Section 2: the truncated-line exception, a literal (TL-12) ------------
    // On a FLAG_TRUNCATED line, lineWidth - measure(content) === 3*xadvance('.')*
    // scale, EXACTLY (an equality, not an inequality). Per-scale (boxWidth,
    // boxHeight) chosen so the ellipsis cut lands mid-content (a safe cut before
    // the line end), which is the case the allowance describes.
    const TRUNC_TEXT = 'AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH';
    const TRUNC_CASES = [[0.5, 60, 20], [1, 60, 40], [2, 60, 60]];
    for (let t = 0; t < TRUNC_CASES.length; t++) {
        const scale = TRUNC_CASES[t][0];
        const bw = TRUNC_CASES[t][1];
        const bh = TRUNC_CASES[t][2];
        const n = TextLayout.computeWrap(TRUNC_TEXT, BF, bw, bh, 16, OUT, scale);
        let found = false;
        for (let k = 0; k < n; k++) {
            if (OUT[k * 4 + 3] !== FLAG_TRUNCATED) continue;
            found = true;
            const content = BF.measure(TRUNC_TEXT.slice(OUT[k * 4], OUT[k * 4 + 1]), scale);
            const allowance = 3 * DOT_XADVANCE * scale;
            check(widthClose(OUT[k * 4 + 2] - content, allowance),
                () => 'T8 truncated-line exception: scale ' + scale + ' line ' + k +
                    ' lineWidth-content ' + (OUT[k * 4 + 2] - content) + ' != 3*xadv(.)*scale ' + allowance);
        }
        check(found,
            () => 'T8 truncated-line exception: scale ' + scale + ' produced no FLAG_TRUNCATED line -- ' +
                'the exception is measuring nothing');
    }

    // -- Section 3: the TL-25 detector, failing by design (decisions/0003) -----
    // computeWrap's lineWidth is at the RENDERED scale. bmfont's drawWrapped
    // aligns a right-aligned line with `boxWidth - lineWidth * scale`
    // (BitmapFont.js:480), double-scaling by `scale`. Reading the ACTUAL peer
    // code path (not a reimplementation): lay one line out at boxWidth 0 (no
    // wrap), then right-align it in a wide render box and capture the first
    // glyph's dx. Under decision A the correct left edge is `ALIGN_BW -
    // lineWidth`; the peer computes `ALIGN_BW - lineWidth * scale`.
    const ALIGN_BW = 1000;
    const tl25 = (scale) => {
        const n = TextLayout.computeWrap('AAAA BBBB', BF, 0, 0, 16, OUT, scale);
        const lineWidth = OUT[2];
        const ctx = makeCtx();
        BF.drawWrapped(ctx, 'AAAA BBBB', OUT, n, ALIGN_BW, 0, 0, 0, scale, /*align=*/2, /*vAlign=*/0);
        return { actual: ctx.firstDx, correct: Math.round(ALIGN_BW - lineWidth) };
    };
    // Precondition: at scale 1 the two agree (this is what makes the bug invisible
    // to every scale-1 example). If THIS ever fails, decision A's premise moved.
    const at1 = tl25(1);
    check(at1.actual === at1.correct,
        () => 'T8 TL-25 precondition: drawWrapped disagrees with rendered-scale lineWidth at scale 1 ' +
            '(actual ' + at1.actual + ' correct ' + at1.correct + ') -- decision A is in question');
    // The named, counted, NON-EXITING known-failing entry. Still broken == the
    // peer still double-scales at 0.5 AND 2. When the peer drops `* scale`, both
    // become false and knownFailing die()s demanding promotion -- which happens
    // in the peer's commit, not here.
    knownFailing('TL-25', () => {
        const half = tl25(0.5);
        const two = tl25(2);
        return half.actual !== half.correct && two.actual !== two.correct;
    });

    // -- Section 4: format conformance ----------------------------------------
    // Stride 4 and the slot order [startIdx, endIdx, lineWidth, flags] are what
    // drawWrapped reads (BitmapFont.js:467-470, four ptr++ in that order). The
    // executable proof: drawWrapped draws the ellipsis under `if (flags === 1)`
    // (equality, BitmapFont.js:514), so a FLAG_TRUNCATED (1) line gets three
    // extra dot glyphs and a FLAG_OVERFLOW (2) line gets NONE -- the 2 is inert.
    // A hand-built two-line buffer proves both directions in one draw.
    check(FLAG_NORMAL === 0 && FLAG_TRUNCATED === 1 && FLAG_OVERFLOW === 2,
        () => 'T8 format: flag constants moved (' + FLAG_NORMAL + '/' + FLAG_TRUNCATED + '/' + FLAG_OVERFLOW +
            ') -- drawWrapped keys the ellipsis on flags===1');
    // Line 0: 'AAA' FLAG_TRUNCATED -> 3 glyphs + 3 ellipsis dots = 6 draws.
    // Line 1: 'BBB' FLAG_OVERFLOW  -> 3 glyphs + 0 (inert)        = 3 draws.
    const fmtBuf = new Float32Array(8);
    fmtBuf.set([0, 3, 36, FLAG_TRUNCATED, 4, 7, 36, FLAG_OVERFLOW]);
    const fmtCtx = makeCtx();
    BF.drawWrapped(fmtCtx, 'AAA BBB', fmtBuf, 2, 0, 0, 0, 0, 1, 0, 0);
    check(fmtCtx.draws === 9,
        () => 'T8 format: drawWrapped drew ' + fmtCtx.draws + ' glyphs, expected 9 (3+3 ellipsis on the ' +
            'FLAG_TRUNCATED line, 3+0 on the inert FLAG_OVERFLOW line) -- flags===1 equality or stride broke');
    // And the OVERFLOW-only direction: a lone FLAG_OVERFLOW line draws no dots.
    const ovBuf = new Float32Array(4);
    ovBuf.set([0, 3, 36, FLAG_OVERFLOW]);
    const ovCtx = makeCtx();
    BF.drawWrapped(ovCtx, 'AAA', ovBuf, 1, 0, 0, 0, 0, 1, 0, 0);
    check(ovCtx.draws === 3,
        () => 'T8 format: a FLAG_OVERFLOW line drew ' + ovCtx.draws + ' glyphs, expected 3 -- the 2 is not ' +
            'inert, drawWrapped must be branching on truthiness not flags===1');

    // -- Section 5: the TL-28 probe (decisions/0004) --------------------------
    // The kerning-reset seam. computeWrap RESETS the kerning context on any id
    // >= 256; bmfont's measure BRIDGES it. This is DEFINED divergence, scoped out
    // of section 1 on purpose. Font: A/B advance 12, kern(A,B) = -5. Text is
    // 'A' + U+20AC (EURO) + 'B'. NOT a they-agree assertion -- both sides are
    // pinned to their OWN documented number so a change on either side trips.
    const kg = new Int16Array(256 * 7);
    kg[65 * 7 + 6] = 12; kg[66 * 7 + 6] = 12;
    const kk = new Int16Array(65536);
    kk[(65 << 8) | 66] = -5;
    const kfont = Object.create(BitmapFont.prototype);
    kfont.glyphs = kg; kfont.kerning = kk; kfont.atlas = {}; kfont.base = 0; kfont.lineHeight = 16;
    const EURO = '\u20AC';
    const probe = 'A' + EURO + 'B';
    const pn = TextLayout.computeWrap(probe, kfont, 0, 0, 16, OUT, 1);
    check(pn === 1 && OUT[2] === 24,
        () => 'T8 TL-28 probe: computeWrap lineWidth ' + OUT[2] + ' (n=' + pn + '), expected 24 -- ' +
            'the >= 256 kerning-context RESET changed; decisions/0004 is stale');
    check(kfont.measure(probe.slice(OUT[0], OUT[1]), 1) === 19,
        () => 'T8 TL-28 probe: bmfont measure ' + kfont.measure(probe.slice(OUT[0], OUT[1]), 1) +
            ', expected 19 (A+B-5, kern bridges the EURO) -- bmfont changed its non-ASCII policy');

    process.stderr.write('torture: T8 cross-package: widthLines=' + lines +
        ' scales=' + SCALES.join('/') + ' TL-25=known-failing TL-28=scoped(24!=19) (decisions 0003, 0004)\n');
}
