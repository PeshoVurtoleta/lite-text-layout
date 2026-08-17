import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED } from '../TextLayout.js';

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
