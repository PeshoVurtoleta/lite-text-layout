# @zakkster/lite-text-layout

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-text-layout.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-text-layout)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Hot%20path-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-text-layout?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-text-layout)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-text-layout?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-text-layout)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-ext-layout?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-ext-layout)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## What is lite-text-layout?

`@zakkster/lite-text-layout` is a zero-allocation **word wrapper** for ASCII bitmap fonts.
It walks a string once, computes soft/hard line breaks, kerning-aware widths, and an
optional ellipsis-on-overflow flag -- then writes everything into a caller-owned
`Float32Array`.

The output is exactly the layout buffer that [`@zakkster/lite-bmfont`](https://www.npmjs.com/package/@zakkster/lite-bmfont)'s
`BitmapFont.drawWrapped` consumes. Compute layout once, re-render every frame for free.

It gives you:

- Soft-wrap at spaces, hard-break inside long words
- Per-line pixel widths, kerning-aware (uses the same 64K LUT as the renderer)
- Multi-line via `\n` characters
- Optional truncation with ellipsis flag when content overflows `boxHeight`
- Zero allocation -- single pass over the string, all state in primitives
- ~0.6 KB gzipped, no dependencies

> Supports ASCII characters 0--255. Non-ASCII chars contribute zero advance and reset
> the kerning context (same convention as `BitmapFont.draw`).

Part of the [@zakkster/lite-*](https://www.npmjs.com/org/zakkster) ecosystem -- micro-libraries built for deterministic, cache-friendly game development.

## Install

```bash
npm i @zakkster/lite-text-layout
```

Pair with the renderer (separate package):

```bash
npm i @zakkster/lite-bmfont @zakkster/lite-text-layout
```

## Quick Start

```javascript
import { BitmapFont } from '@zakkster/lite-bmfont';
import { TextLayout } from '@zakkster/lite-text-layout';

const font = new BitmapFont(atlasImage, fontJson);

// Pre-allocate a layout buffer once. 16 lines = 64 floats.
const layout = new Float32Array(64);

// Each frame: layout is virtually free once computed. Re-compute only when
// the text or box dimensions change.
const lineCount = TextLayout.computeWrap(
    'Hello there, traveller!\nWelcome to the inn.',
    font,
    /* boxWidth  */ 200,
    /* boxHeight */ 80,
    /* lineHeight*/ font.lineHeight,
    layout,
    /* scale     */ 1
);

// Hand the layout straight to drawWrapped -- no array conversion, no string splitting.
font.drawWrapped(
    ctx, text, layout, lineCount,
    /* box */ 200, 80, 20, 20,
    /* scale */ 1,
    /* align  */ 1,  // center
    /* vAlign */ 1   // middle
);
```

## Why a separate package?

`lite-bmfont` is the renderer. `lite-text-layout` is the planner. Keeping them split:

- Lets the renderer ship without paying for wrapper code when you don't need it (~0.6 KB saved).
- Lets you swap in a custom layout strategy (RTL, char-break-only, hyphenation, soft-hyphen markers) without forking the renderer.
- Lets you compute layout once and re-render every frame for free -- typical in HUDs where
  the dialogue box doesn't resize but its position animates.

## Layout buffer format

Each line is **4 consecutive Float32 values**:

| Slot | Meaning |
|------|---------|
| `[0]` | `startIdx` -- char index in `text` where this line begins (inclusive) |
| `[1]` | `endIdx` -- char index in `text` where this line ends (exclusive) |
| `[2]` | `lineWidth` -- measured pixel width of this line, including any ellipsis allowance |
| `[3]` | `flags` -- `FLAG_NORMAL` (0), `FLAG_TRUNCATED` (1, append `...`), or `FLAG_OVERFLOW` (2) |

The buffer must hold at least `lineCount * 4` floats; surplus capacity is ignored, so you
can reuse one fat buffer across many strings. The function returns the number of lines
actually written. If the buffer is too small, the last written line's flags slot is set to
`FLAG_OVERFLOW` and the partial layout is a true prefix of the full result; a zero-capacity
buffer (length 0..3) returns `0` and writes nothing. Use `countLines` to size a buffer that
can never overflow.

```javascript
import { FLAG_TRUNCATED } from '@zakkster/lite-text-layout';

if (layout[lineCount * 4 - 1] === FLAG_TRUNCATED) {
    // The last line was truncated -- content was longer than boxHeight allowed.
}
```

## Wrapping rules

- **Soft-break** at the last space when adding the next glyph would exceed `boxWidth`.
  The breaking space is excluded from both sides; runs of leading whitespace on the
  next line are skipped **after a soft break**.
- **Leading whitespace is content.** At the start of the text, and immediately after an
  explicit `\n`, it is NOT skipped: `computeWrap('   ', ...)` is one line of width
  `3 * space`, not an empty layout. Indentation is never silently destroyed -- call
  `trim()` yourself if you want it gone. Deliberate; see `decisions/0002-input-door.md`.
- **Hard-break** inside a word when no space is available within the current line.
  Kerning is reset across the break.
- **An over-wide glyph is emitted, unflagged.** A single glyph wider than `boxWidth`
  produces a line wider than the box. "At least one glyph per line" is what makes the
  loop terminate; the over-wide line is the price of that guarantee.
- **Explicit `\n`** starts a new line and is not rendered.
- **CRLF.** A `\r` **immediately preceding** a `\n` is a line terminator and is excluded
  from the emitted range, so the range and `lineWidth` agree -- `'AAA\r\nBBB'` lays out
  identically to `'AAA\nBBB'`. A **lone `\r`** is not a terminator: it stays inside the
  range with its atlas advance (0 in a normal font). The LF-identity holds whenever the
  CR's own advance does not force a wrap -- always true for a real atlas, where a CR is
  not a printable glyph. A hand-rolled atlas giving glyph 13 a non-zero advance, in a
  box narrow enough to wrap on it, is out of contract; the CR is still never inside an
  emitted range.
- **`boxWidth === 0`** disables horizontal wrapping (only `\n` and truncation apply).
  `0` is the documented way to say "no limit"; a negative or non-finite `boxWidth` throws.
- **`boxHeight === 0`** disables vertical truncation entirely.
- **A box under one line returns `0`.** With `boxHeight > 0` and
  `lineHeight * scale > boxHeight`, `computeWrap` returns `0` and writes nothing. The
  boundary is `>`, not `>=`: a box exactly one line tall still emits its line.
- **Index ceiling.** `startIdx` and `endIdx` are Float32 slots, exact only to
  2^24 = 16777216. A longer text is out of domain -- documented, not policed.

## Truncation

When `boxHeight > 0` and the wrap would push content past the bottom of the box, the
**last fitting line** is flagged `FLAG_TRUNCATED`. The renderer appends `...` (three
ASCII `.` glyphs) -- no per-frame string allocation.

To make the ellipsis fit cleanly, `computeWrap` tracks the latest position on each line
where *content + ellipsis* still fits within `boxWidth`. The truncated line ends there.

**A truncated line's `lineWidth` includes the ellipsis allowance.** For content 36 plus
an 18px ellipsis the slot reads `54`, not `36`. A consumer summing widths for centring
must expect a `FLAG_TRUNCATED` line to measure wider than the glyphs in
`[startIdx, endIdx)`.

Edge cases worth knowing:

- If the font doesn't include `'.'` (code 46), `ellipsisWidth` is treated as `0` and no
  truncation marker is drawn. Content is still truncated to fit `boxHeight`.
- If `boxWidth` is so narrow that not even one glyph + ellipsis fits anywhere on the
  line, the truncated line falls back to `FLAG_NORMAL` (no ellipsis attempt) so the
  renderer doesn't draw dots that would themselves overflow the box.

## API

### `computeWrap(text, font, boxWidth, boxHeight, lineHeight, outBuffer, scale?) -> number`

Computes the layout. Writes 4-tuples into `outBuffer` and returns the line count.

- `text` -- source string
- `font` -- anything with `glyphs: Int16Array` and `kerning: Int16Array`; a `BitmapFont` instance works directly
- `boxWidth` -- px, `0` for no horizontal limit
- `boxHeight` -- px, `0` for no vertical limit
- `lineHeight` -- px at `scale=1`, usually `font.lineHeight`
- `outBuffer` -- pre-allocated `Float32Array`, capacity caps line count at `floor(length / 4)`; an undersized buffer flags its last written line `FLAG_OVERFLOW`
- `scale` -- applied to all widths and the height-fit check (default `1`)

### `countLines(text, font, boxWidth, boxHeight, lineHeight, scale?) -> number`

Counts the lines `computeWrap` would write into an unbounded buffer -- same parameters,
same order, minus `outBuffer`. Size a buffer that can never overflow as
`new Float32Array(countLines(...) * 4)`. Agrees with `computeWrap` on every wrapping and
truncating call.

### `TextLayoutError`

```javascript
import { TextLayoutError } from '@zakkster/lite-text-layout';
```

`class TextLayoutError extends Error`, with `name === 'TextLayoutError'`. Both entry
points validate every argument once, at entry, through **one shared validator** called
as their first statement -- before the loop, never from inside it. The message names the
argument, what it received and what is required.

`NaN` is not infinity and `null` is not zero. Before 1.2.0 none of these threw:
`boxWidth = NaN` silently meant "no horizontal limit", `scale = NaN` silently disabled
wrapping entirely, a 700-entry glyph table silently made every width `NaN`, and
`text = 12345` silently returned `0`.

| Argument | Requirement |
|----------|-------------|
| `text` | a string |
| `font` | an object exposing both tables |
| `font.glyphs` | length >= 1792 (256 ids x 7 fields) |
| `font.kerning` | length >= 65536 (256 x 256 pair LUT) |
| `boxWidth` | finite and >= 0 (`0` means no limit) |
| `boxHeight` | finite and >= 0 (`0` means no limit) |
| `lineHeight` | finite always; `> 0` when `boxHeight > 0` |
| `scale` | finite and `> 0` |
| `outBuffer` | a `Float32Array` (`computeWrap` only) |

Checks run in that exact order, so a tuple wrong in two places always reports the same
argument. `lineHeight` is conditional on purpose:
`computeWrap('AAA', font, 0, 0, 0, out)` does **not** throw -- with no vertical box the
value is never read -- while `computeWrap('AAA', font, 0, 32, 0, out)` does.

**Cross-realm caveat.** The `outBuffer` check is `instanceof Float32Array`, so a
`Float32Array` from another realm (a `vm` context, an iframe) is rejected. That is
deliberate: the alternative is a duck-type check that accepts any object naming itself
`Float32Array`. Copy into a same-realm view.

**Aliasing.** An `outBuffer` overlapping `font.glyphs` through a shared `ArrayBuffer` is
caller error with an undefined result, and is **not** checked at runtime -- a `.buffer`
identity check would reject a caller packing *disjoint* views into one arena, which is
correct code.

### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `FLAG_NORMAL` | `0` | Normal line |
| `FLAG_TRUNCATED` | `1` | The TEXT did not fit the BOX; renderer appends `...` |
| `FLAG_OVERFLOW` | `2` | The BUFFER did not fit the TEXT (a caller bug); set on the last written line |

**Law 6 -- flags are a value space; compare by equality, never by truthiness.**
`if (flags === FLAG_TRUNCATED)`, never `if (flags)`. The domain may widen in a MINOR
release; only equality against a named constant is stable. See
`decisions/0001-flag-overflow.md`.

## Benchmark

```
Word-wrapping a 50-word paragraph each frame at 60 fps:
  ctx.measureText + manual line-build:  allocates strings/arrays every frame
  TextLayout.computeWrap(buffer):       zero allocation -- output buffer is reused

Re-rendering an already-laid-out paragraph at 60 fps:
  any text engine:               re-runs layout per frame
  drawWrapped(layout):           zero work -- layout is just an array of indices
```

## TypeScript

Full TypeScript declarations included in `TextLayout.d.ts`. Exports:

- `TextLayout.computeWrap(...)`, `TextLayout.countLines(...)`
- `FLAG_NORMAL`, `FLAG_TRUNCATED`, `FLAG_OVERFLOW`
- Types: `BitmapFontData`, `LayoutLine`, `LineFlag`

## LLM-Friendly Documentation

See `llms.txt` for AI-optimized metadata and usage examples.

## Changelog

### 1.2.0
- Added `TextLayoutError` and the input door: every argument is validated once, at entry, by one shared validator serving both entry points. `boxWidth`/`boxHeight` negative or non-finite, `scale` non-finite or `<= 0`, `lineHeight` non-finite (or `<= 0` with `boxHeight > 0`), a short `font.glyphs`/`font.kerning`, a non-string `text` and a non-`Float32Array` `outBuffer` now throw instead of silently producing NaN widths, no wrapping, or `0`. Fixed: a `\r` immediately before a `\n` is excluded from the emitted range, and the phantom zero-width line after a whitespace soft break is gone (a deliberate blank line survives). Defined: a box under one line returns `0` and writes nothing. Documented: leading whitespace is skipped only after a soft break, an over-wide glyph is emitted unflagged, a truncated line's width includes the ellipsis allowance, and indices are exact to 2^24 = 16777216. MINOR -- see `decisions/0002-input-door.md`.

### 1.1.0
- Added `FLAG_OVERFLOW = 2` (an undersized buffer now reports itself on the last written line's flags slot), `countLines` for overflow-proof buffer sizing, and a frozen `TextLayout` namespace. Zero-capacity buffers return `0` and write nothing; `FLAG_OVERFLOW` and `FLAG_TRUNCATED` are mutually exclusive. Law 6: compare flags by equality, never by truthiness. MINOR -- see `decisions/0001-flag-overflow.md`.

### 1.0.0
- Initial release. `computeWrap` with soft-break, hard-break, explicit-newline, truncation with ellipsis flag, and full kerning support.

## License

MIT
