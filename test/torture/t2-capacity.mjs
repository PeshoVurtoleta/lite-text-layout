/**
 * T2 -- output buffer capacity and type. This is where TL-01 lives.
 *
 * One named row per line of ROADMAP section 3's T2 table. Correct rows are plain
 * checks; finding-linked rows are knownFailing citing the ID. The TL-01 row
 * asserts the INDISTINGUISHABILITY directly: a ten-word text truncated into a
 * 3-line buffer is byte-identical to a genuine three-word text in the same
 * buffer, and both last lines read FLAG_NORMAL -- overflow is silent and
 * fail-open. The aliasing row pins today's observed result and records the
 * undecided policy as a todo for TL2.
 */

import { TextLayout, FLAG_NORMAL } from '../../TextLayout.js';
import { FONT, check, knownFailing, todo } from './harness.mjs';

const TEN = 'AAA BBB CCC DDD EEE FFF GGG HHH III JJJ';   // 10 words, one per line at boxWidth 40
const THREE = 'AAA BBB CCC';                              // 3 words, one per line at boxWidth 40

export function run() {
    // length 0 and 1..3 (under one stride) -> 0.
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(0), 1) === 0, () => 'T2 len0 -> 0');
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(1), 1) === 0, () => 'T2 len1 -> 0');
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(2), 1) === 0, () => 'T2 len2 -> 0');
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(3), 1) === 0, () => 'T2 len3 -> 0');

    // length 4*n exactly, text fits in n lines -> correct.
    const fit = new Float32Array(4 * 3);
    check(TextLayout.computeWrap(THREE, FONT, 40, 0, 16, fit, 1) === 3, () => 'T2 4n fits -> n lines');

    // length 4*n+3 (partial trailing stride) -> surplus ignored.
    const partial = new Float32Array(4 * 2 + 3);
    check(TextLayout.computeWrap(TEN, FONT, 40, 0, 16, partial, 1) === 2, () => 'T2 4n+3 -> floor(len/4) lines');

    // oversized buffer -> tail untouched.
    const over = new Float32Array(40).fill(-999);
    const nOver = TextLayout.computeWrap('AAA BBB', FONT, 40, 0, 16, over, 1);
    check(nOver === 2, () => 'T2 oversized -> 2 lines');
    let tailOk = true;
    for (let j = nOver * 4; j < over.length; j++) if (over[j] !== -999) tailOk = false;
    check(tailOk, () => 'T2 oversized: a slot past lineCount*4 was written');

    // Precondition for TL-01: the same text wraps to 10 lines in a big buffer.
    check(TextLayout.computeWrap(TEN, FONT, 40, 0, 16, new Float32Array(4 * 20), 1) === 10,
        () => 'T2 TL-01 precondition: TEN wraps to 10 lines when the buffer is big enough');

    // TL-01 -- length 4*n exactly, text needs n+1 lines: silent, indistinguishable.
    knownFailing('TL-01 (overflow silent + indistinguishable)', () => {
        const a = new Float32Array(4 * 3);
        const nA = TextLayout.computeWrap(TEN, FONT, 40, 0, 16, a, 1);
        const b = new Float32Array(4 * 3);
        const nB = TextLayout.computeWrap(THREE, FONT, 40, 0, 16, b, 1);
        if (nA !== 3 || nB !== 3) return false;
        let identical = true;
        for (let j = 0; j < 12; j++) if (a[j] !== b[j]) identical = false;
        return identical && a[11] === FLAG_NORMAL && b[11] === FLAG_NORMAL;
    });

    // TL-10 -- outBuffer type is unchecked.
    knownFailing('TL-10 (plain Array accepted)', () => {
        const a = new Array(16).fill(0);
        const nA = TextLayout.computeWrap('AAA BBB', FONT, 40, 0, 16, a, 1);
        return nA === 2 && a[0] === 0 && a[1] === 3 && a[2] === 36;
    });
    knownFailing('TL-10 (Float64Array accepted)', () => {
        const f = new Float64Array(16);
        const nF = TextLayout.computeWrap('AAA BBB', FONT, 40, 0, 16, f, 1);
        return nF === 2 && f[2] === 36;
    });
    knownFailing('TL-10 (Int32Array truncates width)', () => {
        const it = new Int32Array(16);
        const nI = TextLayout.computeWrap('A', FONT, 0, 0, 16, it, 0.1);
        // true width is 1.2 (12 * 0.1); an Int32 buffer stores only the integer part
        return nI === 1 && it[2] === 1;
    });

    // outBuffer aliasing font.glyphs' ArrayBuffer -- undecided policy, pin today.
    const g = new Int16Array(256 * 7);
    for (let i = 65; i <= 90; i++) g[i * 7 + 6] = 12;
    g[32 * 7 + 6] = 6;
    g[46 * 7 + 6] = 6;
    const aliasFont = { glyphs: g, kerning: new Int16Array(65536) };
    const aliasOut = new Float32Array(g.buffer);   // shares memory with font.glyphs
    const nAlias = TextLayout.computeWrap('AAA BBB', aliasFont, 40, 0, 16, aliasOut, 1);
    check(nAlias === 2 && aliasOut[0] === 0 && aliasOut[1] === 3 && aliasOut[2] === 36,
        () => 'T2 alias: observed result changed (was 2 lines, first line [0,3,36])');
    todo('TL2', 'outBuffer aliasing font.glyphs is policy-undecided -- lands in TL2');
}
