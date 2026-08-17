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

import { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED } from '../../TextLayout.js';
import { FONT, check, knownFailing, todo } from './harness.mjs';

const OUT = new Float32Array(4 * 256);
const T4 = 'AAA BBB CCC DDD';   // 4 words -> [0,15,162] at infinite width
const T5T = 'A\nB\nC\nD\nE';    // 5 explicit lines
const T2W = 'AAA BBB';          // 2 words -> 2 lines at boxWidth 40

function n(text, font, bw, bh, lh, scale) {
    return TextLayout.computeWrap(text, font, bw, bh, lh, OUT, scale);
}
function throwsType(fn) {
    try { fn(); return false; } catch (e) { return e instanceof TypeError; }
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
    // --- boxWidth (TL-05: negative and NaN silently mean infinite) -----------
    check(n(T4, FONT, 0, 0, 16, 1) === 1, () => 'T1 boxWidth 0 -> 1 line (documented infinite)');
    check(n(T4, FONT, -0, 0, 16, 1) === 1, () => 'T1 boxWidth -0 aliases 0');
    check(n(T4, FONT, Infinity, 0, 16, 1) === 1, () => 'T1 boxWidth +Infinity -> 1 line');
    check(n(T4, FONT, 3.4e38, 0, 16, 1) === 1, () => 'T1 boxWidth 3.4e38 -> 1 line');
    check(n(T4, FONT, 1e-7, 0, 16, 1) === 12, () => 'T1 boxWidth 1e-7 -> one glyph per line');
    knownFailing('TL-05 (boxWidth=-1)', () => n(T4, FONT, -1, 0, 16, 1) === 1);
    knownFailing('TL-05 (boxWidth=-100)', () => n(T4, FONT, -100, 0, 16, 1) === 1);
    knownFailing('TL-05 (boxWidth=NaN)', () => n(T4, FONT, NaN, 0, 16, 1) === 1);
    knownFailing('TL-05 (boxWidth=-Infinity)', () => n(T4, FONT, -Infinity, 0, 16, 1) === 1);

    // --- boxHeight (TL-07: a box smaller than one line still emits) -----------
    check(n(T5T, FONT, 0, 0, 16, 1) === 5, () => 'T1 boxHeight 0 -> 5 lines (infinite)');
    check(n(T5T, FONT, 0, -0, 16, 1) === 5, () => 'T1 boxHeight -0 aliases 0');
    check(n(T5T, FONT, 0, -1, 16, 1) === 5, () => 'T1 boxHeight -1 -> no truncation');
    check(n(T5T, FONT, 0, -100, 16, 1) === 5, () => 'T1 boxHeight -100 -> no truncation');
    check(n(T5T, FONT, 0, NaN, 16, 1) === 5, () => 'T1 boxHeight NaN -> no truncation');
    check(n(T5T, FONT, 0, Infinity, 16, 1) === 5, () => 'T1 boxHeight Infinity -> no truncation');
    check(n(T5T, FONT, 0, -Infinity, 16, 1) === 5, () => 'T1 boxHeight -Infinity -> no truncation');
    check(n(T5T, FONT, 0, 3.4e38, 16, 1) === 5, () => 'T1 boxHeight 3.4e38 -> no truncation');
    check(n(T5T, FONT, 0, 1e-7, 16, 1) === 1, () => 'T1 boxHeight 1e-7 -> truncates to 1');
    knownFailing('TL-07 (boxHeight=8)',
        () => { const c = n('AAA', FONT, 0, 8, 16, 1); return c === 1 && OUT[3] === FLAG_NORMAL; });
    knownFailing('TL-07 (boxHeight=1)',
        () => { const c = n('AAA', FONT, 0, 1, 16, 1); return c === 1 && OUT[3] === FLAG_NORMAL; });

    // --- lineHeight (TL-06: lineHeight <= 0 disables truncation) --------------
    knownFailing('TL-06 (lineHeight=0)', () => n(T5T, FONT, 40, 20, 0, 1) === 5);
    knownFailing('TL-06 (lineHeight=-16)', () => n(T5T, FONT, 40, 20, -16, 1) === 5);
    knownFailing('TL-06 (lineHeight=NaN)', () => n(T5T, FONT, 40, 20, NaN, 1) === 5);
    check(n(T5T, FONT, 40, 20, Infinity, 1) === 1, () => 'T1 lineHeight Infinity over-truncates to 1');

    // --- scale (TL-03 width poison, TL-04 silent accept) ---------------------
    check(n(T2W, FONT, 40, 0, 16, 1) === 2, () => 'T1 scale 1 -> 2 lines');
    check(n(T2W, FONT, 40, 0, 16, 2) === 6, () => 'T1 scale 2 -> 6 lines');
    check(n(T2W, FONT, 40, 0, 16, 0.5) === 1, () => 'T1 scale 0.5 -> 1 line');
    check(n(T2W, FONT, 40, 0, 16, 1e-30) === 1, () => 'T1 scale 1e-30 -> 1 line');
    knownFailing('TL-04 (scale=0)',
        () => { const c = n(T2W, FONT, 40, 0, 16, 0); return c === 1 && OUT[2] === 0; });
    knownFailing('TL-04 (scale=-1)',
        () => { const c = n(T2W, FONT, 40, 0, 16, -1); return c === 1 && OUT[2] < 0; });
    knownFailing('TL-03 (scale=NaN)',
        () => { const c = n(T2W, FONT, 40, 0, 16, NaN); return c === 1 && Number.isNaN(OUT[2]); });
    knownFailing('TL-03 (scale=Infinity)',
        () => { const c = n(T2W, FONT, 40, 0, 16, Infinity); return c === 1 && !Number.isFinite(OUT[2]); });

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
    knownFailing('TL-14 (single space)',
        () => { const c = n(' ', FONT, 0, 0, 16, 1); return c === 1 && OUT[0] === 0 && OUT[1] === 1; });
    knownFailing('TL-14 (three spaces)',
        () => { const c = n('   ', FONT, 0, 0, 16, 1); return c === 1 && OUT[1] === 3 && OUT[2] === 18; });
    knownFailing('TL-14 (leading spaces)',
        () => { const c = n('   AAA', FONT, 0, 0, 16, 1); return c === 1 && OUT[0] === 0 && OUT[1] === 6 && OUT[2] === 54; });
    knownFailing('TL-13 (CRLF)',
        () => { const c = n('\r\n', FONT, 0, 0, 16, 1); return c === 1 && OUT[0] === 0 && OUT[1] === 1; });
    knownFailing('TL-13 (AAA-CRLF-BBB)',
        () => { const c = n('AAA\r\nBBB', FONT, 0, 0, 16, 1); return c === 2 && OUT[1] === 4 && OUT[2] === 36; });
    knownFailing('TL-13 (lone CR)',
        () => { const c = n('\r', FONT, 0, 0, 16, 1); return c === 1 && OUT[0] === 0 && OUT[1] === 1; });

    // --- text not a string (TL-09) -------------------------------------------
    knownFailing('TL-09 (text=12345 silent 0)', () => n(12345, FONT, 40, 0, 16, 1) === 0);
    knownFailing('TL-09 (text=null throws)', () => throwsType(() => n(null, FONT, 40, 0, 16, 1)));
    knownFailing('TL-09 (text=undefined throws)', () => throwsType(() => n(undefined, FONT, 40, 0, 16, 1)));
    knownFailing('TL-09 (text=[A] throws)', () => throwsType(() => n(['A'], FONT, 40, 0, 16, 1)));

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
    const short100 = { glyphs: new Int16Array(100 * 7), kerning: new Int16Array(65536) };
    const short4 = { glyphs: new Int16Array(4), kerning: new Int16Array(65536) };
    const shortKern = { glyphs: FONT.glyphs, kerning: new Int16Array(4) };
    knownFailing('TL-08 (glyphs 100*7 NaN)',
        () => { const c = n('AAA zzz', short100, 40, 0, 16, 1); return c === 1 && !Number.isFinite(OUT[2]); });
    knownFailing('TL-08 (glyphs 4 NaN)',
        () => { const c = n('AAA', short4, 40, 0, 16, 1); return c === 1 && !Number.isFinite(OUT[2]); });
    knownFailing('TL-08 (short kerning NaN)',
        () => { const c = n('AB', shortKern, 0, 0, 16, 1); return c === 1 && !Number.isFinite(OUT[2]); });
    knownFailing('TL-09 (font={} throws)', () => throwsType(() => n('A', {}, 40, 0, 16, 1)));
    knownFailing('TL-09 (font=null throws)', () => throwsType(() => n('A', null, 40, 0, 16, 1)));
    knownFailing('TL-09 (font=undefined throws)', () => throwsType(() => n('A', undefined, 40, 0, 16, 1)));

    // --- the f32 index ceiling (TL-15): indices are Float32, exact only to 2^24.
    // Exercise the SUBJECT: wrap a line whose end index is the first integer f32
    // cannot represent and read the index back. The entry dies the day the
    // ceiling moves (a Float64 buffer, a fail-closed throw, or any other fix),
    // instead of asserting an IEEE identity that is true forever. The 16.77M-char
    // input is the smallest that genuinely crosses 2^24; it costs ~130 ms.
    knownFailing('TL-15 (f32 index ceiling 2^24)', () => {
        const CEIL = 16777216;         // 2^24
        const trueLen = CEIL + 1;      // 16777217, the first integer f32 cannot hold
        const big = 'A'.repeat(trueLen);
        const out = new Float32Array(4);
        let reported;
        try {
            const c = TextLayout.computeWrap(big, FONT, 0, 0, 16, out, 1);
            if (c !== 1) return false;   // partition changed -> promote/triage
            reported = out[1];           // endIdx of the single flushed line
        } catch (err) {
            return false;                // now fails closed on overflow -> promote
        }
        // Bug reproduces iff the true end index (trueLen) is reported lossily as CEIL.
        return trueLen !== CEIL && reported === CEIL;
    });

    // --- TL-24: a single glyph wider than boxWidth still produces a line wider
    // than the box, unflagged. The hard-break path re-seeds cursorX from the
    // glyph's own xadvance and never re-checks boxWidth; the i > lineStart guard
    // is all that stops an infinite loop, at the cost of an over-wide line. "Read,
    // not run" in the roadmap; pinned here as an executable predicate over the
    // subject. T5 cannot cover it -- subject and oracle AGREE on over-wide glyphs
    // (both emit one per line), so the fuzz never diverges on this. Dies the day
    // a policy lands (a clamp, or a flag on the over-wide line).
    knownFailing('TL-24 (over-wide glyph exceeds the box, unflagged)', () => {
        const wide = new Float32Array(8);
        const bw = 8;                 // narrower than one glyph (12)
        const c = TextLayout.computeWrap('AB', FONT, bw, 0, 16, wide, 1);
        // line 0 is 12px wide -- wider than the 8px box -- and FLAG_NORMAL.
        return c === 2 && wide[2] > bw && wide[3] === FLAG_NORMAL;
    });

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
    todo('TL-12', 'lineWidth includes the ellipsis allowance; docstring/llms.txt omit it -- doc fix lands in TL2/TL3');

    // --- TL-23 (S3, read-not-run): lastSpaceWidth is reset nowhere -- only
    // lastSpace = -1 is, in several places. Harmless today because lastSpaceWidth
    // is read ONLY when lastSpace !== -1, so no output can distinguish a stale
    // value from a correct one. Deliberately NO executable entry: an honest
    // predicate over computeWrap cannot observe it. Revisit if a missed reset
    // ever makes it observable.
}
