/**
 * @zakkster/lite-text-layout
 * Zero-GC Bitmap Font Word Wrapper.
 *
 * Computes line breaks and per-line widths for ASCII bitmap text into a
 * caller-owned Float32Array. The output is the layout buffer that
 * `BitmapFont.drawWrapped` from `@zakkster/lite-bmfont` consumes directly.
 */

/** Normal line -- no truncation marker. */
export const FLAG_NORMAL: 0;
/** Truncated line -- the TEXT did not fit the BOX; the renderer appends "...". */
export const FLAG_TRUNCATED: 1;
/**
 * Overflow line -- the BUFFER did not fit the TEXT. Set on the last written line
 * when `outBuffer` was too small; a caller bug, distinct from `FLAG_TRUNCATED`.
 * See decisions/0001-flag-overflow.md and `countLines`.
 */
export const FLAG_OVERFLOW: 2;

/** Package version. Kept in sync with package.json and llms.txt. */
export const VERSION: '1.2.1';

/**
 * Thrown by both entry points when an argument fails the input door (1.2.0).
 *
 * The message names the argument, what it received and what is required --
 * `Cannot read properties of undefined (reading '324')` from inside the
 * wrapping loop told the caller nothing. Before 1.2.0 none of these threw:
 * `boxWidth = NaN` silently meant "no horizontal limit", `scale = NaN` silently
 * disabled wrapping, and a short glyph table silently made every width `NaN`.
 * See decisions/0002-input-door.md.
 */
export class TextLayoutError extends Error {
    name: 'TextLayoutError';
    constructor(message: string);
}

/**
 * One of the three flag values written into the layout buffer.
 *
 * Law 6 -- flags are a value space; compare by equality, never by truthiness.
 * `if (flags === FLAG_TRUNCATED)`, never `if (flags)`. The domain may widen in a
 * MINOR release; only equality against a named constant is stable across that.
 */
export type LineFlag = typeof FLAG_NORMAL | typeof FLAG_TRUNCATED | typeof FLAG_OVERFLOW;

/**
 * The subset of `BitmapFont` that `computeWrap` reads. Any object with these
 * two flat tables works -- a `BitmapFont` instance from `@zakkster/lite-bmfont`
 * matches structurally and can be passed in directly.
 *
 * - `glyphs`:  256 x 7 Int16. Slot 6 of `id * 7` is `xadvance`.
 * - `kerning`: 65536 Int16. Indexed by `(prevId << 8) | id`.
 */
export interface BitmapFontData {
    glyphs: Int16Array;
    kerning: Int16Array;
}

/**
 * Memory layout of one line in the output buffer -- 4 consecutive Float32s.
 * Provided as a documentation aid; the buffer is a flat `Float32Array` at
 * runtime, not an array of objects.
 */
export interface LayoutLine {
    /** Start char index into `text` (inclusive). Exact to 2^24 = 16777216. */
    startIdx: number;
    /** End char index into `text` (exclusive). Exact to 2^24 = 16777216. */
    endIdx: number;
    /**
     * Pixel width of the line. For a {@link FLAG_TRUNCATED} line this INCLUDES
     * the three-dot ellipsis allowance, so it measures wider than the glyphs in
     * `[startIdx, endIdx)`.
     */
    lineWidth: number;
    /** {@link FLAG_NORMAL}, {@link FLAG_TRUNCATED} or {@link FLAG_OVERFLOW}. */
    flags: LineFlag;
}

export const TextLayout: {
    /**
     * Compute line breaks for `text` against a bounding box, writing the
     * result into `outBuffer` as packed 4-tuples
     * `[startIdx, endIdx, lineWidth, flags]` per line.
     *
     * Capacity caps the line count at `floor(outBuffer.length / 4)`. When the
     * buffer is too small, the last written line's flags slot is set to
     * {@link FLAG_OVERFLOW} (iff `countLines(...) > floor(outBuffer.length / 4)`);
     * the partial layout is a true prefix of the unbounded result. A
     * zero-capacity buffer (length 0..3) returns `0` and writes nothing -- detect
     * it as `n === 0 && text.length > 0`. Use {@link countLines} to size a buffer
     * that can never overflow.
     *
     * Wrapping notes that surprise callers:
     * - Leading whitespace is skipped ONLY AFTER A SOFT BREAK. At the start of
     *   the text, and immediately after an explicit `\n`, it is CONTENT:
     *   `'   '` is one line of width `3 * space`, not an empty layout.
     * - A `\r` immediately preceding a `\n` is a line terminator and is
     *   EXCLUDED from the emitted range, so range and `lineWidth` agree. A LONE
     *   `\r` is not a terminator: it stays in range with its atlas advance.
     *   CRLF lays out identically to LF whenever the CR's own advance does not
     *   force a wrap -- always true for a real atlas, where a CR is not a
     *   printable glyph. A hand-rolled atlas giving glyph 13 a non-zero advance
     *   in a box narrow enough to wrap on it is out of contract; the CR is
     *   still never inside an emitted range.
     * - A single glyph wider than `boxWidth` is emitted as an OVER-WIDE line,
     *   unflagged. One glyph per line is what makes the loop terminate.
     * - A truncated line's `lineWidth` INCLUDES the three-dot ellipsis
     *   allowance, so a `FLAG_TRUNCATED` line measures wider than its range.
     * - `boxHeight > 0` with `lineHeight * scale > boxHeight` returns `0` and
     *   writes NOTHING: a box that cannot hold one line holds no lines.
     * - `startIdx`/`endIdx` are Float32 slots, exact only to 2^24 = 16777216.
     *   A longer text is out of domain.
     *
     * The range contract, drift-guarded byte-for-byte across four surfaces
     * (test/TextLayout.drift.test.js):
     *
     * RANGE-CONTRACT v1
     * startIdx is inclusive and endIdx is exclusive, and both are indices into the original string.
     * The breaking space is excluded from both sides.
     * Leading whitespace is skipped only after a soft break; it is content at text start and immediately after an explicit newline.
     * lineWidth is at the rendered scale and includes the ellipsis allowance on a FLAG_TRUNCATED line.
     * END RANGE-CONTRACT
     *
     * @param text        Source string.
     * @param font        Object exposing the flat glyph/kerning tables; a
     *                    `BitmapFont` instance works.
     * @param boxWidth    Container width in px. `0` = no horizontal limit.
     * @param boxHeight   Container height in px. `0` = no vertical limit
     *                    (no truncation will ever be emitted).
     * @param lineHeight  Line advance in px (at scale=1), usually `font.lineHeight`.
     * @param outBuffer   Pre-allocated `Float32Array`, length >= `lineCount * 4`.
     * @param scale       Font scale multiplier applied to all widths. Finite and
     *                    `> 0`. Defaults to `1`.
     * @returns           Number of lines written. `0` when the box cannot hold one line.
     * @throws {TextLayoutError} `text` is not a string; `font` is missing or
     *   `font.glyphs` / `font.kerning` is shorter than 1792 / 65536; `boxWidth`
     *   or `boxHeight` is non-finite or negative; `lineHeight` is non-finite,
     *   or `<= 0` while `boxHeight > 0`; `scale` is non-finite or `<= 0`;
     *   `outBuffer` is not a `Float32Array`. The check is `instanceof`, so a
     *   CROSS-REALM `Float32Array` (a `vm` context, an iframe) is rejected --
     *   deliberately, since the alternative accepts anything that renames its
     *   constructor. Copy into a same-realm view.
     */
    computeWrap(
        text: string,
        font: BitmapFontData,
        boxWidth: number,
        boxHeight: number,
        lineHeight: number,
        outBuffer: Float32Array,
        scale?: number
    ): number;

    /**
     * Count the lines {@link computeWrap} would write into an unbounded buffer --
     * same parameters, same order, minus `outBuffer`. Size a buffer that can
     * never overflow as `new Float32Array(countLines(...) * 4)`.
     *
     * @param text        Source string.
     * @param font        Object exposing the flat glyph/kerning tables.
     * @param boxWidth    Container width in px. `0` = no horizontal limit.
     * @param boxHeight   Container height in px. `0` = no vertical limit.
     * @param lineHeight  Line advance in px (at scale=1).
     * @param scale       Font scale multiplier. Finite and `> 0`. Defaults to `1`.
     * @returns           Number of lines an unbounded `computeWrap` would write.
     *                    `0` when the box cannot hold one line.
     * @throws {TextLayoutError} The SAME door as {@link computeWrap}, through
     *   the same shared validator and with the same messages -- minus the
     *   `outBuffer` check, which has no argument to check here.
     */
    countLines(
        text: string,
        font: BitmapFontData,
        boxWidth: number,
        boxHeight: number,
        lineHeight: number,
        scale?: number
    ): number;
};
