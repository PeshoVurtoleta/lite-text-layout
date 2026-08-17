/**
 * @zakkster/lite-text-layout -- Zero-GC Bitmap Font Word Wrapper
 *
 * Computes line breaks and per-line widths for ASCII bitmap text, writing the
 * result into a caller-owned `Float32Array` so no allocation happens on the
 * hot path. The output is the layout buffer that `@zakkster/lite-bmfont`'s
 * `BitmapFont.drawWrapped` consumes directly.
 *
 * Stride: 4 floats per line -> `[startIdx, endIdx, lineWidth, flags]`
 * Flags:  `0` = normal line, `1` = truncated (renderer appends "...")
 */

/** Normal line -- no truncation marker. */
export const FLAG_NORMAL = 0;
/** Truncated line -- the renderer should append "..." after the line content. */
export const FLAG_TRUNCATED = 1;

/** Package version. Kept in sync with package.json and llms.txt. */
export const VERSION = '1.0.2';
export const TextLayout = {
    /**
     * Compute line breaks for `text` against a bounding box.
     *
     * The output is written into `outBuffer` as packed 4-tuples
     * `[startIdx, endIdx, lineWidth, flags]` per line. The buffer's capacity
     * caps the line count at `floor(outBuffer.length / 4)`; extra content is
     * silently dropped.
     *
     * Wrapping rules:
     * - Soft-break at the last space (` `, code 32) when adding the next glyph
     *   would exceed `boxWidth`. The breaking space is excluded from both
     *   sides, and runs of leading whitespace on the next line are skipped.
     * - Hard-break (mid-word) when no space is available within the line.
     * - Explicit `\n` (code 10) starts a new line and is not rendered.
     *
     * Truncation rules (only when `boxHeight > 0`):
     * - If the next line would overflow `boxHeight`, the current line is
     *   flagged `FLAG_TRUNCATED` (renderer appends "..."), and the function
     *   returns immediately.
     * - The library tracks the last position on the current line where
     *   content+ellipsis still fits; the truncated line ends there.
     * - If the box is so narrow that no position fits content+ellipsis at all,
     *   the line falls back to a plain `FLAG_NORMAL` line at the wrap point --
     *   no ellipsis is written. The renderer will not draw it either.
     *
     * Atlas requirements: ASCII `'.'` (code 46) is read for the ellipsis
     * width. If `'.'` is missing from the font, `ellipsisWidth` is treated as
     * `0` (no truncation indicator possible).
     *
     * Non-ASCII chars (`id >= 256`) contribute zero advance and reset the
     * kerning context -- same behavior as `BitmapFont.draw`.
     *
     * @param {string} text                        Source text.
     * @param {{ glyphs: Int16Array, kerning: Int16Array }} font
     *   Object exposing the flat glyph/kerning tables -- a `BitmapFont`
     *   instance from `@zakkster/lite-bmfont` works directly.
     * @param {number} boxWidth                    Container width in px. `0` = no horizontal limit.
     * @param {number} boxHeight                   Container height in px. `0` = no vertical limit (no truncation).
     * @param {number} lineHeight                  Line advance in px (at scale=1) -- usually `font.lineHeight`.
     * @param {Float32Array} outBuffer             Pre-allocated, length >= `lineCount * 4`.
     * @param {number} [scale=1.0]                 Font scale multiplier applied to widths.
     * @returns {number}                           Number of lines written.
     */
    computeWrap(text, font, boxWidth, boxHeight, lineHeight, outBuffer, scale = 1.0) {
        const len = text.length;
        if (len === 0) return 0;

        const maxLines = (outBuffer.length >> 2) | 0;
        if (maxLines === 0) return 0;

        let lineCount = 0;
        let ptr = 0;

        let lineStart = 0;
        let lastSpace = -1;
        let lastSpaceWidth = 0;

        let cursorX = 0;
        let prevId = -1;

        // Precompute ellipsis geometry (ASCII 46 is '.'). If the glyph isn't in
        // the atlas its `width` is 0 -> treat ellipsis as 0px (no truncation marker).
        const dotPtr = 46 * 7;
        const dotAdvance = font.glyphs[dotPtr + 2] > 0 ? font.glyphs[dotPtr + 6] * scale : 0;
        const ellipsisWidth = dotAdvance * 3;

        // Latest position on the current line where "content up to and
        // including char i, plus ellipsis" still fits within boxWidth.
        let lastSafeEllipsisIdx = -1;
        let lastSafeEllipsisWidth = 0;

        for (let i = 0; i < len; i++) {
            if (lineCount >= maxLines) break;

            const id = text.charCodeAt(i);

            // -- 1. Explicit newline -----------------------------------------
            if (id === 10) {
                // Truncate if the line AFTER this one wouldn't fit, but only
                // when there's still text past the newline.
                if (boxHeight > 0 && (lineCount + 2) * lineHeight * scale > boxHeight && i < len - 1) {
                    const safe = lastSafeEllipsisIdx >= lineStart && lastSafeEllipsisIdx !== -1;
                    outBuffer[ptr++] = lineStart;
                    outBuffer[ptr++] = safe ? lastSafeEllipsisIdx + 1 : i;
                    outBuffer[ptr++] = safe ? lastSafeEllipsisWidth + ellipsisWidth : cursorX;
                    outBuffer[ptr++] = safe ? FLAG_TRUNCATED : FLAG_NORMAL;
                    return lineCount + 1;
                }

                outBuffer[ptr++] = lineStart;
                outBuffer[ptr++] = i;
                outBuffer[ptr++] = cursorX;
                outBuffer[ptr++] = FLAG_NORMAL;
                lineCount++;

                lineStart = i + 1;
                lastSpace = -1;
                cursorX = 0;
                prevId = -1;
                lastSafeEllipsisIdx = -1;
                continue;
            }

            // -- 2. Glyph advance + kerning ----------------------------------
            let advance = 0;
            if (id >= 0 && id < 256) {
                if (prevId !== -1) advance += font.kerning[(prevId << 8) | id] * scale;
                advance += font.glyphs[id * 7 + 6] * scale;
            }

            // -- 3. Track the latest "content + ellipsis still fits" position.
            // boxWidth === 0 means infinite horizontal room -- every position is safe.
            if (boxWidth === 0 || cursorX + advance + ellipsisWidth <= boxWidth) {
                lastSafeEllipsisIdx = i;
                lastSafeEllipsisWidth = cursorX + advance;
            }

            // Mark soft-break candidate. Don't track a space at the very start
            // of a line -- using it would write an empty line.
            if (id === 32 && i > lineStart) {
                lastSpace = i;
                lastSpaceWidth = cursorX;
            }

            // -- 4. Wrap / overflow ------------------------------------------
            if (boxWidth > 0 && cursorX + advance > boxWidth && i > lineStart) {

                // Truncation: will the NEXT line exceed boxHeight?
                if (boxHeight > 0 && (lineCount + 2) * lineHeight * scale > boxHeight) {
                    const safe = lastSafeEllipsisIdx >= lineStart && lastSafeEllipsisIdx !== -1;
                    outBuffer[ptr++] = lineStart;
                    outBuffer[ptr++] = safe ? lastSafeEllipsisIdx + 1 : i;
                    outBuffer[ptr++] = safe ? lastSafeEllipsisWidth + ellipsisWidth : cursorX;
                    // If no position could fit content+ellipsis, fall back to
                    // an un-flagged line so the renderer doesn't draw dots
                    // that would themselves overflow the box.
                    outBuffer[ptr++] = safe ? FLAG_TRUNCATED : FLAG_NORMAL;
                    return lineCount + 1;
                }

                if (lastSpace !== -1) {
                    // Soft-break at the last space.
                    outBuffer[ptr++] = lineStart;
                    outBuffer[ptr++] = lastSpace;
                    outBuffer[ptr++] = lastSpaceWidth;
                    outBuffer[ptr++] = FLAG_NORMAL;
                    lineCount++;

                    // Eat any run of leading spaces on the next line so we
                    // don't emit a whitespace-only line.
                    let nextStart = lastSpace + 1;
                    while (nextStart < len && text.charCodeAt(nextStart) === 32) nextStart++;

                    lineStart = nextStart;
                    i = nextStart - 1;       // loop's ++ will land on nextStart
                    lastSpace = -1;
                    cursorX = 0;
                    prevId = -1;
                    lastSafeEllipsisIdx = -1;
                    continue;
                }

                // Hard-break -- no space on this line. The current char goes
                // on the new line with a fresh kerning context.
                outBuffer[ptr++] = lineStart;
                outBuffer[ptr++] = i;
                outBuffer[ptr++] = cursorX;
                outBuffer[ptr++] = FLAG_NORMAL;
                lineCount++;

                lineStart = i;
                lastSpace = -1;
                prevId = -1;
                lastSafeEllipsisIdx = -1;

                // Re-seed cursorX with just this glyph's xadvance (no
                // inherited kerning from the line we just flushed).
                cursorX = (id >= 0 && id < 256) ? font.glyphs[id * 7 + 6] * scale : 0;
                prevId = (id >= 0 && id < 256) ? id : -1;

                // Track this as a safe ellipsis position too, since it's the
                // first content on the new line.
                if (boxWidth > 0 && cursorX + ellipsisWidth <= boxWidth) {
                    lastSafeEllipsisIdx = i;
                    lastSafeEllipsisWidth = cursorX;
                }
                continue;
            }

            cursorX += advance;
            // Don't let a non-ASCII id leak into the next iteration's kerning
            // lookup -- `(non-ascii << 8) | id` overruns the 64K LUT.
            prevId = (id >= 0 && id < 256) ? id : -1;
        }

        // -- 5. Flush remainder ----------------------------------------------
        if (lineCount < maxLines && lineStart < len) {
            outBuffer[ptr++] = lineStart;
            outBuffer[ptr++] = len;
            outBuffer[ptr++] = cursorX;
            outBuffer[ptr++] = FLAG_NORMAL;
            lineCount++;
        }

        return lineCount;
    }
};
