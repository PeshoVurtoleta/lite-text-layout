/**
 * @zakkster/lite-text-layout -- brute-force reference wrapper (the T5 oracle).
 *
 * Written TOP-DOWN from the five documented wrapping rules in TextLayout.js's
 * docstring, never transcribed from the implementation. It splits paragraphs at
 * the top level, scans each paragraph left to right by prefix width, and decides
 * each break declaratively -- a different shape from the subject's single-pass
 * cursor with its `i = nextStart - 1` rewind.
 *
 * The five rules it implements:
 *   1. Split on '\n' (code 10) into paragraphs.
 *   2. Words are maximal non-space runs; spaces are ordinary content EXCEPT as
 *      soft-break candidates.
 *   3. Measure a run by summing glyphs[id*7+6]*scale plus kerning[(prev<<8)|id]*
 *      scale, with prev reset at line start and on every id > 255.
 *   4. Soft-break at the last space when the next glyph would exceed boxWidth;
 *      the breaking space is excluded, and the run of leading spaces on the NEXT
 *      line is skipped (the "space-eater"). boxWidth <= 0 means no limit.
 *   5. Hard-break mid-word when a single word alone exceeds the box, always
 *      emitting at least one glyph per line.
 *   6. TL-13 CRLF (TL3): a CR is an ordinary id in [0,256) with atlas advance 0,
 *      so it participates in the wrapping pass (rule 3) like any zero-advance
 *      glyph, INCLUDING being hard-broken onto its own line. A CR immediately
 *      before a paragraph's terminating LF is the CR half of a CRLF terminator
 *      and is EXCLUDED from the emitted range (trimmed from the last line). A
 *      lone CR (no following LF) keeps its advance and stays in range -- the same
 *      contract the subject holds (decisions/0002-input-door.md, TL-13). This is
 *      why the CRLF corpus (harness.makeCorpus) differentials to zero against the
 *      subject on BOTH the normal arm AND the hard-break-onto-CR case.
 *
 * DOCUMENTED-BEHAVIOUR NOTE (TL-14): leading whitespace is skipped ONLY after a
 * soft break. Whitespace at the very start of the text, and whitespace right
 * after an explicit '\n', is NOT skipped -- it is content on that line. This
 * oracle encodes that exactly, so a whitespace-only paragraph yields a
 * whitespace-only line. If a future subject change makes this diverge, T5 must
 * surface it (as knownFailing TL-14), not absorb it.
 *
 * INDEPENDENCE, STATED HONESTLY: the paragraph PARTITION here is genuinely
 * independent of the subject (split-on-newline vs the subject's inline linear
 * pass) -- that difference is exactly what surfaced TL-26. But WITHIN a paragraph
 * `wrapParagraph` uses the same greedy shape as the subject (lastSpace /
 * lastSpaceWidth, incremental width, prev reset, a rewind past skipped spaces).
 * A shared misreading of a per-line break rule would therefore NOT surface as a
 * T5 divergence. The independent guard on per-line widths is T0: laws 2 and 8
 * check every line's width against `sumWidth` (a from-the-docs reimplementation
 * in the harness), so `unexpected=0` from T5 must NOT be read as proof of
 * per-line width correctness -- that proof lives in T0, not here.
 *
 * DOMAIN RESTRICTION: boxHeight = 0 ONLY -- no truncation, no ellipsis. A second
 * implementation of the ellipsis-fit rule would be a second chance to be wrong
 * the same way; truncation is pinned by named cases in T0 and T1 instead.
 *
 * It is ALLOWED TO ALLOCATE FREELY and is NEVER called inside a measured window.
 *
 * @license MIT
 */

/**
 * Width of the contiguous range [a, b), kerning context reset at `a` and on
 * every id > 255 -- the documented measurement rule.
 */
function measureRange(text, a, b, glyphs, kerning, scale) {
    let w = 0;
    let prev = -1;
    for (let i = a; i < b; i++) {
        const id = text.charCodeAt(i);
        if (id >= 0 && id < 256) {
            if (prev !== -1) w += kerning[(prev << 8) | id] * scale;
            w += glyphs[id * 7 + 6] * scale;
            prev = id;
        } else {
            prev = -1;
        }
    }
    return w;
}

/**
 * Wrap one paragraph [s, e) (no newlines inside) and push its lines. An empty
 * range emits a single zero-width line (the interior-empty-paragraph case). The
 * caller never passes an empty trailing segment, so no phantom trailing line is
 * produced.
 */
function wrapParagraph(text, s, e, boxWidth, infinite, glyphs, kerning, scale, lines) {
    const base = lines.length;
    if (s >= e) {
        lines.push({ start: s, end: s, width: 0 });
        return;
    }

    let lineStart = s;
    let lastSpace = -1;      // last space eligible as a soft-break point
    let lastSpaceWidth = 0;  // width of [lineStart, lastSpace)
    let w = 0;               // running width of [lineStart, i)
    let prev = -1;
    let i = s;

    while (i < e) {
        const id = text.charCodeAt(i);
        let adv = 0;
        if (id >= 0 && id < 256) {
            if (prev !== -1) adv += kerning[(prev << 8) | id] * scale;
            adv += glyphs[id * 7 + 6] * scale;
        }

        // A space that is not the first char of the line is a soft-break point.
        if (id === 32 && i > lineStart) {
            lastSpace = i;
            lastSpaceWidth = w;
        }

        // Overflow: adding this glyph would exceed the box (never on the first
        // glyph of a line -- rule 5 guarantees at least one glyph per line).
        if (!infinite && i > lineStart && (w + adv) > boxWidth) {
            if (lastSpace !== -1) {
                lines.push({ start: lineStart, end: lastSpace, width: lastSpaceWidth });
                let ns = lastSpace + 1;
                while (ns < e && text.charCodeAt(ns) === 32) ns++;   // the space-eater
                lineStart = ns;
                lastSpace = -1;
                w = 0;
                prev = -1;
                i = ns;
                continue;
            }
            // Hard-break before the overflowing glyph; it starts the next line.
            lines.push({ start: lineStart, end: i, width: w });
            lineStart = i;
            lastSpace = -1;
            w = 0;
            prev = -1;
            continue;   // reprocess char i as the first glyph of the new line
        }

        w += adv;
        prev = (id >= 0 && id < 256) ? id : -1;
        i++;
    }

    // Flush the remainder, trailing spaces included.
    if (lineStart < e) lines.push({ start: lineStart, end: e, width: w });

    // TL-13 (TL3): a CR immediately before this paragraph's terminating LF is the
    // CR half of a CRLF terminator. It is a ZERO-ADVANCE GLYPH -- it took part in
    // the wrapping pass above exactly like any id in [0,256) whose atlas advance
    // is 0 (measureRange and the loop already treat it that way), so it can be
    // HARD-BROKEN onto a line of its own when the content before it overflows.
    // But it is a terminator, not content, so it is EXCLUDED from the emitted
    // range: trim it from the last line. When a hard break stranded the CR alone,
    // the trim yields an EMPTY range -- the same line the subject emits, which is
    // why this MODELS the subject's documented CR-as-glyph rule rather than
    // hiding it. A LONE CR (not before an LF) is never at e-1 of a paragraph, so
    // it is never trimmed and stays in range, in both -- the documented contract.
    if (text.charCodeAt(e - 1) === 13 && lines.length > base) {
        const last = lines[lines.length - 1];
        if (last.end === e) last.end = e - 1;
    }
}

/**
 * Reference wrap. Returns an Array of `{ start, end, width }` per line, over the
 * boxHeight = 0 domain (no truncation).
 *
 * @param {string} text
 * @param {{glyphs:Int16Array, kerning:Int16Array}} font
 * @param {number} boxWidth   Container width; <= 0 means no horizontal limit.
 * @param {number} scale
 * @returns {Array<{start:number, end:number, width:number}>}
 */
export function oracleWrap(text, font, boxWidth, scale) {
    const glyphs = font.glyphs;
    const kerning = font.kerning;
    const len = text.length;
    const infinite = !(boxWidth > 0);
    const lines = [];

    // Rule 1: every '\n' flushes its paragraph; the segment after the last '\n'
    // is flushed only when non-empty, so a trailing '\n' adds no phantom line.
    let pStart = 0;
    for (let j = 0; j < len; j++) {
        if (text.charCodeAt(j) === 10) {
            wrapParagraph(text, pStart, j, boxWidth, infinite, glyphs, kerning, scale, lines);
            pStart = j + 1;
        }
    }
    if (pStart < len) {
        wrapParagraph(text, pStart, len, boxWidth, infinite, glyphs, kerning, scale, lines);
    }
    return lines;
}

// measureRange is kept for any caller wanting a rule-based width check; the hot
// scan above tracks width incrementally, which is the same sum.
export { measureRange };
