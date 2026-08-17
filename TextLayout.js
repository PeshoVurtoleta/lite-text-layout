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
 *
 * THE INPUT DOOR (1.2.0). Both entry points validate every argument once, at
 * entry, before the loop, and throw `TextLayoutError` naming the argument and
 * the requirement. `NaN` is not infinity and `null` is not zero: before 1.2.0
 * `boxWidth = NaN` silently meant "no horizontal limit", `scale = NaN` silently
 * disabled wrapping entirely, and a short glyph table silently made every width
 * `NaN`. See decisions/0002-input-door.md for the full policy table.
 *
 *   - `text` must be a string. `font.glyphs` needs >= 1792 entries and
 *     `font.kerning` >= 65536.
 *   - `boxWidth` and `boxHeight` must be finite and >= 0. `0` means "no limit"
 *     on both axes, and is the documented way to say so.
 *   - `lineHeight` must be finite always, and > 0 when `boxHeight > 0` -- the
 *     only regime in which it is read.
 *   - `scale` must be finite and > 0.
 *   - `outBuffer` must be a `Float32Array` (`computeWrap` only).
 *
 * CROSS-REALM CAVEAT. The `outBuffer` check is `instanceof Float32Array`, so a
 * `Float32Array` from another realm (a `vm` context, an iframe) is REJECTED.
 * That is deliberate: the alternative is a duck-type check that accepts any
 * object naming itself `Float32Array`. Copy into a same-realm view.
 *
 * INDEX CEILING. `startIdx` and `endIdx` are `Float32` slots, exact only to
 * 2^24 = 16777216. A text longer than 16777216 characters lays out correctly
 * below that index and reports wrong indices above it; that is out of domain,
 * documented rather than policed.
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
export const VERSION = '1.2.2';

/**
 * The error every input-door rejection throws. Extends `Error`, sets `name` to
 * `'TextLayoutError'`, and carries a message naming the argument, what it
 * received and what is required.
 *
 * It exists because the alternative is `Cannot read properties of undefined
 * (reading '324')` raised from inside the wrapping loop, which tells the caller
 * nothing. Every message is built at throw time: a pre-built shared instance
 * would carry a shared stack and lie about where the call came from. The
 * throwing path allocates and is never hot -- no measured window ever calls it.
 *
 * See decisions/0002-input-door.md for the full policy table.
 */
export class TextLayoutError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'TextLayoutError';
    }
}

/** Minimum `font.glyphs` length: 256 ids x 7 fields. */
const GLYPHS_MIN = 256 * 7;
/** Minimum `font.kerning` length: the full 256 x 256 pair LUT. */
const KERNING_MIN = 256 * 256;

/**
 * Name a received value for an error message. Cold path only.
 * @param {*} v
 * @returns {string}
 */
function typeName(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'Array';
    const t = typeof v;
    if (t !== 'object') return t;
    const c = v.constructor;
    return (c && typeof c.name === 'string') ? c.name : 'object';
}

/**
 * The input door, shared by BOTH entry points and called as their first
 * statement. Throws `TextLayoutError` or returns nothing.
 *
 * `outBuffer` is deliberately not a parameter: `countLines` has no buffer, and a
 * validator taking an argument one caller cannot supply grows an `undefined`
 * special case on day one. `computeWrap` checks its buffer itself, in one
 * statement immediately after calling this.
 *
 * The check ORDER is fixed and part of the contract, because a tuple that is
 * wrong in two places must report the same argument every time:
 * `text`, `font`, `font.glyphs`, `font.kerning`, `boxWidth`, `boxHeight`,
 * `lineHeight`, `scale`.
 *
 * Every check runs ONCE, here, before the loop. Not one of them enters the
 * per-character body, and the table lengths are read here and never again.
 *
 * @param {string} text
 * @param {{ glyphs: Int16Array, kerning: Int16Array }} font
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {number} lineHeight
 * @param {number} scale
 * @returns {void}
 * @throws {TextLayoutError}
 */
function validateInput(text, font, boxWidth, boxHeight, lineHeight, scale) {
    if (typeof text !== 'string') {
        throw new TextLayoutError(
            'text must be a string; received ' + typeName(text));
    }
    if (font === null || typeof font !== 'object') {
        throw new TextLayoutError(
            'font must be an object exposing glyphs and kerning tables; received ' + typeName(font));
    }

    const glyphs = font.glyphs;
    if (glyphs === null || glyphs === undefined || typeof glyphs.length !== 'number') {
        throw new TextLayoutError(
            'font.glyphs must be an Int16Array of at least ' + GLYPHS_MIN +
            ' entries; received ' + typeName(glyphs));
    }
    if (glyphs.length < GLYPHS_MIN) {
        throw new TextLayoutError(
            'font.glyphs is too short: received ' + glyphs.length + ' entries, requires ' +
            GLYPHS_MIN + ' (256 ids x 7 fields). A @zakkster/lite-bmfont BitmapFont always ' +
            'allocates the full table; a hand-rolled font must too.');
    }

    const kerning = font.kerning;
    if (kerning === null || kerning === undefined || typeof kerning.length !== 'number') {
        throw new TextLayoutError(
            'font.kerning must be an Int16Array of at least ' + KERNING_MIN +
            ' entries; received ' + typeName(kerning));
    }
    if (kerning.length < KERNING_MIN) {
        throw new TextLayoutError(
            'font.kerning is too short: received ' + kerning.length + ' entries, requires ' +
            KERNING_MIN + ' (256 x 256 pair LUT).');
    }

    if (!Number.isFinite(boxWidth)) {
        throw new TextLayoutError(
            'boxWidth must be a finite number; received ' + String(boxWidth) +
            '. Use 0 for no horizontal limit.');
    }
    if (boxWidth < 0) {
        throw new TextLayoutError(
            'boxWidth must not be negative; received ' + String(boxWidth) +
            '. Use 0 for no horizontal limit.');
    }

    if (!Number.isFinite(boxHeight)) {
        throw new TextLayoutError(
            'boxHeight must be a finite number; received ' + String(boxHeight) +
            '. Use 0 for no vertical limit.');
    }
    if (boxHeight < 0) {
        throw new TextLayoutError(
            'boxHeight must not be negative; received ' + String(boxHeight) +
            '. Use 0 for no vertical limit.');
    }

    if (!Number.isFinite(lineHeight)) {
        throw new TextLayoutError(
            'lineHeight must be a finite number; received ' + String(lineHeight) + '.');
    }
    if (boxHeight > 0 && lineHeight <= 0) {
        throw new TextLayoutError(
            'lineHeight must be > 0 when boxHeight > 0 (truncation is measured in line ' +
            'heights); received lineHeight ' + String(lineHeight) + ' with boxHeight ' +
            String(boxHeight) + '.');
    }

    if (!Number.isFinite(scale)) {
        throw new TextLayoutError(
            'scale must be a finite number; received ' + String(scale) + '.');
    }
    if (scale <= 0) {
        throw new TextLayoutError(
            'scale must be > 0; received ' + String(scale) + '.');
    }
}

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
     *   sides, and runs of leading whitespace on the next line are skipped
     *   AFTER A SOFT BREAK. Leading whitespace at the START of the text, and
     *   immediately after an explicit `\n`, is CONTENT and is preserved --
     *   `'   '` is one line of width `3 * space`, not an empty layout.
     *   Indentation is never silently destroyed; call `trim()` yourself if you
     *   want it gone.
     * - Hard-break (mid-word) when no space is available within the line. A
     *   single glyph wider than `boxWidth` is emitted as an OVER-WIDE line,
     *   unflagged: the "at least one glyph per line" rule is what makes the
     *   loop terminate, and an over-wide line is the price of that guarantee.
     * - Explicit `\n` (code 10) starts a new line and is not rendered.
     * - CRLF: a `\r` (code 13) IMMEDIATELY PRECEDING a `\n` is a line
     *   terminator and is excluded from the emitted range, so the range and
     *   `lineWidth` agree. `'AAA\r\nBBB'` and `'AAA\nBBB'` produce the same
     *   line count and the same widths. A LONE `\r` is not a terminator: it
     *   stays inside the range and contributes its atlas advance (0 in a normal
     *   font). Mac-Classic line endings are not supported and are not a bug.
     *   CRLF text lays out identically to LF text -- same line count, same
     *   widths, start indices shifted by the extra character -- WHENEVER the
     *   CR's own advance does not force a wrap. That is always true for a real
     *   bitmap atlas, where a CR is not a printable glyph and its advance is 0.
     *   In a hand-rolled atlas that gives glyph 13 a non-zero advance AND a
     *   `boxWidth` narrow enough for it to matter, the CR wraps onto its own
     *   line before this rule is reached and the identity does not hold; the CR
     *   is still never inside an emitted range. Out of contract, documented.
     * - A `boxHeight` too small for even one line (`lineHeight * scale >
     *   boxHeight`, with `boxHeight > 0`) returns `0` and writes NOTHING. A box
     *   that cannot hold one line holds no lines.
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
     * - A truncated line's `lineWidth` INCLUDES the three-dot ellipsis
     *   allowance: for content 36 plus an 18px ellipsis the slot reads `54`,
     *   not `36`. A consumer summing widths for centring must expect that a
     *   `FLAG_TRUNCATED` line measures wider than its character range.
     *
     * Atlas requirements: ASCII `'.'` (code 46) is read for the ellipsis
     * width. If `'.'` is missing from the font, `ellipsisWidth` is treated as
     * `0` (no truncation indicator possible).
     *
     * Non-ASCII chars (`id >= 256`) contribute zero advance and reset the
     * kerning context -- same behavior as `BitmapFont.draw`.
     *
     * The range contract, stated once and drift-guarded byte-for-byte across the
     * source docstring, `TextLayout.d.ts`, `llms.txt` and `README.md`
     * (test/TextLayout.drift.test.js fails if any surface's wording drifts):
     *
     * RANGE-CONTRACT v1
     * startIdx is inclusive and endIdx is exclusive, and both are indices into the original string.
     * The breaking space is excluded from both sides.
     * Leading whitespace is skipped only after a soft break; it is content at text start and immediately after an explicit newline.
     * lineWidth is at the rendered scale and includes the ellipsis allowance on a FLAG_TRUNCATED line.
     * END RANGE-CONTRACT
     *
     * @param {string} text                        Source text.
     * @param {{ glyphs: Int16Array, kerning: Int16Array }} font
     *   Object exposing the flat glyph/kerning tables -- a `BitmapFont`
     *   instance from `@zakkster/lite-bmfont` works directly.
     * @param {number} boxWidth                    Container width in px. `0` = no horizontal limit.
     * @param {number} boxHeight                   Container height in px. `0` = no vertical limit (no truncation).
     * @param {number} lineHeight                  Line advance in px (at scale=1) -- usually `font.lineHeight`.
     * @param {Float32Array} outBuffer             Pre-allocated, length >= `lineCount * 4`. Same-realm.
     * @param {number} [scale=1.0]                 Font scale multiplier applied to widths. Finite, > 0.
     * @returns {number}                           Number of lines written. `0` when the box cannot hold one line.
     * @throws {TextLayoutError} `text` is not a string; `font` is missing or
     *   either table is shorter than 1792 / 65536; `boxWidth` or `boxHeight` is
     *   non-finite or negative; `lineHeight` is non-finite, or `<= 0` while
     *   `boxHeight > 0`; `scale` is non-finite or `<= 0`; `outBuffer` is not a
     *   same-realm `Float32Array`.
     */
    computeWrap(text, font, boxWidth, boxHeight, lineHeight, outBuffer, scale = 1.0) {
        validateInput(text, font, boxWidth, boxHeight, lineHeight, scale);
        if (!(outBuffer instanceof Float32Array)) {
            throw new TextLayoutError(
                'outBuffer must be a Float32Array; received ' + typeName(outBuffer) +
                '. A cross-realm Float32Array fails this check by design -- see the caveat ' +
                'in the module docstring.');
        }
        // A box that cannot hold ONE line holds no lines. Documented, not a
        // throw (decisions/0002-input-door.md, policy B): it is a coherent
        // question with the answer "nothing fits". Duplicated in countLines
        // deliberately -- the T0 agreement law with boxHeight 8 catches drift.
        if (boxHeight > 0 && lineHeight * scale > boxHeight) return 0;

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
                // ONE read, reused twice. This branch runs once per LINE, not
                // once per character, so the cost is a handful of reads per
                // call -- see decisions/0002-input-door.md, TL-26/TL-13.
                const prevCh = i > 0 ? text.charCodeAt(i - 1) : -1;
                // TL-13: a CR immediately preceding this LF is a line
                // TERMINATOR, not content. Exclude it from the range. A LONE CR
                // (no LF after) keeps its atlas advance and stays in range.
                const crlf = prevCh === 13 && i > lineStart;
                const lineEnd = crlf ? i - 1 : i;
                // The CR leaves the RANGE, so its advance must leave the WIDTH
                // too, or the documented "range and lineWidth agree" is false in
                // any atlas where glyph 13 is not zero-advance. (The stub font
                // in the tests has advance 0, which is exactly why this half
                // stays invisible unless it is written down.) Recomputed here
                // rather than tracked per character: this branch runs once per
                // LINE, and tracking a `lastAdvance` would put a store in the
                // per-character body for a case that fires once a line at most.
                // The kerning term mirrors the loop's own rule -- a pair only
                // kerns when the preceding id is ASCII and on this line.
                let crAdv = 0;
                if (crlf) {
                    crAdv = font.glyphs[13 * 7 + 6] * scale;
                    const beforeCr = (i - 2 >= lineStart) ? text.charCodeAt(i - 2) : -1;
                    if (beforeCr >= 0 && beforeCr < 256) {
                        crAdv += font.kerning[(beforeCr << 8) | 13] * scale;
                    }
                }

                // TL-26: the space-eater after a soft break can land lineStart
                // exactly on this newline, leaving an EMPTY range whose
                // preceding character is the eaten space. That is a phantom
                // line, not a blank line, and it must not be emitted. The
                // discriminator is the character BEFORE lineStart: 32 means the
                // space-eater put us here, 10 means the author wrote a blank
                // line and it survives. Tested BEFORE the truncation
                // sub-branch, or a phantom could trigger a truncation return
                // carrying a zero-length range.
                if (lineEnd === lineStart && lineStart > 0 && text.charCodeAt(lineStart - 1) === 32) {
                    lineStart = i + 1;
                    lastSpace = -1;
                    lastSpaceWidth = 0;
                    cursorX = 0;
                    prevId = -1;
                    lastSafeEllipsisIdx = -1;
                    continue;
                }

                // Truncate if the line AFTER this one wouldn't fit, but only
                // when there's still text past the newline.
                if (boxHeight > 0 && (lineCount + 2) * lineHeight * scale > boxHeight && i < len - 1) {
                    const safe = lastSafeEllipsisIdx >= lineStart && lastSafeEllipsisIdx !== -1;
                    // The ellipsis cut must respect lineEnd. When the last safe
                    // position IS the CR, `lastSafeEllipsisIdx + 1` equals `i`
                    // and would put the CR straight back inside the range -- the
                    // half of TL-13 that only the TRUNCATING path can reach. The
                    // comparison is `<=`, not `<`: a cut landing exactly ON
                    // lineEnd is already correct and its width must NOT have the
                    // CR subtracted, because that width never included one.
                    const cutIdx = lastSafeEllipsisIdx + 1;
                    const useSafeCut = safe && cutIdx <= lineEnd;
                    const safeW = useSafeCut ? lastSafeEllipsisWidth : lastSafeEllipsisWidth - crAdv;
                    outBuffer[ptr++] = lineStart;
                    outBuffer[ptr++] = useSafeCut ? cutIdx : lineEnd;
                    outBuffer[ptr++] = safe ? safeW + ellipsisWidth : cursorX - crAdv;
                    outBuffer[ptr++] = safe ? FLAG_TRUNCATED : FLAG_NORMAL;
                    return lineCount + 1;
                }

                outBuffer[ptr++] = lineStart;
                outBuffer[ptr++] = lineEnd;
                outBuffer[ptr++] = cursorX - crAdv;
                outBuffer[ptr++] = FLAG_NORMAL;
                lineCount++;

                lineStart = i + 1;
                lastSpace = -1;
                lastSpaceWidth = 0;
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
                    lastSpaceWidth = 0;
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
                lastSpaceWidth = 0;
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
        // TL-26 corollary, cold path, once per call. The `lineCount >= maxLines`
        // break can fire on the very iteration that would have SUPPRESSED a
        // phantom line, leaving `lineStart` parked on a newline that consumes
        // itself and is not content. Left alone, a capped run would report
        // FLAG_OVERFLOW where the unbounded run has nothing more to write, and
        // the documented iff (`FLAG_OVERFLOW` <=> `countLines(...) > capacity`)
        // would be false. Consume it here exactly as the loop would have. At
        // most ONE terminator can qualify: after the advance the character
        // before `lineStart` is a newline, never a space.
        if (lineStart < len && lineStart > 0 && text.charCodeAt(lineStart - 1) === 32) {
            const t0 = text.charCodeAt(lineStart);
            if (t0 === 10) lineStart++;
            else if (t0 === 13 && text.charCodeAt(lineStart + 1) === 10) lineStart += 2;
        }

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
     * @param {number} [scale=1.0]                 Font scale multiplier applied to widths. Finite, > 0.
     * @returns {number}                           Number of lines `computeWrap` would write into an unbounded buffer.
     * @throws {TextLayoutError} The SAME door as `computeWrap`, through the
     *   same shared validator, with the same messages -- minus the `outBuffer`
     *   check, which has no argument to check here.
     */
    countLines(text, font, boxWidth, boxHeight, lineHeight, scale = 1.0) {
        validateInput(text, font, boxWidth, boxHeight, lineHeight, scale);
        // The same zero-line policy as computeWrap, deliberately duplicated.
        if (boxHeight > 0 && lineHeight * scale > boxHeight) return 0;

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
        // per-iteration guard (bytes in a hot body). TL2 ANSWERED this: no guard. The
        // invariant is proved by construction above and the torture entry point's
        // watchdog turns any future hang into a non-zero exit.
        for (let i = 0; i < len; i++) {
            const id = text.charCodeAt(i);

            // -- 1. Explicit newline -----------------------------------------
            if (id === 10) {
                // TL-26 / TL-13, the same branch and the same read as
                // computeWrap. countLines has no endIdx slot, so it needs the
                // CR-adjusted end only to decide whether the range is EMPTY --
                // it never writes it. Edited in the same pass as computeWrap or
                // the T0 agreement law fires immediately.
                const prevCh = i > 0 ? text.charCodeAt(i - 1) : -1;
                const lineEnd = (prevCh === 13 && i > lineStart) ? i - 1 : i;

                if (lineEnd === lineStart && lineStart > 0 && text.charCodeAt(lineStart - 1) === 32) {
                    lineStart = i + 1;
                    lastSpace = -1;
                    cursorX = 0;
                    prevId = -1;
                    continue;
                }

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
