/**
 * @zakkster/lite-text-layout -- Zero-GC Bitmap Font Word Wrapper
 *
 * Computes line breaks and per-line widths for ASCII bitmap text, writing the
 * result into a caller-owned `Float32Array` so no allocation happens on the
 * hot path. The output is the layout buffer that `@zakkster/lite-bmfont`'s
 * `BitmapFont.drawWrapped` consumes directly.
 *
 * Stride: 4 floats per line -> `[startIdx, endIdx, lineWidth, flags]`
 * Flags:  `0` = normal line, `1` = truncated (the TEXT did not fit the BOX --
 *         renderer appends "..."), `2` = overflow (the BUFFER did not fit the
 *         TEXT -- a caller bug, see FLAG_OVERFLOW and decisions/0001-flag-overflow.md).
 *         Flags are a value space: compare by equality, never by truthiness.
 */

/** Normal line -- no truncation marker. */
export const FLAG_NORMAL = 0;
/** Truncated line -- the renderer should append "..." after the line content. */
export const FLAG_TRUNCATED = 1;
/**
 * Overflow line -- the last written line when the buffer was too small for the
 * text. `FLAG_TRUNCATED` means "the TEXT did not fit the BOX" (a designed
 * outcome, ellipsis included); `FLAG_OVERFLOW` means "the BUFFER did not fit the
 * TEXT" (a caller bug being reported). They are never both present in one call.
 * See decisions/0001-flag-overflow.md and `countLines` for sizing the buffer so
 * this never fires.
 */
export const FLAG_OVERFLOW = 2;

/** Package version. Kept in sync with package.json and llms.txt. */
export const VERSION = '1.1.0';
export const TextLayout = {
    /**
     * Compute line breaks for `text` against a bounding box.
     *
     * The output is written into `outBuffer` as packed 4-tuples
     * `[startIdx, endIdx, lineWidth, flags]` per line. The buffer's capacity
     * caps the line count at `floor(outBuffer.length / 4)`.
     *
     * Overflow contract (an undersized buffer must say so):
     * - `FLAG_OVERFLOW` (2) is set on the flags slot of the LAST written line if
     *   and only if the same call against an unbounded buffer would have produced
     *   MORE lines -- equivalently, iff `countLines(...) > floor(outBuffer.length / 4)`.
     * - The partial layout is preserved and is a true PREFIX: for capacity `m`
     *   lines the output equals the first `m` lines of the unbounded run,
     *   byte-identical except slot `4m - 1`, which carries `FLAG_OVERFLOW`.
     * - Zero capacity (buffer length 0..3, no whole stride) returns `0` and
     *   writes NOTHING -- there is no flags slot to signal into. A caller detects
     *   a swallowed non-empty layout as `n === 0 && text.length > 0`. It does not
     *   throw and does not return a sentinel.
     * - `FLAG_OVERFLOW` and `FLAG_TRUNCATED` are mutually exclusive in one call
     *   (a truncating run fits its cap, so it never overflows). Compare flags by
     *   equality, never by truthiness. Use `countLines` to size a buffer that can
     *   never overflow: `new Float32Array(countLines(...) * 4)`.
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
        // There is content past the last written line iff `lineStart < len`.
        // If a line slot is free the remainder becomes a real line; otherwise the
        // buffer was too small and we mark the last written line FLAG_OVERFLOW.
        // ptr === 4 * lineCount on every path that reaches here (the two in-loop
        // truncation sites write four slots and return immediately), and
        // maxLines >= 1 (zero capacity returned at the top), so ptr - 1 is the
        // flags slot of the last written line. One test, once, on the cold side.
        if (lineStart < len) {
            if (lineCount < maxLines) {
                outBuffer[ptr++] = lineStart;
                outBuffer[ptr++] = len;
                outBuffer[ptr++] = cursorX;
                outBuffer[ptr++] = FLAG_NORMAL;
                lineCount++;
            } else {
                outBuffer[ptr - 1] = FLAG_OVERFLOW;
            }
        }

        return lineCount;
    },

    /**
     * Count the lines `computeWrap` would write for `text` against a bounding
     * box, with no buffer and therefore no cap. Same parameters as
     * `computeWrap`, same order, minus `outBuffer`.
     *
     * This is the sizing companion to `computeWrap`'s overflow contract:
     * `new Float32Array(countLines(text, font, boxWidth, boxHeight, lineHeight,
     * scale) * 4)` is the buffer size that can never overflow. It agrees with
     * `computeWrap` on every wrapping and truncating call by construction -- the
     * line-ending logic (newline, advance, kerning, soft-break at the last space,
     * space-eater, wrap test, hard-break reseed) is identical; only the output
     * machinery and the buffer cap are absent. A truncation ends counting exactly
     * as it ends writing: at `lineCount + 1`.
     *
     * @param {string} text                        Source text.
     * @param {{ glyphs: Int16Array, kerning: Int16Array }} font
     *   Object exposing the flat glyph/kerning tables.
     * @param {number} boxWidth                    Container width in px. `0` = no horizontal limit.
     * @param {number} boxHeight                   Container height in px. `0` = no vertical limit (no truncation).
     * @param {number} lineHeight                  Line advance in px (at scale=1).
     * @param {number} [scale=1.0]                 Font scale multiplier applied to widths.
     * @returns {number}                           Number of lines `computeWrap` would write into an unbounded buffer.
     */
    countLines(text, font, boxWidth, boxHeight, lineHeight, scale = 1.0) {
        const len = text.length;
        if (len === 0) return 0;

        let lineCount = 0;

        let lineStart = 0;
        let lastSpace = -1;

        let cursorX = 0;
        let prevId = -1;

        // TERMINATION INVARIANT (TL-27): a soft break advances `lineStart` to
        // `lastSpace + 1`, and `lastSpace` is only ever set at `i > lineStart`
        // (the soft-break candidate guard below), so `lastSpace >= lineStart` and
        // `lineStart` strictly increases across every soft break -- the loop makes
        // progress and terminates. Unlike `computeWrap` there is NO `maxLines`
        // break to double as a progress backstop, so a future edit that lets
        // `lastSpace` go stale (point before `lineStart`) would send `i` backward
        // and HANG here rather than return a wrong count. Do not add a defensive
        // per-iteration guard (bytes in a hot body); TL2 owns any guard decision.
        for (let i = 0; i < len; i++) {
            const id = text.charCodeAt(i);

            // -- 1. Explicit newline -----------------------------------------
            if (id === 10) {
                if (boxHeight > 0 && (lineCount + 2) * lineHeight * scale > boxHeight && i < len - 1) {
                    return lineCount + 1;
                }

                lineCount++;

                lineStart = i + 1;
                lastSpace = -1;
                cursorX = 0;
                prevId = -1;
                continue;
            }

            // -- 2. Glyph advance + kerning ----------------------------------
            let advance = 0;
            if (id >= 0 && id < 256) {
                if (prevId !== -1) advance += font.kerning[(prevId << 8) | id] * scale;
                advance += font.glyphs[id * 7 + 6] * scale;
            }

            // Mark soft-break candidate.
            if (id === 32 && i > lineStart) {
                lastSpace = i;
            }

            // -- 4. Wrap / overflow ------------------------------------------
            if (boxWidth > 0 && cursorX + advance > boxWidth && i > lineStart) {

                if (boxHeight > 0 && (lineCount + 2) * lineHeight * scale > boxHeight) {
                    return lineCount + 1;
                }

                if (lastSpace !== -1) {
                    lineCount++;

                    let nextStart = lastSpace + 1;
                    while (nextStart < len && text.charCodeAt(nextStart) === 32) nextStart++;

                    lineStart = nextStart;
                    i = nextStart - 1;
                    lastSpace = -1;
                    cursorX = 0;
                    prevId = -1;
                    continue;
                }

                lineCount++;

                lineStart = i;
                lastSpace = -1;
                prevId = -1;

                cursorX = (id >= 0 && id < 256) ? font.glyphs[id * 7 + 6] * scale : 0;
                prevId = (id >= 0 && id < 256) ? id : -1;
                continue;
            }

            cursorX += advance;
            prevId = (id >= 0 && id < 256) ? id : -1;
        }

        // -- 5. Flush remainder ----------------------------------------------
        if (lineStart < len) lineCount++;

        return lineCount;
    }
};

Object.freeze(TextLayout);
