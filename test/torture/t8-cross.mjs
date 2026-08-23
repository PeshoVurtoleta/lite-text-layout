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
 *      bmfont 1.4.0). ASCII-only BY DECISION -- the non-ASCII kerning seam (section 5) is where the two packages
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
 *   5. The kerning-seam probe (decisions/0004): a single non-ASCII case documenting the
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
import { BF, BF_1X, DOT_XADVANCE, makeCtx, DX, DX2, DX_CTX, DX_CTX2 } from './bmfixture.mjs';
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
    // non-ASCII kerning seam (id >= 256) never appears. The CR is excluded from every emitted
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

    // -- Section 1b: the 1.x regression witness (TL-28 / A3) ------------------
    // BF is a REAL 2.x font (store 192, decoded * 0.0625 -> 12px). BF_1X is the
    // SAME logical font in 1.x whole-pixel form (store 12, and NO advanceOf
    // accessor). computeWrap must read BF through advScale 0.0625 and BF_1X
    // through advScale 1 and land on the SAME 12px, so every line range and every
    // width slot is BYTE-IDENTICAL across the two fonts. 192 * (scale * 0.0625)
    // and 12 * (scale * 1) are the same IEEE double per glyph (0.0625 is exact,
    // 192/16 == 12), so the equality is exact, not approximate. This is the
    // assertion that proves the decode is a FIX, not a second breakage pointed the
    // other way: forcing advScale = 0.0625 unconditionally makes BF_1X read
    // 0.75px and this equality reddens (T9 owns that mutation control).
    const OUT_1X = new Float32Array(OUT.length);
    for (let ci = 0; ci < corpus.length; ci++) {
        const text = corpus[ci].text;
        const boxWidth = corpus[ci].boxWidth;
        for (let si = 0; si < SCALES.length; si++) {
            const scale = SCALES[si];
            const n2 = TextLayout.computeWrap(text, BF, boxWidth, 0, 16, OUT, scale);
            const n1 = TextLayout.computeWrap(text, BF_1X, boxWidth, 0, 16, OUT_1X, scale);
            check(n1 === n2,
                () => 'T8 A3 1.x/2.x line count: case ' + ci + ' scale ' + scale +
                    ' 1.x=' + n1 + ' 2.x=' + n2 + ' -- the TL-28 decode changed wrapping vs a whole-pixel font');
            for (let k = 0; k < n2 * 4; k++) {
                check(OUT_1X[k] === OUT[k],
                    () => 'T8 A3 1.x/2.x slot ' + k + ' differs: case ' + ci + ' scale ' + scale +
                        ' 1.x=' + OUT_1X[k] + ' 2.x=' + OUT[k] +
                        ' -- a 1.x font is NOT byte-identical after the TL-28 decode');
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
    // drawWrapped reads (four ptr++ in that order). The ellipsis fires on bit 0
    // (FLAG_ELLIPSIS === FLAG_TRUNCATED === 1) via `f & FLAG_ELLIPSIS` after a
    // flags-mask door (BitmapFont.js:1354-1366, F-49), NOT the old `flags === 1`.
    check(FLAG_NORMAL === 0 && FLAG_TRUNCATED === 1 && FLAG_OVERFLOW === 2,
        () => 'T8 format: flag constants moved (' + FLAG_NORMAL + '/' + FLAG_TRUNCATED + '/' + FLAG_OVERFLOW +
            ') -- drawWrapped keys the ellipsis on bit 0 (FLAG_ELLIPSIS)');

    // FLAG_TRUNCATED (bit 0, inside the mask) draws the ellipsis: 'AAA' -> 3
    // glyphs + 3 dots = 6. BF's '.' carries a 1x1 cell so the dots fire.
    const truncBuf = new Float32Array([0, 3, 36, FLAG_TRUNCATED]);
    const truncCtx = makeCtx();
    BF.drawWrapped(truncCtx, 'AAA', truncBuf, 1, 0, 0, 0, 0, 1, 0, 0);
    check(truncCtx.draws === 6,
        () => 'T8 format: FLAG_TRUNCATED line drew ' + truncCtx.draws + ' glyphs, expected 6 (3+3 ellipsis) ' +
            '-- the bit-0 ellipsis path or the stride broke');

    // FLAG_OVERFLOW (bit 1) against bmfont >= 2.0.0 -- a TWO-PART contract, and
    // NOT the 1.x "silently inert" story decisions/0001 was written against.
    // bmfont 2.0 (F-49) added a flags-mask door: a bit outside FLAG_MASK (1) is a
    // caller error. See TL6's sub-finding note in decisions/0001-flag-overflow.md.
    const ovBuf = new Float32Array([0, 3, 36, FLAG_OVERFLOW]);
    //   (a) DEFAULT (checked) font: drawWrapped THROWS on FLAG_OVERFLOW. This is
    //       fail-closed and it AGREES with this package -- an overflow flag means
    //       the caller under-sized the buffer (size it with countLines), and a
    //       checked peer refuses to render a layout it was told is incomplete.
    let ovThrew = false;
    try {
        BF.drawWrapped(makeCtx(), 'AAA', ovBuf, 1, 0, 0, 0, 0, 1, 0, 0);
    } catch (e) {
        ovThrew = !!e && (e.name === 'BitmapFontError' || /flags/.test(e.message));
    }
    check(ovThrew,
        () => 'T8 format: a checked bmfont 2.x drawWrapped did NOT throw on FLAG_OVERFLOW -- the F-49 ' +
            'flags-mask door (BitmapFont.js:1363) is the fail-closed half of the overflow contract');
    //   (b) A checked:false font keeps the 1.x additive semantics: FLAG_OVERFLOW
    //       is IGNORED -- no ellipsis, 3 draws. So the FLAG_OVERFLOW === 2 choice
    //       stays additive wherever the caller opts out of the door.
    const lenient = new BitmapFont({}, {
        common: { lineHeight: 16, base: 0 },
        chars: [{ id: 65, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 }],
    }, { checked: false });
    const ovCtx = makeCtx();
    lenient.drawWrapped(ovCtx, 'AAA', ovBuf, 1, 0, 0, 0, 0, 1, 0, 0);
    check(ovCtx.draws === 3,
        () => 'T8 format: a checked:false FLAG_OVERFLOW line drew ' + ovCtx.draws + ' glyphs, expected 3 ' +
            '(inert) -- the additive-value path under an opted-out door broke');

    // -- Section 5: the non-ASCII kerning-seam probe (decisions/0004) ----------
    // NOTE on the name: this seam was labelled "TL-28" in TL3 (decisions/0004,
    // shipped 1.2.1). The ROADMAP later assigned TL-28 to a DIFFERENT finding --
    // the bmfont 1/16 fixed-point decode (decisions/0005, closed in TL6). To end
    // the collision this probe is named for the seam it tests, not a TL number.
    //
    // The seam: computeWrap RESETS the kerning context on any id >= 256; bmfont's
    // measure BRIDGES it. DEFINED divergence, scoped out of section 1 on purpose.
    // Font: A/B advance 12, kern(A,B) = -5, text 'A' + U+20AC (EURO) + 'B'. NOT a
    // they-agree assertion -- both sides are pinned to their OWN documented number
    // so a change on either side trips.
    //
    // Built through the REAL 2.x constructor (the decode, decisions/0005) so the
    // store is fixed-point (12 -> 192, -5 -> -80) and both packages decode at full
    // magnitude. A hand-poked whole-pixel table on BitmapFont.prototype would
    // decode 16x too small and the 24/19 pins below -- calibrated in whole pixels
    // -- would silently measure nothing.
    const kfont = new BitmapFont({}, {
        common: { lineHeight: 16, base: 0 },
        chars: [
            { id: 65, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 },
            { id: 66, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 },
        ],
        kernings: [{ first: 65, second: 66, amount: -5 }],
    });
    const EURO = '\u20AC';
    const probe = 'A' + EURO + 'B';
    const pn = TextLayout.computeWrap(probe, kfont, 0, 0, 16, OUT, 1);
    check(pn === 1 && OUT[2] === 24,
        () => 'T8 kerning-seam probe: computeWrap lineWidth ' + OUT[2] + ' (n=' + pn + '), expected 24 -- ' +
            'the >= 256 kerning-context RESET changed; decisions/0004 is stale');
    check(kfont.measure(probe.slice(OUT[0], OUT[1]), 1) === 19,
        () => 'T8 kerning-seam probe: bmfont measure ' + kfont.measure(probe.slice(OUT[0], OUT[1]), 1) +
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

    // -- Section 7: TL-28 decode-site coverage (A1/A4/A5 falsifiable) ----------
    // The TL-28 fold touches NINE store reads. Section 1 drives the plain advance
    // (:443); the kerning reads (:442/:661), the CR-path reads (:377/:380) and the
    // countLines twins (:662/:697) need cases section 1 (unkerned, CR-advance 0,
    // computeWrap-only) never exercises. Each assertion below reddens when its
    // site is left un-decoded -- proven by the sandbox mutation matrix in TL6.
    let decodeChecks = 0;

    // (A1, kerned) A real ASCII kerning pair drives the kerning decode :442 AND
    // the advance decode :443. 'ABAB' = 4*12 + 3*(-5) = 33 at scale 1.
    const kern2x = new BitmapFont({}, {
        common: { lineHeight: 16, base: 0 },
        chars: [
            { id: 65, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 },
            { id: 66, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 },
        ],
        kernings: [{ first: 65, second: 66, amount: -5 }, { first: 66, second: 65, amount: -5 }],
    });
    for (let si = 0; si < SCALES.length; si++) {
        const scale = SCALES[si];
        const kn = TextLayout.computeWrap('ABAB', kern2x, 0, 0, 16, OUT, scale);
        const km = kern2x.measureLine('ABAB', 0, 4, scale);
        check(kn === 1 && widthClose(OUT[2], km),
            () => 'T8 A1 kerned: computeWrap lineWidth ' + OUT[2] + ' != measureLine ' + km +
                ' at scale ' + scale + ' -- the kerning decode (:442) or advance decode (:443) is un-folded');
        decodeChecks++;
    }

    // (A5) countLines and computeWrap are SEPARATE passes (:662/:661/:697 vs
    // :443/:442/:515) and must agree against a 2.x font at full magnitude, or a
    // decode applied to one pass only sails through section 1 while silently
    // mis-sizing every buffer countLines is asked to measure. Over the section-1
    // corpus (drives :662/:697) and the kerned font under a wrap (drives :661).
    for (let ci = 0; ci < corpus.length; ci++) {
        const text = corpus[ci].text;
        const boxWidth = corpus[ci].boxWidth;
        for (let si = 0; si < SCALES.length; si++) {
            const scale = SCALES[si];
            const nc = TextLayout.computeWrap(text, BF, boxWidth, 0, 16, OUT, scale);
            const cl = TextLayout.countLines(text, BF, boxWidth, 0, 16, scale);
            check(cl === nc,
                () => 'T8 A5 countLines/computeWrap: case ' + ci + ' scale ' + scale +
                    ' countLines=' + cl + ' computeWrap=' + nc +
                    ' -- the two passes decode the 2.x store differently');
            decodeChecks++;
        }
    }
    // The kerned countLines twin (:661): a boxWidth that forces 'ABAB' to wrap.
    const cwK = TextLayout.computeWrap('ABAB', kern2x, 30, 0, 16, OUT, 1);
    const clK = TextLayout.countLines('ABAB', kern2x, 30, 0, 16, 1);
    check(clK === cwK,
        () => 'T8 A5 kerned countLines: countLines=' + clK + ' computeWrap=' + cwK +
            ' -- the countLines kerning decode (:661) diverged from computeWrap');
    decodeChecks++;

    // (A4) The CR-path decode (:377/:380) only bites when the CR (id 13) carries a
    // NON-ZERO advance -- a hand-rolled atlas, out of contract but the exact shape
    // the CR-subtraction exists for. With id 13 advance 5, 'AAA\r\nBBB' excludes
    // the CR, so line 0 must equal the same text with a bare '\n'. If :377/:380
    // read raw, the subtracted crAdv is 16x and the CRLF width stops matching LF.
    // kern(A, CR) = -3 is what makes the CR-KERNING read (:380) falsifiable: with
    // it zero the crAdv kerning term is 0 and a mutation there cannot redden. The
    // CR is still fully excluded (its advance AND its kerning leave both cursorX
    // and the subtracted crAdv), so line 0 still equals the bare-LF width.
    const cr2x = new BitmapFont({}, {
        common: { lineHeight: 16, base: 0 },
        chars: [
            { id: 65, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 },
            { id: 66, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 },
            { id: 13, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 5 },
        ],
        kernings: [{ first: 65, second: 13, amount: -3 }],
    });
    for (let si = 0; si < SCALES.length; si++) {
        const scale = SCALES[si];
        const nCrlf = TextLayout.computeWrap('AAA\r\nBBB', cr2x, 0, 0, 16, OUT, scale);
        const wCrlf = OUT[2];
        const nLf = TextLayout.computeWrap('AAA\nBBB', cr2x, 0, 0, 16, OUT, scale);
        const wLf = OUT[2];
        check(nCrlf === nLf && widthClose(wCrlf, wLf),
            () => 'T8 A4 CRLF: line0 width CRLF ' + wCrlf + ' != LF ' + wLf + ' at scale ' + scale +
                ' -- the CR-path decode (:377/:380) is un-folded, so the excluded CR advance is 16x');
        decodeChecks++;
    }

    process.stderr.write('torture: T8 cross-package: widthLines=' + lines +
        ' scales=' + SCALES.join('/') + ' TL-25=live(0.5/1/2) pixelLines=' + pixelLines +
        ' TL-28-decode=covered(' + decodeChecks + ' checks) seam=scoped(24!=19)' +
        ' (decisions 0001, 0003, 0004, 0005, 0006)\n');
}
