import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextLayout, TextLayoutError, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW } from '../TextLayout.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Minimal font stub matching the shape TextLayout reads: glyphs Int16Array of
 * 256*7 + kerning Int16Array of 65536. ASCII A/B/C, space, '.' are populated.
 * `kernings` is a list of {first, second, amount} pairs (BMFont-style).
 */
function makeFont(kernings = []) {
    const glyphs = new Int16Array(256 * 7);
    const kerning = new Int16Array(65536);
    const set = (id, x, y, w, h, xo, yo, xa) => {
        const p = id * 7;
        glyphs[p] = x; glyphs[p+1] = y; glyphs[p+2] = w; glyphs[p+3] = h;
        glyphs[p+4] = xo; glyphs[p+5] = yo; glyphs[p+6] = xa;
    };
    // id, sx,sy, w,h, xo,yo, xadvance
    set(32, 0, 0,   0, 0, 0, 0,   6);   // space
    set(46, 60, 0,  4, 4, 0, 12,  6);   // '.'
    set(65, 0, 0,  10, 14, 0, 2, 12);   // A
    set(66, 10, 0, 10, 14, 0, 2, 12);   // B
    set(67, 20, 0, 10, 14, 0, 2, 12);   // C
    set(68, 30, 0, 10, 14, 0, 2, 12);   // D
    for (const k of kernings) kerning[(k.first << 8) | k.second] = k.amount;
    return { glyphs, kerning };
}

/** Decode the layout buffer into a readable array of objects (test ergonomics only). */
function readLines(buf, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        out.push({ start: buf[o], end: buf[o + 1], width: buf[o + 2], flags: buf[o + 3] });
    }
    return out;
}

/** Make a fresh output buffer wide enough for `nLines`. */
function buf(nLines) {
    return new Float32Array(nLines * 4);
}

// -----------------------------------------------------------------------------
// Module surface
// -----------------------------------------------------------------------------

describe('TextLayout -- exports', () => {
    it('exports the FLAG_NORMAL / FLAG_TRUNCATED constants with documented values', () => {
        assert.equal(FLAG_NORMAL, 0);
        assert.equal(FLAG_TRUNCATED, 1);
    });

    it('exports computeWrap as a method on TextLayout', () => {
        assert.equal(typeof TextLayout.computeWrap, 'function');
    });
});

// -----------------------------------------------------------------------------
// Basic cases
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- basic cases', () => {
    it('returns 0 for an empty string', () => {
        const font = makeFont();
        const out = buf(8);
        assert.equal(TextLayout.computeWrap('', font, 100, 100, 20, out), 0);
    });

    it('returns 0 when the output buffer holds fewer than 4 floats', () => {
        const font = makeFont();
        const out = new Float32Array(3);
        assert.equal(TextLayout.computeWrap('A', font, 0, 0, 20, out), 0);
    });

    it('emits one line for text that fits with no constraints', () => {
        const font = makeFont();
        const out = buf(4);
        const n = TextLayout.computeWrap('ABC', font, 0, 0, 20, out);
        assert.equal(n, 1);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 3, width: 36, flags: FLAG_NORMAL },
        ]);
    });

    it('emits one line for text that fits within boxWidth', () => {
        const font = makeFont();
        const out = buf(4);
        const n = TextLayout.computeWrap('ABC', font, 100, 0, 20, out);
        assert.equal(n, 1);
        assert.equal(readLines(out, n)[0].width, 36);
    });

    it('treats boxWidth=0 as infinite width', () => {
        const font = makeFont();
        const out = buf(4);
        const n = TextLayout.computeWrap('ABC ABC ABC', font, 0, 0, 20, out);
        assert.equal(n, 1);
    });

    it('treats boxHeight=0 as infinite height (never truncates)', () => {
        const font = makeFont();
        const out = buf(64);
        // 4 explicit lines, boxHeight=0 -- all should be emitted normal.
        const n = TextLayout.computeWrap('A\nB\nC\nD', font, 0, 0, 20, out);
        assert.equal(n, 4);
        for (const l of readLines(out, n)) assert.equal(l.flags, FLAG_NORMAL);
    });
});

// -----------------------------------------------------------------------------
// Explicit newlines
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- explicit newlines', () => {
    it('breaks on \\n and does not include the newline char', () => {
        const font = makeFont();
        const out = buf(8);
        const n = TextLayout.computeWrap('A\nB', font, 0, 0, 20, out);
        assert.equal(n, 2);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 1, width: 12, flags: FLAG_NORMAL },
            { start: 2, end: 3, width: 12, flags: FLAG_NORMAL },
        ]);
    });

    it('emits a zero-width line between two consecutive \\n', () => {
        const font = makeFont();
        const out = buf(12);
        const n = TextLayout.computeWrap('A\n\nB', font, 0, 0, 20, out);
        assert.equal(n, 3);
        const mid = readLines(out, n)[1];
        assert.equal(mid.start, 2);
        assert.equal(mid.end, 2);
        assert.equal(mid.width, 0);
    });

    it('does not emit a phantom trailing line for text ending in \\n', () => {
        const font = makeFont();
        const out = buf(8);
        const n = TextLayout.computeWrap('A\n', font, 0, 0, 20, out);
        assert.equal(n, 1);
    });
});

// -----------------------------------------------------------------------------
// Soft-break (wrap at space)
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- soft-break', () => {
    it('wraps at the last space when the next word would overflow', () => {
        const font = makeFont();
        const out = buf(8);
        // "AB CD" -- A,B,space,C,D = 12+12+6+12+12 = 54.
        // boxWidth=30: "AB" (24) fits, next char is space (6) -> 30 fits, next 'C' = 42 > 30 -> wrap.
        const n = TextLayout.computeWrap('AB CD', font, 30, 0, 20, out);
        assert.equal(n, 2);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 2, width: 24, flags: FLAG_NORMAL },  // "AB"
            { start: 3, end: 5, width: 24, flags: FLAG_NORMAL },  // "CD"
        ]);
    });

    it('excludes the breaking space from both sides of the wrap', () => {
        const font = makeFont();
        const out = buf(8);
        const n = TextLayout.computeWrap('A B', font, 12, 0, 20, out);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 1, width: 12, flags: FLAG_NORMAL },  // "A" -- no trailing space
            { start: 2, end: 3, width: 12, flags: FLAG_NORMAL },  // "B" -- no leading space
        ]);
    });
});

// -----------------------------------------------------------------------------
// Hard-break (no space available)
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- hard-break', () => {
    it('breaks mid-word when there is no space to wrap at', () => {
        const font = makeFont();
        const out = buf(8);
        // "AAA" boxWidth=24 -- fits 2 As (24), 3rd overflows -> hard break.
        const n = TextLayout.computeWrap('AAA', font, 24, 0, 20, out);
        assert.equal(n, 2);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 2, width: 24, flags: FLAG_NORMAL },
            { start: 2, end: 3, width: 12, flags: FLAG_NORMAL },
        ]);
    });

    it('keeps a single oversized glyph on its own line when even one glyph overflows', () => {
        const font = makeFont();
        const out = buf(8);
        // boxWidth=8 smaller than one 'A' (12). Each glyph must overflow on its own line.
        const n = TextLayout.computeWrap('AB', font, 8, 0, 20, out);
        assert.equal(n, 2);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 1, width: 12, flags: FLAG_NORMAL },
            { start: 1, end: 2, width: 12, flags: FLAG_NORMAL },
        ]);
    });

    // Regression: hard-break used to leak the previous line's kerning into cursorX.
    it('does NOT inherit kerning from the previous line on hard-break (regression)', () => {
        const font = makeFont([{ first: 65, second: 66, amount: -5 }]); // A->B = -5
        const out = buf(8);
        // "AB" w/ kern -5 -> full width 19. boxWidth=15 forces hard-break between A and B.
        const n = TextLayout.computeWrap('AB', font, 15, 0, 20, out);
        assert.equal(n, 2);
        // Line 2 must be plain "B" with width 12, NOT 7 (12 + the -5 kern from the previous line).
        assert.deepEqual(readLines(out, n)[1], { start: 1, end: 2, width: 12, flags: FLAG_NORMAL });
    });
});

// -----------------------------------------------------------------------------
// Whitespace handling around wraps
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- whitespace handling', () => {
    // Regression: multi-space runs used to emit whitespace-only lines.
    it('skips leading whitespace on the line after a soft-break (regression)', () => {
        const font = makeFont();
        const out = buf(12);
        const n = TextLayout.computeWrap('A   B', font, 12, 0, 20, out);
        assert.equal(n, 2);
        assert.deepEqual(readLines(out, n), [
            { start: 0, end: 1, width: 12, flags: FLAG_NORMAL },
            { start: 4, end: 5, width: 12, flags: FLAG_NORMAL },
        ]);
    });

    it('does not treat a space at the very start of a line as a wrap candidate', () => {
        const font = makeFont();
        const out = buf(8);
        // Leading space + content that overflows by exactly one glyph.
        // Starting with a space means the line begins at idx 0 (' '), then A,B,C...
        // The space at index 0 should NOT be tracked as lastSpace.
        const n = TextLayout.computeWrap(' ABCD', font, 30, 0, 20, out);
        // Expected: line 1 = " AB" or similar (space included since no wrap-eligible space),
        // hard-break before the overflow point.
        // The key invariant: no line of (start, start, 0) ever appears.
        for (const l of readLines(out, n)) {
            assert.ok(l.end > l.start, 'end > start');
        }
    });
});

// -----------------------------------------------------------------------------
// Truncation by boxHeight
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- truncation', () => {
    it('marks the last line FLAG_TRUNCATED when content overflows boxHeight (soft-break)', () => {
        const font = makeFont();
        const out = buf(16);
        // boxHeight=20 fits exactly 1 line at lineHeight=20. Soft-break at the space
        // would produce 2 lines; truncate the first instead.
        const n = TextLayout.computeWrap('AB CD', font, 30, 20, 20, out);
        assert.equal(n, 1);
        assert.equal(readLines(out, n)[0].flags, FLAG_TRUNCATED);
    });

    it('marks the last line FLAG_TRUNCATED when an explicit \\n would overflow boxHeight', () => {
        const font = makeFont();
        const out = buf(16);
        const n = TextLayout.computeWrap('A\nB', font, 0, 20, 20, out);
        assert.equal(n, 1);
        assert.equal(readLines(out, n)[0].flags, FLAG_TRUNCATED);
    });

    it('does NOT mark a truncated line when the explicit \\n is the last char', () => {
        const font = makeFont();
        const out = buf(16);
        // Trailing \n with no follow-on content shouldn't trigger a phantom truncation.
        const n = TextLayout.computeWrap('A\n', font, 0, 20, 20, out);
        assert.equal(n, 1);
        assert.equal(readLines(out, n)[0].flags, FLAG_NORMAL);
    });

    it('uses the latest "content + ellipsis still fits" position for the truncated end', () => {
        const font = makeFont();
        const out = buf(16);
        // boxWidth=60. Ellipsis = 3 * 6 = 18. So "content + 18 <= 60" means content <= 42.
        // "ABCD" widths cumulatively: 12, 24, 36, 48. So content+ellipsis fits through "ABC" (36+18=54)
        // but not "ABCD" (48+18=66). The truncated end should be after "ABC" = index 3.
        const n = TextLayout.computeWrap('ABCDABCD', font, 60, 20, 20, out);
        assert.equal(n, 1);
        const line = readLines(out, n)[0];
        assert.equal(line.flags, FLAG_TRUNCATED);
        assert.equal(line.end, 3);                  // ABC (exclusive end)
        assert.equal(line.width, 36 + 18);          // content + ellipsis
    });

    // Regression: narrow box used to write a truncated line whose width exceeded boxWidth.
    it('falls back to FLAG_NORMAL when the box is too narrow for any "content + ellipsis" (regression)', () => {
        const font = makeFont();
        const out = buf(16);
        // boxWidth=10, smaller than one 'A' (12). Ellipsis can never fit.
        const n = TextLayout.computeWrap('AAA', font, 10, 20, 20, out);
        assert.equal(n, 1);
        const line = readLines(out, n)[0];
        assert.equal(line.flags, FLAG_NORMAL);
        // The line should at worst overflow by the natural one-glyph overflow,
        // not by content+ellipsis.
        assert.ok(line.width <= 12, 'width <= 12');
    });
});

// -----------------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- edge cases', () => {
    it('caps line count at floor(outBuffer.length / 4)', () => {
        const font = makeFont();
        const out = buf(2);  // room for 2 lines
        const n = TextLayout.computeWrap('A\nB\nC\nD', font, 0, 0, 20, out);
        assert.equal(n, 2);
    });

    it('applies scale to widths and the truncation threshold', () => {
        const font = makeFont();
        const out = buf(8);
        // scale=2 doubles all widths: "ABC" -> 72.
        const n = TextLayout.computeWrap('ABC', font, 0, 0, 20, out, 2);
        assert.equal(n, 1);
        assert.equal(readLines(out, n)[0].width, 72);
    });

    it('scales the boxHeight check correctly', () => {
        const font = makeFont();
        const out = buf(8);
        // lineHeight=20, scale=2 -> each line takes 40px visually. boxHeight=40 fits 1 line.
        const n = TextLayout.computeWrap('A\nB', font, 0, 40, 20, out, 2);
        assert.equal(n, 1);
        assert.equal(readLines(out, n)[0].flags, FLAG_TRUNCATED);
    });

    // Regression: non-ASCII chars used to leak into the kerning LUT lookup and produce NaN.
    it('does NOT NaN-corrupt the width when text contains non-ASCII chars (regression)', () => {
        const font = makeFont();
        const out = buf(8);
        // U+4E2D, a CJK ideograph, charCode 20013 -- outside [0..255]. It should contribute
        // zero advance and reset the kerning context, NOT leak into the next iteration.
        const n = TextLayout.computeWrap('A\u4E2DB', font, 0, 0, 20, out);
        assert.equal(n, 1);
        const w = readLines(out, n)[0].width;
        assert.equal(Number.isFinite(w), true);
        assert.equal(w, 24);  // A(12) + U+4E2D(0) + B(12)
    });

    it('treats a missing "." glyph as ellipsisWidth=0 (no truncation indicator possible)', () => {
        // Font WITHOUT '.'.
        const glyphs = new Int16Array(256 * 7);
        const set = (id, w, xa) => { const p = id*7; glyphs[p+2] = w; glyphs[p+6] = xa; };
        set(32, 0, 6);
        set(65, 10, 12); set(66, 10, 12);
        const font = { glyphs, kerning: new Int16Array(65536) };

        const out = buf(8);
        // Force a truncation scenario.
        const n = TextLayout.computeWrap('AB AB AB', font, 24, 20, 20, out);
        assert.equal(n, 1);
        // The truncated end shouldn't add an ellipsis width contribution (none exists).
        // With ellipsisWidth=0, the safe-ellipsis tracker keeps moving forward, so
        // the truncated end is essentially the natural wrap point.
        const line = readLines(out, n)[0];
        assert.equal(Number.isFinite(line.width), true);
        assert.ok(line.width <= 24, 'width <= 24');
    });

    it('produces a layout shape that BitmapFont.drawWrapped can consume', async () => {
        // Smoke test: verify the field order/types match drawWrapped's contract.
        const font = makeFont();
        const out = buf(8);
        const n = TextLayout.computeWrap('AB CD', font, 30, 0, 20, out);
        // Each 4-tuple should be: startIdx (uint), endIdx (uint), lineWidth (float), flags (0|1).
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            assert.equal(Number.isInteger(out[o]), true);          // startIdx
            assert.equal(Number.isInteger(out[o + 1]), true);      // endIdx
            assert.ok(out[o + 1] >= out[o], 'end >= start');       // end >= start
            assert.equal(Number.isFinite(out[o + 2]), true);        // lineWidth
            assert.ok(out[o + 3] === 0 || out[o + 3] === 1, 'flags in {0,1}'); // flags
        }
    });
});

// -----------------------------------------------------------------------------
// Zero-GC contract
// -----------------------------------------------------------------------------

describe('TextLayout.computeWrap -- zero-allocation contract', () => {
    it('does not mutate the input text or the font tables', () => {
        const font = makeFont([{ first: 65, second: 66, amount: -1 }]);
        const out = buf(16);
        const glyphsBefore = Array.from(font.glyphs);
        const kerningBefore = font.kerning[(65 << 8) | 66];

        const text = 'AB CD\nEF';
        TextLayout.computeWrap(text, font, 30, 0, 20, out, 1.5);

        assert.deepEqual(Array.from(font.glyphs), glyphsBefore);
        assert.equal(font.kerning[(65 << 8) | 66], kerningBefore);
    });

    it('can be invoked many times with the same buffer (no internal state)', () => {
        const font = makeFont();
        const out = buf(16);
        for (let i = 0; i < 50; i++) {
            const n = TextLayout.computeWrap('AB CD', font, 30, 0, 20, out);
            assert.equal(n, 2);
        }
    });
});

// -----------------------------------------------------------------------------
// Overflow reporting and countLines (TL1)
// -----------------------------------------------------------------------------

describe('overflow reporting and countLines', () => {
    // Ten words of 3 glyphs each wrap one-per-line at boxWidth 40 -> 10 lines.
    const TEN = 'AAA BBB CCC DDD AAA BBB CCC DDD AAA BBB';
    const THREE = 'AAA BBB CCC';

    it('exports FLAG_OVERFLOW === 2 with all three flags pairwise distinct', () => {
        assert.equal(FLAG_OVERFLOW, 2);
        assert.notEqual(FLAG_NORMAL, FLAG_TRUNCATED);
        assert.notEqual(FLAG_NORMAL, FLAG_OVERFLOW);
        assert.notEqual(FLAG_TRUNCATED, FLAG_OVERFLOW);
    });

    it('flags the last written line FLAG_OVERFLOW when the buffer is too small', () => {
        const font = makeFont();
        const out = buf(1);   // one line of capacity, ten lines of text
        const n = TextLayout.computeWrap(TEN, font, 40, 0, 16, out, 1);
        assert.equal(n, 1);
        assert.equal(out[3], FLAG_OVERFLOW);
    });

    it('makes overflow distinguishable: TL-01 both directions, short text unflagged', () => {
        const font = makeFont();
        const a = buf(3);
        const nA = TextLayout.computeWrap(TEN, font, 40, 0, 16, a, 1);
        const b = buf(3);
        const nB = TextLayout.computeWrap(THREE, font, 40, 0, 16, b, 1);
        assert.equal(nA, 3);
        assert.equal(nB, 3);
        assert.equal(a[11], FLAG_OVERFLOW);   // overflow marked
        assert.equal(b[11], FLAG_NORMAL);      // genuine short layout unflagged
        // The two 12-slot buffers now differ, and differ ONLY in slot 11.
        let diffCount = 0;
        let diffAt = -1;
        for (let j = 0; j < 12; j++) if (a[j] !== b[j]) { diffCount++; diffAt = j; }
        assert.equal(diffCount, 1);
        assert.equal(diffAt, 11);
    });

    it('carries no FLAG_OVERFLOW when the buffer fits exactly', () => {
        const font = makeFont();
        const out = buf(3);
        const n = TextLayout.computeWrap(THREE, font, 40, 0, 16, out, 1);
        assert.equal(n, 3);
        for (let j = 0; j < 12; j++) assert.notEqual(out[j], FLAG_OVERFLOW);
    });

    it('returns 0 and writes nothing for zero-capacity buffers (length 0..3)', () => {
        const font = makeFont();
        for (let cap = 0; cap <= 3; cap++) {
            const out = new Float32Array(cap).fill(-12345);
            const snap = Float32Array.from(out);
            const n = TextLayout.computeWrap(TEN, font, 40, 0, 16, out, 1);
            assert.equal(n, 0);
            assert.deepEqual(Array.from(out), Array.from(snap));   // untouched
        }
    });

    it('countLines agrees with computeWrap on a wrapping case', () => {
        const font = makeFont();
        const big = buf(64);
        const cw = TextLayout.computeWrap(TEN, font, 40, 0, 16, big, 1);
        const cl = TextLayout.countLines(TEN, font, 40, 0, 16, 1);
        assert.equal(cl, cw);
        assert.equal(cl, 10);
    });

    it('countLines agrees with computeWrap on a truncating case (boxHeight 32)', () => {
        const font = makeFont();
        const big = buf(64);
        const cw = TextLayout.computeWrap(TEN, font, 40, 32, 16, big, 1);
        const cl = TextLayout.countLines(TEN, font, 40, 32, 16, 1);
        assert.equal(cl, cw);
    });

    it('sizing round trip never overflows', () => {
        const font = makeFont();
        const need = TextLayout.countLines(TEN, font, 40, 0, 16, 1);
        const out = new Float32Array(4 * need);
        const n = TextLayout.computeWrap(TEN, font, 40, 0, 16, out, 1);
        assert.equal(n, need);
        for (let k = 0; k < n; k++) assert.notEqual(out[k * 4 + 3], FLAG_OVERFLOW);
    });

    it('freezes the TextLayout namespace: assignment throws', () => {
        assert.equal(Object.isFrozen(TextLayout), true);
        assert.throws(() => { TextLayout.computeWrap2 = () => {}; }, TypeError);
    });
});

// -----------------------------------------------------------------------------
// The input door, CRLF and the deliberate behaviours (TL2, 1.2.0)
//
// AR-02 rule, applied to every case below: start from a KNOWN-GOOD tuple the
// same test first asserts does NOT throw, then vary EXACTLY ONE argument. A
// door test whose tuple is wrong in two places passes for the wrong reason.
// -----------------------------------------------------------------------------

describe('input door, CRLF and the deliberate behaviours', () => {
    /**
     * The two known-good tuples every door case varies EXACTLY ONE argument
     * from. `goodA` has boxHeight 0, where `lineHeight <= 0` is legal because
     * the value is never read. `goodB` has boxHeight 64 with lineHeight 16
     * (16 * 1 <= 64, so no zero-line early exit), the only regime in which
     * `lineHeight <= 0` is rejected -- so a lineHeight row varies lineHeight
     * alone, against a base the test first proves is accepted.
     */
    const goodA = () => ({ text: 'AAA BBB', font: makeFont(), bw: 100, bh: 0, lh: 16, out: buf(8), s: 1 });
    const goodB = () => ({ text: 'AAA BBB', font: makeFont(), bw: 100, bh: 64, lh: 16, out: buf(8), s: 1 });
    const good = goodA;
    const call = (g) => TextLayout.computeWrap(g.text, g.font, g.bw, g.bh, g.lh, g.out, g.s);
    /** Assert a TextLayoutError whose message contains every substring. */
    const doorThrows = (fn, ...needs) => {
        assert.throws(fn, (err) => {
            assert.ok(err instanceof TextLayoutError, 'expected TextLayoutError, got ' + err.name);
            assert.doesNotMatch(err.message, /Cannot read properties/);
            for (const s of needs) assert.ok(err.message.includes(s), 'message must contain ' + s + ': ' + err.message);
            return true;
        });
    };

    it('exports TextLayoutError as an Error subclass with the documented name', () => {
        const e = new TextLayoutError('x');
        assert.ok(e instanceof Error);
        assert.ok(e instanceof TextLayoutError);
        assert.equal(e.name, 'TextLayoutError');
        assert.equal(e.message, 'x');
    });

    it('rejects a non-string text: 12345, null, undefined, ["A"]', () => {
        assert.equal(call(good()), 1);   // the known-good tuple is accepted
        for (const bad of [12345, null, undefined, ['A']]) {
            const g = good(); g.text = bad;
            doorThrows(() => call(g), 'text', 'string');
        }
    });

    it('rejects a font that is missing or is not an object: {}, null, undefined', () => {
        assert.equal(call(good()), 1);
        const empty = good(); empty.font = {};
        doorThrows(() => call(empty), 'font.glyphs');
        for (const bad of [null, undefined]) {
            const g = good(); g.font = bad;
            doorThrows(() => call(g), 'font');
        }
    });

    it('rejects short glyph and kerning tables, naming the received and required lengths', () => {
        assert.equal(call(good()), 1);
        const shortG = good();
        shortG.font = { glyphs: new Int16Array(700), kerning: new Int16Array(65536) };
        doorThrows(() => call(shortG), 'font.glyphs', '700', '1792');
        const shortK = good();
        shortK.font = { glyphs: makeFont().glyphs, kerning: new Int16Array(4) };
        doorThrows(() => call(shortK), 'font.kerning', '4', '65536');
    });

    it('rejects scale NaN / Infinity / 0 / -1 and accepts scale 2', () => {
        assert.equal(call(good()), 1);
        for (const bad of [NaN, Infinity, -Infinity]) {
            const g = good(); g.s = bad;
            doorThrows(() => call(g), 'scale', 'finite');
        }
        for (const bad of [0, -1]) {
            const g = good(); g.s = bad;
            doorThrows(() => call(g), 'scale', '> 0');
        }
        const two = good(); two.s = 2;
        assert.equal(call(two), 2);   // 'AAA BBB' at scale 2 no longer fits 100px
    });

    it('rejects boxWidth -1 / -100 / NaN / -Infinity, and 0 still means no limit', () => {
        assert.equal(call(good()), 1);
        for (const bad of [-1, -100]) {
            const g = good(); g.bw = bad;
            doorThrows(() => call(g), 'boxWidth', 'negative');
        }
        for (const bad of [NaN, -Infinity, Infinity]) {
            const g = good(); g.bw = bad;
            doorThrows(() => call(g), 'boxWidth', 'finite');
        }
        const zero = good(); zero.bw = 0;
        assert.equal(call(zero), 1);
        assert.deepEqual(readLines(zero.out, 1), [{ start: 0, end: 7, width: 78, flags: FLAG_NORMAL }]);
    });

    it('rejects boxHeight NaN and negative, and 0 still means no truncation', () => {
        assert.equal(call(good()), 1);
        for (const bad of [-1, -100]) {
            const g = good(); g.bh = bad;
            doorThrows(() => call(g), 'boxHeight', 'negative');
        }
        for (const bad of [NaN, Infinity, -Infinity]) {
            const g = good(); g.bh = bad;
            doorThrows(() => call(g), 'boxHeight', 'finite');
        }
        // `0` still means no truncation: vary text alone, boxHeight is already 0.
        const five = good(); five.text = 'A\nB\nC\nD\nE';
        assert.equal(call(five), 5);
    });

    it('rejects lineHeight NaN always, but 0 and -16 only when boxHeight > 0', () => {
        // BOTH bases are proved accepted before a single rejection is tested.
        assert.equal(call(goodA()), 1);
        assert.equal(call(goodB()), 1);
        // NaN throws from either base -- one argument varied, twice.
        const nanA = goodA(); nanA.lh = NaN;
        doorThrows(() => call(nanA), 'lineHeight', 'finite');
        const nanB = goodB(); nanB.lh = NaN;
        doorThrows(() => call(nanB), 'lineHeight', 'finite');
        for (const bad of [0, -16]) {
            // From base B (boxHeight 64), vary lineHeight alone -> throws.
            const withBox = goodB(); withBox.lh = bad;
            doorThrows(() => call(withBox), 'lineHeight', '> 0');
            // From base A (boxHeight 0), vary lineHeight alone -> legal, because
            // the value is never read. This is the half that proves the door is
            // conditional and not blanket.
            const noBox = goodA(); noBox.lh = bad;
            assert.equal(call(noBox), 1);
        }
    });

    it('rejects an outBuffer that is not a Float32Array', () => {
        assert.equal(call(good()), 1);
        const font = makeFont();
        for (const bad of [new Int32Array(16), new Float64Array(16), new Array(16).fill(0), undefined, null]) {
            assert.throws(
                () => TextLayout.computeWrap('AAA BBB', font, 100, 0, 16, bad, 1),
                (err) => {
                    assert.ok(err instanceof TextLayoutError);
                    assert.ok(err.message.includes('outBuffer'));
                    assert.ok(err.message.includes('Float32Array'));
                    return true;
                },
            );
        }
    });

    it('shares the door with countLines, same messages, minus the outBuffer check', () => {
        // Same two bases, same one-argument-at-a-time rule, no outBuffer.
        const cl = (g) => TextLayout.countLines(g.text, g.font, g.bw, g.bh, g.lh, g.s);
        assert.equal(cl(goodA()), 1);
        assert.equal(cl(goodB()), 1);
        const badText = goodA(); badText.text = 12345;
        doorThrows(() => cl(badText), 'text', 'string');
        const badFont = goodA(); badFont.font = null;
        doorThrows(() => cl(badFont), 'font');
        const badBw = goodA(); badBw.bw = -100;
        doorThrows(() => cl(badBw), 'boxWidth', 'negative');
        const badScale = goodA(); badScale.s = NaN;
        doorThrows(() => cl(badScale), 'scale', 'finite');
        const badLh = goodB(); badLh.lh = 0;   // one argument off base B
        doorThrows(() => cl(badLh), 'lineHeight', '> 0');
        // The messages are the SAME strings computeWrap produces, not lookalikes:
        // one tuple, one varied argument, both entry points.
        const g = goodA(); g.bw = -100;
        const viaWrap = (() => { try { call(g); } catch (e) { return e.message; } })();
        const viaCount = (() => { try { cl(g); } catch (e) { return e.message; } })();
        assert.equal(viaCount, viaWrap);
        assert.match(viaCount, /boxWidth/);
    });

    it('returns 0 and leaves the buffer bit-identical when the box is under one line', () => {
        const font = makeFont();
        const out = buf(8).fill(-999);
        const snapshot = Float32Array.from(out);
        assert.equal(TextLayout.computeWrap('AAA', font, 0, 8, 16, out, 1), 0);
        assert.deepEqual(Array.from(out), Array.from(snapshot));
        assert.equal(TextLayout.countLines('AAA', font, 0, 8, 16, 1), 0);
        // The boundary is `>`, not `>=`: a box exactly one line tall still emits.
        assert.equal(TextLayout.computeWrap('AAA', font, 0, 16, 16, out, 1), 1);
        // And it is lineHeight * scale that is measured, not lineHeight.
        assert.equal(TextLayout.computeWrap('AAA', font, 0, 31, 16, out, 2), 0);
    });

    it('lays CRLF out identically to LF and keeps a lone CR inside the range', () => {
        const font = makeFont();
        assert.equal(font.glyphs[13 * 7 + 6], 0, 'CR must have zero advance or the width pins measure the atlas');
        const lf = buf(8);
        const crlf = buf(8);
        assert.equal(TextLayout.computeWrap('AAA\nBBB', font, 0, 0, 16, lf, 1), 2);
        assert.equal(TextLayout.computeWrap('AAA\r\nBBB', font, 0, 0, 16, crlf, 1), 2);
        assert.deepEqual(readLines(lf, 2), [
            { start: 0, end: 3, width: 36, flags: FLAG_NORMAL },
            { start: 4, end: 7, width: 36, flags: FLAG_NORMAL },
        ]);
        assert.deepEqual(readLines(crlf, 2), [
            { start: 0, end: 3, width: 36, flags: FLAG_NORMAL },
            { start: 5, end: 8, width: 36, flags: FLAG_NORMAL },
        ]);
        // A LONE CR is not a terminator: one line, the CR inside the range.
        const lone = buf(4);
        assert.equal(TextLayout.computeWrap('AAA\rBBB', font, 0, 0, 16, lone, 1), 1);
        assert.deepEqual(readLines(lone, 1), [{ start: 0, end: 7, width: 72, flags: FLAG_NORMAL }]);
        assert.equal(TextLayout.countLines('AAA\r\nBBB', font, 0, 0, 16, 1), 2);
        // The TRUNCATING arm of the newline branch is a SECOND emitting path,
        // and boxHeight 0 never reaches it. Swept, and pinned to the LF run by
        // construction rather than to copied literals.
        for (const bh of [16, 32, 48, 64]) {
            const lfT = buf(16);
            const crT = buf(16);
            const nL = TextLayout.computeWrap('AAA\nBBB', font, 0, bh, 16, lfT, 1);
            const nC = TextLayout.computeWrap('AAA\r\nBBB', font, 0, bh, 16, crT, 1);
            assert.equal(nC, nL, 'boxHeight ' + bh + ': CRLF line count must match LF');
            for (let k = 0; k < nL; k++) {
                const shift = lfT[k * 4] > 3 ? 1 : 0;
                assert.deepEqual(
                    [crT[k * 4], crT[k * 4 + 1], crT[k * 4 + 2], crT[k * 4 + 3]],
                    [lfT[k * 4] + shift, lfT[k * 4 + 1] + shift, lfT[k * 4 + 2], lfT[k * 4 + 3]],
                    'boxHeight ' + bh + ' line ' + k + ': CRLF must match LF shifted by ' + shift,
                );
            }
            assert.equal(TextLayout.countLines('AAA\r\nBBB', font, 0, bh, 16, 1), nC);
        }
        // The exact row that was broken: boxHeight 16 truncates to one line and
        // endIdx must be 3, not 4 -- index 3 IS the CR. Width 54 is content 36
        // plus this font's 18px ellipsis allowance (TL-12), not 36: `makeFont`
        // gives '.' a real width, unlike the torture stub.
        const trunc = buf(4);
        assert.equal(TextLayout.computeWrap('AAA\r\nBBB', font, 0, 16, 16, trunc, 1), 1);
        assert.deepEqual(readLines(trunc, 1), [{ start: 0, end: 3, width: 54, flags: FLAG_TRUNCATED }]);
    });

    it('drops the phantom line but keeps a deliberate blank line', () => {
        const font = makeFont();
        // The phantom: trailing whitespace soft-breaks immediately before a \n.
        const ph = buf(8);
        assert.equal(TextLayout.computeWrap('AAA \nBBB', font, 40, 0, 16, ph, 1), 2);
        assert.deepEqual(readLines(ph, 2), [
            { start: 0, end: 3, width: 36, flags: FLAG_NORMAL },
            { start: 5, end: 8, width: 36, flags: FLAG_NORMAL },
        ]);
        assert.equal(TextLayout.countLines('AAA \nBBB', font, 40, 0, 16, 1), 2);
        // The other direction, and it is the whole difference between a fix and
        // a regression: a blank line the author wrote survives, because the
        // character before lineStart is 10, not 32.
        const blank = buf(8);
        assert.equal(TextLayout.computeWrap('AAA\n\nBBB', font, 0, 0, 16, blank, 1), 3);
        assert.deepEqual(readLines(blank, 3), [
            { start: 0, end: 3, width: 36, flags: FLAG_NORMAL },
            { start: 4, end: 4, width: 0, flags: FLAG_NORMAL },
            { start: 5, end: 8, width: 36, flags: FLAG_NORMAL },
        ]);
        assert.equal(TextLayout.countLines('AAA\n\nBBB', font, 0, 0, 16, 1), 3);
    });

    it('preserves leading spaces, emits an over-wide glyph, and pins the 2^24 ceiling', () => {
        const font = makeFont();
        // TL-14, DELIBERATE: indentation is content, not noise to be trimmed.
        const sp = buf(4);
        assert.equal(TextLayout.computeWrap('   ', font, 0, 0, 16, sp, 1), 1);
        assert.deepEqual(readLines(sp, 1), [{ start: 0, end: 3, width: 18, flags: FLAG_NORMAL }]);
        assert.equal(TextLayout.computeWrap('   AAA', font, 0, 0, 16, sp, 1), 1);
        assert.deepEqual(readLines(sp, 1), [{ start: 0, end: 6, width: 54, flags: FLAG_NORMAL }]);
        // TL-24, DELIBERATE: one glyph per line beats an infinite loop.
        const wide = buf(4);
        assert.equal(TextLayout.computeWrap('A', font, 4, 0, 16, wide, 1), 1);
        assert.deepEqual(readLines(wide, 1), [{ start: 0, end: 1, width: 12, flags: FLAG_NORMAL }]);
        // TL-15, DOCUMENTED: indices are Float32 and exact only to 16777216.
        assert.equal(Math.fround(16777217), 16777216);
        assert.equal(Math.fround(16777219), 16777220);
        const slot = new Float32Array(1);
        slot[0] = 16777217;
        assert.equal(slot[0], 16777216);
    });
});
