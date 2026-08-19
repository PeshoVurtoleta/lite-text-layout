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
 * Six sections:
 *   1. Width agreement, ASCII-SCOPED (decisions/0004): for every line of a
 *      wrapped corpus, `lineWidth === font.measureLine(text, s, e, scale)` within
 *      one f32 ulp, for scale in {0.5, 1, 2}. NO slice in the measured path (TL5,
 *      bmfont 1.4.0). ASCII-only BY DECISION -- TL-28 is where the two packages
 *      legitimately disagree and it is carved out in section 5.
 *   2. The truncated-line exception (TL-12): on a FLAG_TRUNCATED line the
 *      difference between `lineWidth` and the measured content is EXACTLY
 *      `3 * xadvance('.') * scale` -- asserted as a literal, via measureLine.
 *   3. The TL-25 assertion (decisions/0003, 0006): computeWrap's `lineWidth` is
 *      at the RENDERED scale; bmfont 1.6.0 `drawWrapped` compares it DIRECTLY to
 *      `boxWidth` (F-45, no `* scale`). LIVE assertion: the recorded first-dx
 *      equals `round(ALIGN_BW - lineWidth)` at 0.5, 1 AND 2. T9 control 6 proves
 *      it still rejects the pre-1.6.0 double-scaled formula.
 *   4. Format conformance: stride 4, slot order [startIdx, endIdx, lineWidth,
 *      flags], and `drawWrapped` keys the ellipsis on FLAG_ELLIPSIS bit 0, so
 *      FLAG_OVERFLOW (2) is inert there -- an overflow line draws no ellipsis.
 *   5. The TL-28 probe (decisions/0004): a single non-ASCII case documenting the
 *      kerning-reset seam as DEFINED divergence, NOT a they-agree assertion. The
 *      ONLY remaining slice in this tier -- an oracle slice, pinned to measure's
 *      cross-realm bridging.
 *   6. Pixel identity (TL5): drawWrapped over a one-line RANGE buffer is
 *      byte-identical (recorded dx) to the slicing oracle `draw(text.slice(s,e))`
 *      over the corpus, scale {0.5,1,2} x align {0,1,2}. The render never slices;
 *      only the oracle does.
 *
 * NOT YET, stated rather than silently omitted: a FORMAT_VERSION handshake is
 * bmfont's M9 (v2.0.0); a range-aware public single-line `draw`/`layoutGlyphs`
 * are M6 (planned, not shipped). This tier does not plan against an API that does
 * not exist. bmfont's range render surface is `drawWrapped` (through the buffer),
 * its range width surface is `measureLine`.
 */

import { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW } from '../../TextLayout.js';
import { BitmapFont } from '@zakkster/lite-bmfont';
import { SEED, check, die, makePrng, makeCorpus } from './harness.mjs';
import { BF, DOT_XADVANCE, makeCtx, DX, DX2, DX_CTX, DX_CTX2 } from './bmfixture.mjs';
import { widthClose } from './t5-fuzz.mjs';

const SCALES = [0.5, 1, 2];
const OUT = new Float32Array(4 * 512);

/**
 * The ONE placement predicate, shared by T8 (the live TL-25 assertion) and T9
 * (control 6, the double-scaled-width control). `place(scale)` returns
 * `{actual, correct, draws}` for each scale in SCALES; a scale is a MISS when
 * the recorded placement disagrees with the expected one, OR when nothing was
 * drawn (draws === 0 guards a null firstDx from passing vacuously). The
 * synthetic control feeds a `place` with no `draws` field -- `undefined === 0`
 * is false, so its misses come purely from `actual !== correct`, which is
 * exactly what proves the promoted assertion can still reject.
 *
 * @param {(scale:number)=>{actual:number, correct:number, draws?:number}} place
 * @returns {number} number of scales the placement missed
 */
export function alignMisses(place) {
    let misses = 0;
    for (let si = 0; si < SCALES.length; si++) {
        const r = place(SCALES[si]);
        if (r.actual !== r.correct || r.draws === 0) misses++;
    }
    return misses;
}

/** The wide render box the TL-25 placement is right-aligned within. Shared with
 * T9 control 6, whose synthetic `oldFormula` reuses the same anchor. */
export const ALIGN_BW = 1000;

/**
 * The LIVE TL-25 placement, shared by T8 (the promoted assertion) and T9 (control
 * 6's clean direction). Lays 'AAAA BBBB' out at boxWidth 0 (no wrap), right-aligns
 * it in a wide render box via the ACTUAL peer `drawWrapped`, and returns the
 * recorded first-dx against the correct rendered-scale left edge. With F-45 the
 * two agree at every scale.
 *
 * @param {number} scale
 * @returns {{actual:number, correct:number, draws:number}}
 */
export function tl25(scale) {
    const n = TextLayout.computeWrap('AAAA BBBB', BF, 0, 0, 16, OUT, scale);
    const lineWidth = OUT[2];
    const ctx = makeCtx();
    BF.drawWrapped(ctx, 'AAAA BBBB', OUT, n, ALIGN_BW, 0, 0, 0, scale, /*align=*/2, /*vAlign=*/0);
    return { actual: ctx.firstDx, correct: Math.round(ALIGN_BW - lineWidth), draws: ctx.draws };
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
                const measured = BF.measureLine(text, startIdx, endIdx, scale);
                check(widthClose(lineWidth, measured),
                    () => 'T8 width agreement: case ' + ci + ' line ' + k + ' scale ' + scale +
                        ' lineWidth ' + lineWidth + ' != measureLine(range) ' + measured +
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
            const content = BF.measureLine(TRUNC_TEXT, OUT[k * 4], OUT[k * 4 + 1], scale);
            const allowance = 3 * DOT_XADVANCE * scale;
            check(widthClose(OUT[k * 4 + 2] - content, allowance),
                () => 'T8 truncated-line exception: scale ' + scale + ' line ' + k +
                    ' lineWidth-content ' + (OUT[k * 4 + 2] - content) + ' != 3*xadv(.)*scale ' + allowance);
        }
        check(found,
            () => 'T8 truncated-line exception: scale ' + scale + ' produced no FLAG_TRUNCATED line -- ' +
                'the exception is measuring nothing');
    }

    // -- Section 3: the TL-25 assertion, LIVE (decisions/0003 RESOLVED, 0006) --
    // computeWrap's lineWidth is at the RENDERED scale. bmfont 1.6.0 drawWrapped
    // aligns a right-aligned line with `boxWidth - lineWidth` DIRECTLY -- the F-45
    // fix, no `* scale` (BitmapFont.js:1136-1137). Reading the ACTUAL peer code
    // path (not a reimplementation): lay one line out at boxWidth 0 (no wrap),
    // then right-align it in a wide render box and capture the first glyph's dx.
    // The correct left edge is `ALIGN_BW - lineWidth`, at every scale. `tl25` and
    // `ALIGN_BW` are hoisted to module scope and shared with T9 control 6.
    //
    // Promoted to a LIVE assertion (F-45, peer 1.6.0): drawWrapped now compares
    // `boxWidth - lineWidth` DIRECTLY (BitmapFont.js:1136-1137, no `* scale`), so
    // the recorded first-dx equals `round(ALIGN_BW - lineWidth)` at 0.5, 1 AND 2.
    // The scale-1 precondition folds into the full three-scale check. T9 control 6
    // drives the SAME `alignMisses` with the pre-1.6.0 double-scaled formula and
    // proves this assertion still rejects it.
    check(alignMisses(tl25) === 0,
        () => 'T8 TL-25: drawWrapped placement disagrees with rendered-scale lineWidth over ' +
            SCALES.join('/') + ' -- the peer regressed F-45 (decisions/0003, 0006)');

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

    // -- Section 6: pixel identity, drawWrapped(range) vs draw(slice) (TL5) ----
    // The PURPOSE of reporting [startIdx, endIdx) into the ORIGINAL string: a
    // renderer never has to slice(). Prove the measured render -- drawWrapped over
    // a one-line RANGE buffer -- draws pixel-identical (recorded dx, byte for byte)
    // to the slicing oracle `BF.draw(text.slice(s, e), ...)`, over the seeded
    // corpus, scale {0.5,1,2} x align {0,1,2}. draw() aligns AROUND its x; the
    // wrapped renderer aligns WITHIN boxWidth -- so the oracle's x is offset to
    // the same anchor: x (align 0), x+BOX/2 (align 1), x+BOX (align 2). This is a
    // CORRECTNESS lane (it allocates a per-line buffer), NOT the T6 gate. The
    // one-line buffer is flagged FLAG_NORMAL: a FLAG_TRUNCATED flag would append
    // three ellipsis dots that draw(slice) cannot produce, breaking the identity.
    const PIX_BOX = 1000;
    const PIX_X = 0;
    let pixelLines = 0;
    let pixelDx = 0;
    for (let ci = 0; ci < corpus.length; ci++) {
        const text = corpus[ci].text;
        const n = TextLayout.computeWrap(text, BF, corpus[ci].boxWidth, 0, 16, OUT, 1);
        if (n < 1) continue;
        const s = OUT[0];
        const e = OUT[1];
        for (let si = 0; si < SCALES.length; si++) {
            const scale = SCALES[si];
            const lineWidth = BF.measureLine(text, s, e, scale);
            const buf1 = new Float32Array([s, e, lineWidth, FLAG_NORMAL]);
            const slice = text.slice(s, e);   // the ORACLE may slice; the render does not
            for (let ai = 0; ai < 3; ai++) {
                const align = ai;
                const Xo = align === 0 ? PIX_X : align === 1 ? PIX_X + PIX_BOX / 2 : PIX_X + PIX_BOX;
                DX_CTX.count = 0;
                BF.drawWrapped(DX_CTX, text, buf1, 1, PIX_BOX, 0, PIX_X, 0, scale, align, 0);
                DX_CTX2.count = 0;
                BF.draw(DX_CTX2, slice, Xo, 0, scale, align);
                check(DX_CTX.count === DX_CTX2.count,
                    () => 'T8 pixel identity: draw count mismatch case ' + ci + ' scale ' + scale +
                        ' align ' + align + ' drawWrapped=' + DX_CTX.count + ' draw(slice)=' + DX_CTX2.count);
                for (let d = 0; d < DX_CTX.count; d++) {
                    check(DX[d] === DX2[d],
                        () => 'T8 pixel identity: dx[' + d + '] differs case ' + ci + ' scale ' + scale +
                            ' align ' + align + ' drawWrapped=' + DX[d] + ' draw(slice)=' + DX2[d]);
                }
                pixelDx += DX_CTX.count;
                pixelLines++;
            }
        }
    }
    // Non-vacuity: if not one glyph was ever recorded the identity proved nothing.
    if (pixelDx === 0) {
        die('T8 pixel identity: recorded 0 dx over the whole corpus -- the identity lane is vacuous');
    }

    process.stderr.write('torture: T8 cross-package: widthLines=' + lines +
        ' scales=' + SCALES.join('/') + ' TL-25=live(0.5/1/2) pixelLines=' + pixelLines +
        ' TL-28=scoped(24!=19) (decisions 0003, 0004, 0006)\n');
}
