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
export const VERSION: '1.1.0';

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
    /** Start char index into `text` (inclusive). */
    startIdx: number;
    /** End char index into `text` (exclusive). */
    endIdx: number;
    /** Pixel width of the line, including any ellipsis allowance. */
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
     * @param text        Source string.
     * @param font        Object exposing the flat glyph/kerning tables; a
     *                    `BitmapFont` instance works.
     * @param boxWidth    Container width in px. `0` = no horizontal limit.
     * @param boxHeight   Container height in px. `0` = no vertical limit
     *                    (no truncation will ever be emitted).
     * @param lineHeight  Line advance in px (at scale=1), usually `font.lineHeight`.
     * @param outBuffer   Pre-allocated `Float32Array`, length >= `lineCount * 4`.
     * @param scale       Font scale multiplier applied to all widths. Defaults to `1`.
     * @returns           Number of lines written.
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
     * @param scale       Font scale multiplier. Defaults to `1`.
     * @returns           Number of lines an unbounded `computeWrap` would write.
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
