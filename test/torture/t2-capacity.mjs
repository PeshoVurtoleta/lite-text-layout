/**
 * T2 -- output buffer capacity and type. This is where TL-01 lives.
 *
 * One named row per line of ROADMAP section 3's T2 table. Correct rows are plain
 * checks; finding-linked rows are knownFailing citing the ID. TL-01 is now a
 * PASSING assertion (TL1): an undersized buffer marks the flags slot of its last
 * written line FLAG_OVERFLOW, so a truncated ten-word layout is no longer
 * byte-identical to a genuine three-word one -- they differ in exactly that slot
 * -- while a buffer that fits carries FLAG_NORMAL and a zero-capacity buffer
 * returns 0 and writes nothing. The aliasing row pins today's observed result and
 * records the undecided policy as a todo for TL2.
 */

import { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW } from '../../TextLayout.js';
import { FONT, POISON, check, knownFailing, todo } from './harness.mjs';

const TEN = 'AAA BBB CCC DDD EEE FFF GGG HHH III JJJ';   // 10 words, one per line at boxWidth 40
const THREE = 'AAA BBB CCC';                              // 3 words, one per line at boxWidth 40

export function run() {
    // length 0 and 1..3 (under one stride) -> 0.
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(0), 1) === 0, () => 'T2 len0 -> 0');
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(1), 1) === 0, () => 'T2 len1 -> 0');
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(2), 1) === 0, () => 'T2 len2 -> 0');
    check(TextLayout.computeWrap('AAA', FONT, 40, 0, 16, new Float32Array(3), 1) === 0, () => 'T2 len3 -> 0');

    // length 4*n exactly, text fits in n lines -> correct. (d) An exact-fit row
    // carries no FLAG_OVERFLOW anywhere in its written slots.
    const fit = new Float32Array(4 * 3);
    check(TextLayout.computeWrap(THREE, FONT, 40, 0, 16, fit, 1) === 3, () => 'T2 4n fits -> n lines');
    for (let j = 0; j < 12; j++) {
        check(fit[j] !== FLAG_OVERFLOW,
            () => 'T2 4n exact-fit: slot ' + j + ' is FLAG_OVERFLOW on a buffer that fit');
    }

    // length 4*n+3 (partial trailing stride) -> surplus ignored. (e) The last
    // written line (slot 7) carries FLAG_OVERFLOW: TEN needs 10 lines, cap is 2.
    const partial = new Float32Array(4 * 2 + 3);
    check(TextLayout.computeWrap(TEN, FONT, 40, 0, 16, partial, 1) === 2, () => 'T2 4n+3 -> floor(len/4) lines');
    check(partial[7] === FLAG_OVERFLOW, () => 'T2 4n+3: slot 7 not FLAG_OVERFLOW (got ' + partial[7] + ')');

    // oversized buffer -> tail untouched. (f) No written line carries FLAG_OVERFLOW.
    const over = new Float32Array(40).fill(-999);
    const nOver = TextLayout.computeWrap('AAA BBB', FONT, 40, 0, 16, over, 1);
    check(nOver === 2, () => 'T2 oversized -> 2 lines');
    let tailOk = true;
    for (let j = nOver * 4; j < over.length; j++) if (over[j] !== -999) tailOk = false;
    check(tailOk, () => 'T2 oversized: a slot past lineCount*4 was written');
    for (let j = 0; j < nOver * 4; j++) {
        check(over[j] !== FLAG_OVERFLOW,
            () => 'T2 oversized: slot ' + j + ' is FLAG_OVERFLOW on a buffer with room to spare');
    }

    // Precondition for TL-01: the same text wraps to 10 lines in a big buffer.
    const BIG = new Float32Array(4 * 20);
    check(TextLayout.computeWrap(TEN, FONT, 40, 0, 16, BIG, 1) === 10,
        () => 'T2 TL-01 precondition: TEN wraps to 10 lines when the buffer is big enough');

    // TL-01 -- PROMOTED (TL1). An undersized buffer reports itself on the flags
    // slot of its last written line, so a truncated layout is now distinguishable
    // from a genuine short one. Both directions, and the difference is one slot.
    // (a) TEN into a 3-line buffer returns 3 and slot 11 is FLAG_OVERFLOW.
    const a = new Float32Array(4 * 3);
    const nA = TextLayout.computeWrap(TEN, FONT, 40, 0, 16, a, 1);
    check(nA === 3, () => 'T2 TL-01(a): TEN into 3-line buffer returned ' + nA + ' != 3');
    check(a[11] === FLAG_OVERFLOW, () => 'T2 TL-01(a): slot 11 not FLAG_OVERFLOW (got ' + a[11] + ')');

    // (b) A genuine three-word text into the same size returns 3, slot 11 is
    // FLAG_NORMAL -- an always-on flag would be noise, not a fix.
    const b = new Float32Array(4 * 3);
    const nB = TextLayout.computeWrap(THREE, FONT, 40, 0, 16, b, 1);
    check(nB === 3, () => 'T2 TL-01(b): THREE into 3-line buffer returned ' + nB + ' != 3');
    check(b[11] === FLAG_NORMAL, () => 'T2 TL-01(b): slot 11 not FLAG_NORMAL (got ' + b[11] + ')');

    // (c) The two buffers now differ, and differ ONLY in slot 11.
    let diffAt = -1;
    let diffCount = 0;
    for (let j = 0; j < 12; j++) {
        if (a[j] !== b[j]) { diffCount++; diffAt = j; }
    }
    check(diffCount === 1 && diffAt === 11,
        () => 'T2 TL-01(c): buffers differ in ' + diffCount + ' slots (first at ' + diffAt + '), expected exactly slot 11');

    // (g) Capacities 0, 1, 2, 3 return 0 and leave a POISON-prefilled buffer
    // bit-identical -- no ptr-1 write into an empty buffer (R3).
    for (let cap = 0; cap <= 3; cap++) {
        const poisoned = new Float32Array(cap).fill(POISON);
        const snap = Float32Array.from(poisoned);
        const nz = TextLayout.computeWrap(TEN, FONT, 40, 0, 16, poisoned, 1);
        check(nz === 0, () => 'T2 TL-01(g): capacity ' + cap + ' returned ' + nz + ' != 0');
        for (let j = 0; j < cap; j++) {
            check(poisoned[j] === snap[j],
                () => 'T2 TL-01(g): capacity ' + cap + ' slot ' + j + ' was written (POISON clobbered)');
        }
    }

    // (h) The prefix law, exhaustively. For TEN at boxWidth 40, capacities
    // m = 1..12: the 4m-buffer output equals the first m lines of the big output
    // except slot 4m-1, which is FLAG_OVERFLOW for m < 10 and FLAG_NORMAL otherwise.
    for (let m = 1; m <= 12; m++) {
        const buf = new Float32Array(4 * m);
        const nm = TextLayout.computeWrap(TEN, FONT, 40, 0, 16, buf, 1);
        const expectN = m < 10 ? m : 10;
        check(nm === expectN, () => 'T2 TL-01(h): m=' + m + ' returned ' + nm + ' != ' + expectN);
        for (let j = 0; j < expectN * 4; j++) {
            if (m < 10 && j === 4 * m - 1) {
                check(buf[j] === FLAG_OVERFLOW,
                    () => 'T2 TL-01(h): m=' + m + ' slot ' + j + ' not FLAG_OVERFLOW');
            } else {
                check(buf[j] === BIG[j],
                    () => 'T2 TL-01(h): m=' + m + ' slot ' + j + ' ' + buf[j] + ' != big ' + BIG[j]);
            }
        }
        check(buf[4 * m - 1] === (m < 10 ? FLAG_OVERFLOW : FLAG_NORMAL),
            () => 'T2 TL-01(h): m=' + m + ' overflow slot ' + (4 * m - 1) + ' wrong (got ' + buf[4 * m - 1] + ')');
    }

    // (i) Mutual exclusivity. A truncating call (boxHeight 32, lineHeight 16) into
    // a 2-line buffer returns 2, the last line is FLAG_TRUNCATED, no FLAG_OVERFLOW.
    const trunc = new Float32Array(4 * 2);
    const nT = TextLayout.computeWrap(TEN, FONT, 40, 32, 16, trunc, 1);
    check(nT === 2, () => 'T2 TL-01(i): truncating call returned ' + nT + ' != 2');
    check(trunc[7] === FLAG_TRUNCATED, () => 'T2 TL-01(i): last line not FLAG_TRUNCATED (got ' + trunc[7] + ')');
    for (let j = 0; j < 8; j++) {
        check(trunc[j] !== FLAG_OVERFLOW,
            () => 'T2 TL-01(i): slot ' + j + ' is FLAG_OVERFLOW on a truncating call (must be mutually exclusive)');
    }

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
