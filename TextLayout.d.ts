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
/** Truncated line -- the renderer should append "..." after the line content. */
export const FLAG_TRUNCATED: 1;

/** Package version. Kept in sync with package.json and llms.txt. */
export const VERSION: '1.0.2';

/** One of the two flag values written into the layout buffer. */
export type LineFlag = typeof FLAG_NORMAL | typeof FLAG_TRUNCATED;

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
    /** {@link FLAG_NORMAL} or {@link FLAG_TRUNCATED}. */
    flags: LineFlag;
}

export const TextLayout: {
    /**
     * Compute line breaks for `text` against a bounding box, writing the
     * result into `outBuffer` as packed 4-tuples
     * `[startIdx, endIdx, lineWidth, flags]` per line.
     *
     * Capacity caps the line count at `floor(outBuffer.length / 4)` -- extra
     * content is silently dropped.
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
};
