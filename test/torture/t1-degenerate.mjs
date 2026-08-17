/**
 * T1 -- degenerate values, one named row per value, pinning TODAY's answer.
 *
 * Pinning "this returns NaN" is a valid contract for exactly as long as it is
 * deliberate; leaving it unpinned is not. Correct/documented rows are plain
 * checks; every finding-linked row is a knownFailing citing its ID, so the day a
 * later session fixes it the entry stops reproducing and demands promotion.
 *
 * All answers were reproduced against the working tree with the harness FONT
 * stub (letters xadvance 12, space 6, '.' 6; '.' has no width, so ellipsisWidth
 * is 0).
 */

import { TextLayout, TextLayoutError, FLAG_NORMAL, FLAG_TRUNCATED } from '../../TextLayout.js';
import {
    FONT, POISON, check, knownFailing, doorMisses, countPhantoms, crlfInRange,
} from './harness.mjs';

const OUT = new Float32Array(4 * 256);
const T4 = 'AAA BBB CCC DDD';   // 4 words -> [0,15,162] at infinite width
const T5T = 'A\nB\nC\nD\nE';    // 5 explicit lines
const T2W = 'AAA BBB';          // 2 words -> 2 lines at boxWidth 40

function n(text, font, bw, bh, lh, scale) {
    return TextLayout.computeWrap(text, font, bw, bh, lh, OUT, scale);
}

/**
 * True when `fn` throws a `TextLayoutError` whose message contains every
 * substring in `needs` AND is not a raw property-read TypeError message.
 * The `needs` list is what stops a row passing on a message about a DIFFERENT
 * argument -- the AR-02 failure shape this whole tier is exposed to.
 */
function throwsDoor(fn, ...needs) {
    let msg = null;
    try { fn(); } catch (e) {
        if (!(e instanceof TextLayoutError)) return false;
        msg = e.message;
    }
    if (msg === null) return false;
    if (msg.indexOf('Cannot read properties') !== -1) return false;
    for (const s of needs) if (msg.indexOf(s) === -1) return false;
    return true;
}

// A font whose '.' has a real width, so the ellipsis allowance is nonzero (the
// harness FONT only populates '.' xadvance, leaving ellipsisWidth 0). Needed by
// the TL-12 truncated-width pin.
function makeDotFont() {
    const glyphs = new Int16Array(256 * 7);
    for (let i = 65; i <= 90; i++) glyphs[i * 7 + 6] = 12;
    glyphs[32 * 7 + 6] = 6;
    glyphs[46 * 7 + 2] = 4;   // '.' width > 0 so the ellipsis is measured
    glyphs[46 * 7 + 6] = 6;   // '.' xadvance
    return { glyphs, kerning: new Int16Array(65536) };
}

export function run() {
    // === THE INPUT DOOR (TL2) ===============================================
    // The whole matrix, through the SHARED detector, against BOTH entry points.
    // doorMisses proves its two known-good base tuples are ACCEPTED before it
    // tests a single rejection, so no row can pass because the tuple was wrong
    // in a second place (AR-02). T9 controls 9 and 10 feed the same detector
    // doorless stubs and require it to report -- that is what makes this
    // zero non-vacuous.
    check(doorMisses((t, f, bw, bh, lh, s) => TextLayout.computeWrap(t, f, bw, bh, lh, OUT, s),
        'computeWrap') === 0,
        () => 'T1 door: computeWrap failed ' +
            doorMisses((t, f, bw, bh, lh, s) => TextLayout.computeWrap(t, f, bw, bh, lh, OUT, s),
                'computeWrap') + ' door rows');
    check(doorMisses(TextLayout.countLines, 'countLines') === 0,
        () => 'T1 door: countLines failed ' + doorMisses(TextLayout.countLines, 'countLines') +
            ' door rows -- the door is not shared');

    // --- boxWidth (TL-05 PROMOTED: negative and non-finite now throw) --------
    // Negative half first: the accepted values, unchanged.
    check(n(T4, FONT, 0, 0, 16, 1) === 1, () => 'T1 boxWidth 0 -> 1 line (documented infinite)');
    check(n(T4, FONT, -0, 0, 16, 1) === 1, () => 'T1 boxWidth -0 aliases 0 (neither > 0 nor < 0)');
    check(n(T4, FONT, 3.4e38, 0, 16, 1) === 1, () => 'T1 boxWidth 3.4e38 -> 1 line');
    check(n(T4, FONT, 1e-7, 0, 16, 1) === 12, () => 'T1 boxWidth 1e-7 -> one glyph per line');
    // TL-05, all four rows promoted, message-exact.
    check(throwsDoor(() => n(T4, FONT, -1, 0, 16, 1), 'boxWidth', 'negative'),
        () => 'T1 TL-05 (boxWidth=-1): no TextLayoutError naming boxWidth and negative');
    check(throwsDoor(() => n(T4, FONT, -100, 0, 16, 1), 'boxWidth', 'negative'),
        () => 'T1 TL-05 (boxWidth=-100): no TextLayoutError naming boxWidth and negative');
    check(throwsDoor(() => n(T4, FONT, NaN, 0, 16, 1), 'boxWidth', 'finite'),
        () => 'T1 TL-05 (boxWidth=NaN): no TextLayoutError naming boxWidth and finite');
    check(throwsDoor(() => n(T4, FONT, -Infinity, 0, 16, 1), 'boxWidth', 'finite'),
        () => 'T1 TL-05 (boxWidth=-Infinity): no TextLayoutError naming boxWidth and finite');
    // +Infinity is non-finite too, and rejected for the same reason. It read as
    // "no limit" only by accident of every guard being `boxWidth > 0`.
    check(throwsDoor(() => n(T4, FONT, Infinity, 0, 16, 1), 'boxWidth', 'finite'),
        () => 'T1 TL-05 (boxWidth=Infinity): no TextLayoutError naming boxWidth and finite');

    // --- boxHeight (the vertical axis of the same door) ----------------------
    check(n(T5T, FONT, 0, 0, 16, 1) === 5, () => 'T1 boxHeight 0 -> 5 lines (infinite)');
    check(n(T5T, FONT, 0, -0, 16, 1) === 5, () => 'T1 boxHeight -0 aliases 0');
    check(n(T5T, FONT, 0, 3.4e38, 16, 1) === 5, () => 'T1 boxHeight 3.4e38 -> no truncation');
    check(throwsDoor(() => n(T5T, FONT, 0, -1, 16, 1), 'boxHeight', 'negative'),
        () => 'T1 boxHeight -1: no TextLayoutError naming boxHeight and negative');
    check(throwsDoor(() => n(T5T, FONT, 0, -100, 16, 1), 'boxHeight', 'negative'),
        () => 'T1 boxHeight -100: no TextLayoutError naming boxHeight and negative');
    check(throwsDoor(() => n(T5T, FONT, 0, NaN, 16, 1), 'boxHeight', 'finite'),
        () => 'T1 boxHeight NaN: no TextLayoutError naming boxHeight and finite');
    check(throwsDoor(() => n(T5T, FONT, 0, Infinity, 16, 1), 'boxHeight', 'finite'),
        () => 'T1 boxHeight Infinity: no TextLayoutError naming boxHeight and finite');
    check(throwsDoor(() => n(T5T, FONT, 0, -Infinity, 16, 1), 'boxHeight', 'finite'),
        () => 'T1 boxHeight -Infinity: no TextLayoutError naming boxHeight and finite');

    // --- TL-07 PROMOTED: a box that cannot hold one line holds NO lines ------
    // Policy B (decisions/0002-input-door.md): return 0, write nothing. Both
    // entry points, and the buffer must come back bit-identical.
    OUT.fill(POISON);
    check(n('AAA', FONT, 0, 8, 16, 1) === 0,
        () => 'T1 TL-07 (boxHeight=8): expected 0 lines in a box under one line');
    check(OUT[0] === Math.fround(POISON) && OUT[1] === Math.fround(POISON) &&
        OUT[2] === Math.fround(POISON) && OUT[3] === Math.fround(POISON),
        () => 'T1 TL-07 (boxHeight=8): the zero-line path wrote into the buffer');
    check(n('AAA', FONT, 0, 1, 16, 1) === 0,
        () => 'T1 TL-07 (boxHeight=1): expected 0 lines in a box under one line');
    check(OUT[3] === Math.fround(POISON),
        () => 'T1 TL-07 (boxHeight=1): the zero-line path wrote into the buffer');
    // The sub-epsilon regime, CONVERTED not dropped. In 1.1.0 this pin read
    // "boxHeight 1e-7 -> truncates to 1"; under policy B it is 0 like every
    // other box that cannot hold a line. It is its own regime -- a positive
    // boxHeight far below one pixel, where `(lineCount + 2) * lineHeight *
    // scale > boxHeight` is true on the first comparison -- so it keeps its own
    // row rather than being folded into boxHeight 1.
    check(n(T5T, FONT, 0, 1e-7, 16, 1) === 0,
        () => 'T1 TL-07 (boxHeight=1e-7): a sub-epsilon box holds no lines (1.1.0 gave 1)');
    check(OUT[3] === Math.fround(POISON),
        () => 'T1 TL-07 (boxHeight=1e-7): the zero-line path wrote into the buffer');
    check(TextLayout.countLines(T5T, FONT, 0, 1e-7, 16, 1) === 0,
        () => 'T1 TL-07 (boxHeight=1e-7): countLines disagrees on the sub-epsilon box');
    // Smallest positive double, to prove the rule is `> 0`, not `>= epsilon`.
    check(n('AAA', FONT, 0, Number.MIN_VALUE, 16, 1) === 0,
        () => 'T1 TL-07 (boxHeight=MIN_VALUE): a denormal box still holds no lines');
    check(TextLayout.countLines('AAA', FONT, 0, 8, 16, 1) === 0,
        () => 'T1 TL-07: countLines disagrees with computeWrap on the zero-line policy');
    check(TextLayout.countLines('AAA', FONT, 0, 1, 16, 1) === 0,
        () => 'T1 TL-07: countLines disagrees with computeWrap on the zero-line policy');
    // The boundary is `>`, not `>=`: a box EXACTLY one line tall still lays out.
    check(n('AAA', FONT, 0, 16, 16, 1) === 1,
        () => 'T1 TL-07 boundary: boxHeight 16 with lineHeight 16 must still emit its one line');
    check(n('AAA', FONT, 0, 32, 16, 2) === 1,
        () => 'T1 TL-07 boundary: scale 2 with boxHeight 32 must still emit its one line');
    check(n('AAA', FONT, 0, 31, 16, 2) === 0,
        () => 'T1 TL-07: lineHeight * scale is what the box is measured against, not lineHeight');
    OUT.fill(0);

    // --- lineHeight (TL-06 PROMOTED, and the door is CONDITIONAL) ------------
    // The row that proves the lineHeight door is not blanket: with no vertical
    // box the value is never read, so 0 is legal and lays out normally.
    check(n('AAA', FONT, 0, 0, 0, 1) === 1,
        () => 'T1 TL-06: lineHeight 0 with boxHeight 0 must NOT throw -- the value is unused');
    check(n('AAA', FONT, 0, 0, -16, 1) === 1,
        () => 'T1 TL-06: lineHeight -16 with boxHeight 0 must NOT throw -- the value is unused');
    check(throwsDoor(() => n('AAA', FONT, 0, 32, 0, 1), 'lineHeight', '> 0'),
        () => 'T1 TL-06 (lineHeight=0): no TextLayoutError naming lineHeight and > 0');
    check(throwsDoor(() => n(T5T, FONT, 40, 20, 0, 1), 'lineHeight', '> 0'),
        () => 'T1 TL-06 (lineHeight=0 bh=20): no TextLayoutError naming lineHeight and > 0');
    check(throwsDoor(() => n(T5T, FONT, 40, 20, -16, 1), 'lineHeight', '> 0'),
        () => 'T1 TL-06 (lineHeight=-16): no TextLayoutError naming lineHeight and > 0');
    // NaN throws in BOTH regimes -- a NaN line height is never meaningful.
    check(throwsDoor(() => n(T5T, FONT, 40, 20, NaN, 1), 'lineHeight', 'finite'),
        () => 'T1 TL-06 (lineHeight=NaN bh=20): no TextLayoutError naming lineHeight and finite');
    check(throwsDoor(() => n(T5T, FONT, 40, 0, NaN, 1), 'lineHeight', 'finite'),
        () => 'T1 TL-06 (lineHeight=NaN bh=0): NaN must throw even where lineHeight is unused');
    check(throwsDoor(() => n(T5T, FONT, 40, 20, Infinity, 1), 'lineHeight', 'finite'),
        () => 'T1 lineHeight Infinity: no TextLayoutError naming lineHeight and finite');

    // --- scale (TL-03 and TL-04 PROMOTED) ------------------------------------
    check(n(T2W, FONT, 40, 0, 16, 1) === 2, () => 'T1 scale 1 -> 2 lines');
    check(n(T2W, FONT, 40, 0, 16, 2) === 6, () => 'T1 scale 2 -> 6 lines');
    check(n(T2W, FONT, 40, 0, 16, 0.5) === 1, () => 'T1 scale 0.5 -> 1 line');
    check(n(T2W, FONT, 40, 0, 16, 1e-30) === 1, () => 'T1 scale 1e-30 -> 1 line (finite and > 0)');
    check(throwsDoor(() => n(T2W, FONT, 40, 0, 16, 0), 'scale', '> 0'),
        () => 'T1 TL-04 (scale=0): no TextLayoutError naming scale and > 0');
    check(throwsDoor(() => n(T2W, FONT, 40, 0, 16, -1), 'scale', '> 0'),
        () => 'T1 TL-04 (scale=-1): no TextLayoutError naming scale and > 0');
    check(throwsDoor(() => n(T2W, FONT, 40, 0, 16, NaN), 'scale', 'finite'),
        () => 'T1 TL-03 (scale=NaN): no TextLayoutError naming scale and finite');
    check(throwsDoor(() => n(T2W, FONT, 40, 0, 16, Infinity), 'scale', 'finite'),
        () => 'T1 TL-03 (scale=Infinity): no TextLayoutError naming scale and finite');

    // --- text (TL-13 CR in range, TL-14 leading whitespace kept) -------------
    check(n('', FONT, 40, 0, 16, 1) === 0, () => 'T1 empty text -> 0');
    check(n('\n', FONT, 40, 0, 16, 1) === 1, () => 'T1 single newline -> 1 empty line');
    check(n('\n\n\n', FONT, 40, 0, 16, 1) === 3, () => 'T1 three newlines -> 3 lines');
    check(n('A\n', FONT, 40, 0, 16, 1) === 1, () => 'T1 trailing newline -> no phantom line');
    check(n('A'.repeat(10000), FONT, 0, 0, 16, 1) === 1, () => 'T1 10k no-space at boxWidth0 -> 1 line');
    check(n(String.fromCharCode(255, 256, 65535), FONT, 0, 0, 16, 1) === 1,
        () => 'T1 ids 255/256/65535 -> 1 line, no LUT overrun');
    check(n('\uD800', FONT, 0, 0, 16, 1) === 1, () => 'T1 lone surrogate -> 1 line');
    let all = '';
    for (let i = 0; i < 256; i++) all += String.fromCharCode(i);
    check(n(all, FONT, 0, 0, 16, 1) === 2, () => 'T1 all code points 0..255 -> 2 lines (LF at 10 splits)');
    // --- TL-14 PROMOTED, and the behaviour is DELIBERATE ---------------------
    // Leading whitespace is preserved at the start of the text and after an
    // explicit newline; it is eaten ONLY after a soft break. The code is right
    // and the docstring was too broad -- see decisions/0002-input-door.md, which
    // writes out the counter-argument. Do NOT "fix" these in a later session.
    check((() => { const c = n(' ', FONT, 0, 0, 16, 1); return c === 1 && OUT[0] === 0 && OUT[1] === 1; })(),
        () => 'T1 TL-14 DELIBERATE (single space): a lone space is one line [0,1), not nothing');
    check((() => { const c = n('   ', FONT, 0, 0, 16, 1); return c === 1 && OUT[1] === 3 && OUT[2] === 18; })(),
        () => 'T1 TL-14 DELIBERATE (three spaces): one line [0,3) of width 18 (3 x space 6)');
    check((() => { const c = n('   AAA', FONT, 0, 0, 16, 1); return c === 1 && OUT[0] === 0 && OUT[1] === 6 && OUT[2] === 54; })(),
        () => 'T1 TL-14 DELIBERATE (leading spaces): indentation is content -- [0,6) width 54');
    // The other half of the rule, so the pin says what is DELIBERATE and what is
    // not: after a SOFT BREAK the leading run IS eaten.
    check((() => { const c = n('AAA   BBB', FONT, 40, 0, 16, 1); return c === 2 && OUT[4] === 6 && OUT[5] === 9; })(),
        () => 'T1 TL-14: after a soft break the leading space run must still be eaten');

    // --- TL-13 PROMOTED: a CR before an LF is a terminator, not content ------
    // The width pins below are meaningless unless the atlas says what we think
    // it says, so assert the advances FIRST (brief P9): 'A' 12, space 6, CR 0.
    check(FONT.glyphs[65 * 7 + 6] === 12 && FONT.glyphs[32 * 7 + 6] === 6 &&
        FONT.glyphs[13 * 7 + 6] === 0 && FONT.kerning[(65 << 8) | 13] === 0,
        () => 'T1 TL-13: the atlas advances moved -- every width literal below is measuring the ' +
            'font, not the rule');
    // The LF-only control comes first and must NOT move.
    check((() => { const c = n('AAA\nBBB', FONT, 0, 0, 16, 1);
        return c === 2 && OUT[0] === 0 && OUT[1] === 3 && OUT[2] === 36 &&
            OUT[4] === 4 && OUT[5] === 7 && OUT[6] === 36; })(),
        () => 'T1 TL-13 control: the LF-only layout must be unchanged [0,3,36] [4,7,36]');
    check((() => { const c = n('AAA\r\nBBB', FONT, 0, 0, 16, 1);
        return c === 2 && OUT[0] === 0 && OUT[1] === 3 && OUT[2] === 36 &&
            OUT[4] === 5 && OUT[5] === 8 && OUT[6] === 36; })(),
        () => 'T1 TL-13 (AAA-CRLF-BBB): endIdx must be 3, excluding the CR -- the range and the ' +
            'width must agree');
    check(crlfInRange('AAA\r\nBBB', OUT, 2) === 0,
        () => 'T1 TL-13: an emitted range still contains a CR that is followed by an LF');
    check((() => { const c = n('\r\n', FONT, 0, 0, 16, 1);
        return c === 1 && OUT[0] === 0 && OUT[1] === 0 && OUT[2] === 0; })(),
        () => 'T1 TL-13 (CRLF): a bare CRLF is one empty line [0,0), not [0,1)');
    // CRLF lays out IDENTICALLY to LF once the CR is excluded -- same count,
    // same widths; only the start indices shift by the extra character.
    //
    // SWEPT ACROSS boxHeight, and pinned to the LF run BY CONSTRUCTION rather
    // than to hand-copied literals. The newline branch has TWO emitting arms --
    // the normal one and the TRUNCATION one, which has its own `safe` and
    // `false` sub-arms -- and boxHeight 0 only ever reaches the normal arm. A
    // CR exclusion applied to one arm and not the other passed a detector that
    // was only ever aimed at boxHeight 0. It is not aimed at one path any more.
    //
    // The second atlas gives CR a NON-ZERO advance and '.' a real width. The
    // shared stub has glyphs[13*7+6] === 0, so with it alone the WIDTH half of
    // "the range and lineWidth agree" is unfalsifiable: a CR advance wrongly
    // left in the width would add exactly 0.
    const crAtlas = new Int16Array(256 * 7);
    for (let c = 65; c <= 90; c++) crAtlas[c * 7 + 6] = 12;
    crAtlas[32 * 7 + 6] = 6;
    crAtlas[46 * 7 + 2] = 4;    // '.' has width, so ellipsisWidth is 18, not 0
    crAtlas[46 * 7 + 6] = 6;
    crAtlas[13 * 7 + 6] = 9;    // CR advance 9 -- leaks into every width if kept
    const crKern = new Int16Array(65536);
    // A real kerning pair ENDING at the CR. Without it the CR's kerning term is
    // always 0 and the kerning half of the width subtraction is unfalsifiable:
    // deleting it from the source passes. With it, the CR after 'C' advances
    // 9 + 3 = 12, and only a subtraction that mirrors the loop's own kerning
    // rule takes all 12 back out.
    crKern[(67 << 8) | 13] = 3;
    const CR_FONT = { glyphs: crAtlas, kerning: crKern };
    check(CR_FONT.glyphs[13 * 7 + 6] === 9 && CR_FONT.kerning[(67 << 8) | 13] === 3,
        () => 'T1 TL-13: the CR-advance atlas is misbuilt -- the width half proves nothing');

    const LF_OUT = new Float32Array(4 * 64);
    const CR_OUT = new Float32Array(4 * 64);
    const CR_SWEEP = [0, 16, 32, 48, 64, 1e9];
    // Config 2 is not decoration. With `boxWidth === 0` EVERY position is a safe
    // ellipsis position, so on a truncating line `lastSafeEllipsisIdx` becomes
    // the CR itself -- the only way to reach the `safe` arm's width
    // subtraction. Configs 0 and 1 both keep the CR out of that slot (config 0
    // has ellipsisWidth 0, config 1's box is too narrow), so without this row
    // the subtraction is unfalsifiable and reverting it passes the gate.
    // The boxWidth sweep BRACKETS the safe-ellipsis boundary at the CR. The cut
    // index and the width are clamped with `<=`, not `<`, and the two differ on
    // exactly one input class: the character before the CR is the last safe
    // position while the CR itself is not, so `lastSafeEllipsisIdx + 1` lands
    // exactly ON lineEnd and its width must NOT have the CR advance taken out
    // (it never had one in). For 'CCCC' at content 48 with a CR advance of 9
    // and an 18px ellipsis, that boundary sits at boxWidth 66: 36 + 12 + 18 ==
    // 66 fits, 48 + 9 + 18 == 75 does not. Sweeping 54..78 covers it from both
    // sides instead of trusting the arithmetic.
    const CR_CFG = [
        { f: FONT, bw: 0, lf: 'AAA\nBBB', cr: 'AAA\r\nBBB' },
        { f: CR_FONT, bw: 0, lf: 'AAAA BBBB CCCC\nDDDD', cr: 'AAAA BBBB CCCC\r\nDDDD' },
    ];
    // 60 = content 48 + CR advance 9 + CR kerning 3. AT OR ABOVE it the CR fits on the line it
    // terminates and the LF-identity claim holds; BELOW it the CR is a
    // width-bearing glyph that hard-breaks onto its own line before the newline
    // branch is ever reached, and no line-count identity is possible -- see the
    // out-of-contract pin below, which records exactly that. Sweeping 60..96
    // brackets the `<=` boundary at 66 from both sides.
    for (const bwv of [60, 66, 72, 78, 96]) {
        CR_CFG.push({ f: CR_FONT, bw: bwv, lf: 'AAAA BBBB CCCC\nDDDD', cr: 'AAAA BBBB CCCC\r\nDDDD' });
    }
    for (let fi = 0; fi < CR_CFG.length; fi++) {
        const f = CR_CFG[fi].f;
        const bw = CR_CFG[fi].bw;
        const lfText = CR_CFG[fi].lf;
        const crText = CR_CFG[fi].cr;
        const nlAt = lfText.indexOf('\n');
        for (let si = 0; si < CR_SWEEP.length; si++) {
            const bh = CR_SWEEP[si];
            const nLf = TextLayout.computeWrap(lfText, f, bw, bh, 16, LF_OUT, 1);
            const nCr = TextLayout.computeWrap(crText, f, bw, bh, 16, CR_OUT, 1);
            check(nCr === nLf,
                () => 'T1 TL-13 sweep: atlas ' + fi + ' boxHeight ' + bh + ' CRLF gave ' + nCr +
                    ' lines, LF gave ' + nLf);
            // No emitted range may contain the CR, on ANY arm of the branch.
            check(crlfInRange(crText, CR_OUT, nCr) === 0,
                () => 'T1 TL-13 sweep: atlas ' + fi + ' boxHeight ' + bh +
                    ' an emitted range contains the CR (line data ' +
                    Array.from(CR_OUT.slice(0, nCr * 4)).join(',') + ')');
            for (let k = 0; k < nLf; k++) {
                // Widths and flags must match LF exactly -- a CR advance left in
                // the width shows up here and only here.
                check(CR_OUT[k * 4 + 2] === LF_OUT[k * 4 + 2],
                    () => 'T1 TL-13 sweep: atlas ' + fi + ' boxHeight ' + bh + ' line ' + k +
                        ' width ' + CR_OUT[k * 4 + 2] + ' != LF width ' + LF_OUT[k * 4 + 2] +
                        ' -- the CR advance leaked into lineWidth');
                check(CR_OUT[k * 4 + 3] === LF_OUT[k * 4 + 3],
                    () => 'T1 TL-13 sweep: atlas ' + fi + ' boxHeight ' + bh + ' line ' + k +
                        ' flag ' + CR_OUT[k * 4 + 3] + ' != LF flag ' + LF_OUT[k * 4 + 3]);
                // Ranges match too, shifted by 1 for every line past the CRLF.
                const shift = LF_OUT[k * 4] > nlAt ? 1 : 0;
                check(CR_OUT[k * 4] === LF_OUT[k * 4] + shift &&
                    CR_OUT[k * 4 + 1] === LF_OUT[k * 4 + 1] + shift,
                    () => 'T1 TL-13 sweep: atlas ' + fi + ' boxHeight ' + bh + ' line ' + k +
                        ' range [' + CR_OUT[k * 4] + ',' + CR_OUT[k * 4 + 1] + '] != LF [' +
                        LF_OUT[k * 4] + ',' + LF_OUT[k * 4 + 1] + '] shifted by ' + shift);
            }
            check(TextLayout.countLines(crText, f, bw, bh, 16, 1) ===
                TextLayout.countLines(lfText, f, bw, bh, 16, 1),
                () => 'T1 TL-13 sweep: atlas ' + fi + ' boxHeight ' + bh +
                    ' countLines disagrees between CRLF and LF');
        }
    }
    // --- OUT OF CONTRACT, pinned rather than dropped ------------------------
    // A CR whose OWN advance forces a wrap. Only reachable in an atlas where
    // glyph 13 has a non-zero advance -- no real bitmap font emits a printable
    // CR, which is why FONT has advance 0 and why this is a boundary and not a
    // bug report. Below boxWidth 57 (content 48 + CR advance 9) the CR is a
    // width-bearing glyph that hard-breaks onto its OWN line in section 4,
    // before the `id === 10` branch ever runs, so CRLF cannot match LF's line
    // count. Making it match would require the per-character body to know about
    // CRs, which the hot-path law forbids outright.
    //
    // 1.2.0 is still strictly better than 1.1.0 here: the CR is no longer
    // INSIDE an emitted range. 1.1.0 gave [14,15) width 12; 1.2.0 gives the
    // empty [14,14). The TL-13 range claim holds even out here; only the
    // line-count identity does not.
    const OOC = new Float32Array(4 * 32);
    for (const bwv of [48, 54]) {
        const nOoc = TextLayout.computeWrap('AAAA BBBB CCCC\r\nDDDD', CR_FONT, bwv, 0, 16, OOC, 1);
        const nLfc = TextLayout.computeWrap('AAAA BBBB CCCC\nDDDD', CR_FONT, bwv, 0, 16, LF_OUT, 1);
        check(nOoc === 5 && nLfc === 4,
            () => 'T1 TL-13 out-of-contract: boxWidth ' + bwv + ' expected CRLF 5 / LF 4, got ' +
                nOoc + ' / ' + nLfc + ' -- the CR-forces-a-wrap boundary moved');
        check(OOC[12] === 14 && OOC[13] === 14 && OOC[14] === 0,
            () => 'T1 TL-13 out-of-contract: boxWidth ' + bwv + ' the wrapped-CR line is [' +
                OOC[12] + ',' + OOC[13] + '] width ' + OOC[14] + ', expected the EMPTY [14,14] ' +
                'width 0 -- the CR must not be inside a range even out here');
        check(crlfInRange('AAAA BBBB CCCC\r\nDDDD', OOC, nOoc) === 0,
            () => 'T1 TL-13 out-of-contract: boxWidth ' + bwv + ' a range contains the CR');
    }
    // And the boundary itself: at 57 the CR fits and the identity is restored.
    check(TextLayout.computeWrap('AAAA BBBB CCCC\r\nDDDD', CR_FONT, 60, 0, 16, OOC, 1) === 4,
        () => 'T1 TL-13: boxWidth 60 (content 48 + CR advance 9 + kerning 3) must restore the LF ' +
            'line count');

    // The exact row that was broken, pinned by literal as well: boxHeight 16
    // truncates to one line and the CR must NOT be at endIdx 4.
    check((() => { const c = n('AAA\r\nBBB', FONT, 0, 16, 16, 1);
        return c === 1 && OUT[0] === 0 && OUT[1] === 3 && OUT[2] === 36 && OUT[3] === FLAG_TRUNCATED; })(),
        () => 'T1 TL-13 truncating: expected [0,3,36,FLAG_TRUNCATED], the CR excluded from the ' +
            'truncated range too');
    // TL-13 lone CR -- policy C, DOCUMENTED and unchanged: not a terminator,
    // keeps its atlas advance (0 in this font), stays inside the range.
    check((() => { const c = n('\r', FONT, 0, 0, 16, 1);
        return c === 1 && OUT[0] === 0 && OUT[1] === 1 && OUT[2] === 0; })(),
        () => 'T1 TL-13 DOCUMENTED (lone CR): a CR with no LF stays in range as [0,1) width 0');
    check((() => { const c = n('AAA\rBBB', FONT, 0, 0, 16, 1);
        return c === 1 && OUT[0] === 0 && OUT[1] === 7 && OUT[2] === 72; })(),
        () => 'T1 TL-13 DOCUMENTED (lone CR mid-text): one line [0,7) of width 72 -- the CR ' +
            'contributes its zero advance and does not break the line');

    // --- TL-26 PROMOTED: the phantom line is gone, the blank line is not -----
    check((() => { const c = n('AAA \nBBB', FONT, 40, 0, 16, 1);
        return c === 2 && OUT[0] === 0 && OUT[1] === 3 && OUT[2] === 36 &&
            OUT[4] === 5 && OUT[5] === 8 && OUT[6] === 36; })(),
        () => 'T1 TL-26: the phantom zero-width line after a whitespace soft break must be gone ' +
            '(2 lines, [0,3,36] [5,8,36])');
    check(countPhantoms('AAA \nBBB', OUT, 2) === 0,
        () => 'T1 TL-26: a phantom line survived the suppression');
    check(TextLayout.countLines('AAA \nBBB', FONT, 40, 0, 16, 1) === 2,
        () => 'T1 TL-26: countLines must agree -- the suppression is in both entry points');
    // The other direction, and it is the whole difference between a fix and a
    // regression: a DELIBERATE blank line is preceded by 10, not 32, so it
    // survives untouched.
    check((() => { const c = n('AAA\n\nBBB', FONT, 0, 0, 16, 1);
        return c === 3 && OUT[4] === 4 && OUT[5] === 4 && OUT[6] === 0 && OUT[7] === FLAG_NORMAL; })(),
        () => 'T1 TL-26: the DELIBERATE blank line in AAA\\n\\nBBB was suppressed -- that is a ' +
            'regression, not a fix');
    check(TextLayout.countLines('AAA\n\nBBB', FONT, 0, 0, 16, 1) === 3,
        () => 'T1 TL-26: countLines suppressed the deliberate blank line');
    // The CRLF intersection: the cheap `prev === 32` form would have left the
    // phantom in place here, which is why the predicate reads before lineStart.
    check((() => { const c = n('AAA \r\nBBB', FONT, 40, 0, 16, 1); return c === 2; })(),
        () => 'T1 TL-26 x TL-13: a phantom line survives in CRLF text -- the suppression must ' +
            'read text.charCodeAt(lineStart - 1), not the character before the newline');
    check((() => { const c = n('AAA  \n', FONT, 40, 0, 16, 1);
        return c === 1 && OUT[0] === 0 && OUT[1] === 3 && OUT[2] === 36; })(),
        () => 'T1 TL-26: the roadmap reproduction AAA__\\n must be one line, not two');

    // --- text not a string (TL-09 PROMOTED) ----------------------------------
    // Known-good half first: the same call with a real string is accepted.
    check(n('AAA', FONT, 40, 0, 16, 1) === 1, () => 'T1 TL-09 base: a string text is accepted');
    check(throwsDoor(() => n(12345, FONT, 40, 0, 16, 1), 'text', 'string'),
        () => 'T1 TL-09 (text=12345): must throw, not return 0 silently');
    check(throwsDoor(() => n(null, FONT, 40, 0, 16, 1), 'text', 'string'),
        () => 'T1 TL-09 (text=null): must throw a TextLayoutError naming text');
    check(throwsDoor(() => n(undefined, FONT, 40, 0, 16, 1), 'text', 'string'),
        () => 'T1 TL-09 (text=undefined): must throw a TextLayoutError naming text');
    check(throwsDoor(() => n(['A'], FONT, 40, 0, 16, 1), 'text', 'string'),
        () => 'T1 TL-09 (text=[A]): must throw a TextLayoutError naming text');

    // --- font (TL-08 short table NaN, TL-09 no door) -------------------------
    check(n(T2W, FONT, 40, 0, 16, 1) === 2, () => 'T1 full stub font -> 2 lines');
    check(n('AAA BBB', Object.freeze({ glyphs: FONT.glyphs, kerning: FONT.kerning }), 40, 0, 16, 1) === 2,
        () => 'T1 frozen valid font -> 2 lines');
    const noDotGlyphs = new Int16Array(256 * 7);
    for (let i = 65; i <= 90; i++) noDotGlyphs[i * 7 + 6] = 12;
    noDotGlyphs[32 * 7 + 6] = 6;
    const noDotFont = { glyphs: noDotGlyphs, kerning: new Int16Array(65536) };
    check(n('AB AB AB', noDotFont, 24, 20, 20, 1) === 1 && Number.isFinite(OUT[2]),
        () => 'T1 missing dot -> ellipsisWidth 0, finite width');
    // --- TL-08 PROMOTED: a short table is named, measured and rejected -------
    // 700 is the brief's canonical short length; 100*7 is 700 exactly, so the
    // message must name both the received 700 and the required 1792.
    const short100 = { glyphs: new Int16Array(100 * 7), kerning: new Int16Array(65536) };
    const short4 = { glyphs: new Int16Array(4), kerning: new Int16Array(65536) };
    const shortKern = { glyphs: FONT.glyphs, kerning: new Int16Array(4) };
    check(throwsDoor(() => n('AAA zzz', short100, 40, 0, 16, 1), 'font.glyphs', '700', '1792'),
        () => 'T1 TL-08 (glyphs 100*7): message must name font.glyphs, the received 700 and the required 1792');
    check(throwsDoor(() => n('AAA', short4, 40, 0, 16, 1), 'font.glyphs', '4', '1792'),
        () => 'T1 TL-08 (glyphs 4): message must name font.glyphs, the received 4 and the required 1792');
    check(throwsDoor(() => n('AB', shortKern, 0, 0, 16, 1), 'font.kerning', '4', '65536'),
        () => 'T1 TL-08 (short kerning): message must name font.kerning, the received 4 and the required 65536');
    // The mitigating fact, stated as an executable pin: a full-size table of the
    // shape @zakkster/lite-bmfont allocates (Int16Array(256*7)) is ACCEPTED.
    check(n('AAA', { glyphs: new Int16Array(256 * 7), kerning: new Int16Array(65536) }, 40, 0, 16, 1) === 1,
        () => 'T1 TL-08: a full-size hand-rolled table must be accepted -- the door is on LENGTH, not identity');

    // --- TL-09 PROMOTED: font, and never a raw property-read TypeError -------
    check(throwsDoor(() => n('A', {}, 40, 0, 16, 1), 'font.glyphs'),
        () => 'T1 TL-09 (font={}): must be a TextLayoutError naming font.glyphs, not "Cannot read properties"');
    check(throwsDoor(() => n('A', null, 40, 0, 16, 1), 'font'),
        () => 'T1 TL-09 (font=null): must be a TextLayoutError naming font');
    check(throwsDoor(() => n('A', undefined, 40, 0, 16, 1), 'font'),
        () => 'T1 TL-09 (font=undefined): must be a TextLayoutError naming font');

    // --- the f32 index ceiling (TL-15): indices are Float32, exact only to 2^24.
    // Exercise the SUBJECT: wrap a line whose end index is the first integer f32
    // cannot represent and read the index back. The entry dies the day the
    // ceiling moves (a Float64 buffer, a fail-closed throw, or any other fix),
    // instead of asserting an IEEE identity that is true forever. The 16.77M-char
    // input is the smallest that genuinely crosses 2^24; it costs ~130 ms.
    // TL-15 PROMOTED as policy C (document). See decisions/0002-input-door.md
    // for both sides of the throw-versus-document argument. The ceiling is a
    // property of the OUTPUT FORMAT (Float32 index slots, fixed by the
    // drawWrapped contract), not of the input, so it is documented in all four
    // surfaces and pinned here against the SUBJECT -- not asserted as an IEEE
    // identity, which would be true forever and prove nothing about this
    // library. The day the buffer type changes, this pin fails and the
    // documentation follows it. The 16.77M-char input costs ~130 ms.
    check((() => {
        const CEIL = 16777216;         // 2^24
        const trueLen = CEIL + 1;      // 16777217, the first integer f32 cannot hold
        const big = 'A'.repeat(trueLen);
        const out = new Float32Array(4);
        const c = TextLayout.computeWrap(big, FONT, 0, 0, 16, out, 1);
        return c === 1 && out[1] === CEIL;
    })(),
        () => 'T1 TL-15 DOCUMENTED: a text of 16777217 chars must report endIdx 16777216 -- ' +
            'the f32 index ceiling. If this moved, update all four documentation surfaces.');

    // --- TL-24: a single glyph wider than boxWidth still produces a line wider
    // than the box, unflagged. The hard-break path re-seeds cursorX from the
    // glyph's own xadvance and never re-checks boxWidth; the i > lineStart guard
    // is all that stops an infinite loop, at the cost of an over-wide line. "Read,
    // not run" in the roadmap; pinned here as an executable predicate over the
    // subject. T5 cannot cover it -- subject and oracle AGREE on over-wide glyphs
    // (both emit one per line), so the fuzz never diverges on this. Dies the day
    // a policy lands (a clamp, or a flag on the over-wide line).
    // TL-24 PROMOTED as policy B (define). The over-wide line is DELIBERATE and
    // documented: the `i > lineStart` guard is what makes the loop terminate,
    // and the price of that guarantee is one glyph past the box rather than an
    // infinite loop or a dropped glyph. No flag: FLAG_TRUNCATED means "the TEXT
    // did not fit the BOX vertically" and reusing it here would corrupt a value
    // space two other findings depend on.
    check((() => {
        const wide = new Float32Array(8);
        const bw = 8;                 // narrower than one glyph (12)
        const c = TextLayout.computeWrap('AB', FONT, bw, 0, 16, wide, 1);
        return c === 2 && wide[2] === 12 && wide[2] > bw && wide[3] === FLAG_NORMAL;
    })(),
        () => 'T1 TL-24 DELIBERATE: a glyph wider than boxWidth is emitted as an over-wide, ' +
            'unflagged line -- 12px of content in an 8px box');
    check((() => {
        const one = new Float32Array(4);
        const c = TextLayout.computeWrap('A', FONT, 4, 0, 16, one, 1);
        return c === 1 && one[0] === 0 && one[1] === 1 && one[2] === 12 && one[3] === FLAG_NORMAL;
    })(),
        () => 'T1 TL-24 DELIBERATE: a single glyph in a 4px box is one line [0,1) of width 12');

    // --- TL-12: a truncated line's lineWidth INCLUDES the ellipsis allowance
    // (content 36 + ellipsis 18 = 54). This behaviour is intended -- the .d.ts
    // documents it; only the docstring and llms.txt omit it. So it is a pinned
    // PASSING assertion (behaviour to keep) plus a todo naming the doc session,
    // not a knownFailing. The check dies if the width behaviour ever changes.
    const dotFont = makeDotFont();
    const trunc = new Float32Array(16);
    const tc = TextLayout.computeWrap('AAAA BBBB CCCC DDDD', dotFont, 60, 40, 16, trunc, 1);
    check(tc === 2 && trunc[3] === FLAG_NORMAL && trunc[7] === FLAG_TRUNCATED &&
        trunc[2] === 48 && trunc[6] === 54,
        () => 'TL-12: truncated lineWidth should be content 36 + ellipsis 18 = 54, got ' +
            trunc[6] + ' (line0 width ' + trunc[2] + ', flag ' + trunc[7] + ')');
    // TL-12 CLOSED (policy C, TL2): the ellipsis allowance is now stated in all
    // four surfaces -- the source docstring, TextLayout.d.ts, llms.txt and
    // README.md -- not just the d.ts. The behaviour is unchanged and the check
    // above is what keeps it that way, so the todo is gone rather than moved.

    // --- TL-23 (S3, read-not-run): lastSpaceWidth is reset nowhere -- only
    // lastSpace = -1 is, in several places. Harmless today because lastSpaceWidth
    // is read ONLY when lastSpace !== -1, so no output can distinguish a stale
    // value from a correct one. Deliberately NO executable entry: an honest
    // predicate over computeWrap cannot observe it. Revisit if a missed reset
    // ever makes it observable.
}
