# @zakkster/lite-text-layout

> Zero-GC word wrapper for ASCII bitmap fonts: it walks a string once and writes line breaks, kerning-aware widths, and truncation flags into a caller-owned `Float32Array` that feeds `@zakkster/lite-bmfont`'s `drawWrapped` directly.

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-text-layout.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-text-layout)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Hot%20path-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-text-layout?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-text-layout)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-text-layout?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-text-layout)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-text-layout?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-text-layout)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## The word wrapper the bitmap-font ecosystem was missing

`@zakkster/lite-bmfont` is the renderer: it blits glyphs. It does not decide
where a line breaks. Every game HUD, dialogue box, and tooltip needs that
decision made -- soft-wrap at spaces, hard-break inside a long word,
kerning-aware pixel widths, and an ellipsis when the text is taller than its
box -- and needs it made without allocating a fresh string or array on a frame
that has to hit 60fps. `lite-text-layout` is that piece: one linear pass over
the string that writes a compact `Float32Array` the renderer consumes as-is.

```bash
npm i @zakkster/lite-text-layout
```

Pair it with the renderer (a separate install, still zero runtime dependencies
here):

```bash
npm i @zakkster/lite-bmfont @zakkster/lite-text-layout
```

<!--RUN-->
```javascript
import { BitmapFont } from '@zakkster/lite-bmfont';
import { TextLayout, FLAG_TRUNCATED } from '@zakkster/lite-text-layout';

const font = new BitmapFont(atlasImage, fontJson);

// Pre-allocate a layout buffer once. 16 lines = 64 floats.
const layout = new Float32Array(64);

const text = 'Hello there, traveller!\nWelcome to the inn.';

// Compute once; re-render every frame for free. Re-run only when the text
// or the box dimensions change.
const lineCount = TextLayout.computeWrap(
    text,
    font,
    /* boxWidth   */ 200,
    /* boxHeight  */ 80,
    /* lineHeight */ font.lineHeight,
    layout,
    /* scale      */ 1,
);

// Hand the layout straight to drawWrapped -- no array conversion, no split.
font.drawWrapped(
    ctx, text, layout, lineCount,
    /* box    */ 200, 80, 20, 20,
    /* scale  */ 1,
    /* align  */ 1,   // center
    /* vAlign */ 1,   // middle
);

// A truncated last line means content overflowed boxHeight.
const truncated = layout[lineCount * 4 - 1] === FLAG_TRUNCATED;
```

One pass, zero allocation, output the renderer reads without translation.

## Table of contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [How wrapping works](#how-wrapping-works)
- [API reference](#api-reference)
- [Output buffer and range contract](#output-buffer-and-range-contract)
- [Composability with the ecosystem](#composability-with-the-ecosystem)
- [Zero-GC design notes](#zero-gc-design-notes)
- [Benchmarks](#benchmarks)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Testing](#testing)
- [What this is not](#what-this-is-not)
- [Ecosystem](#ecosystem)
- [License](#license)

## Why this exists

Word wrapping and rendering are two jobs, and folding them into one package
makes both worse:

1. **The renderer should not pay for wrapper code it does not use.** A caller
   drawing pre-laid-out labels never needs the wrap loop. Keeping the planner
   separate keeps the renderer small (~0.6 KB saved) and lets you swap in a
   custom layout strategy -- char-break-only, a different truncation policy --
   without forking the renderer.

2. **Layout should be computed once and re-rendered for free.** In a HUD the
   dialogue box rarely resizes but its position animates every frame. Wrapping
   is O(n) in the text; re-running it 60 times a second to draw the same
   sentence is waste. `computeWrap` writes indices and widths into a buffer
   once; `drawWrapped` then re-blits from that buffer with zero layout work.

The standard alternative -- `ctx.measureText` plus a hand-rolled line builder --
allocates strings and arrays on every frame, and the GC pauses land as visible
jitter. This package allocates nothing after you hand it the output buffer.

## What you get

- **`TextLayout.computeWrap(text, font, boxWidth, boxHeight, lineHeight, outBuffer, scale?)`**
  -- the one function that does the work. A single linear pass that writes one
  4-float tuple per line into your buffer and returns the line count. Soft-wrap
  at spaces, hard-break inside long words, explicit `\n`, CRLF handling,
  kerning-aware widths, and optional ellipsis-on-overflow.
- **`TextLayout.countLines(...)`** -- the same wrap without an output buffer,
  so you can size a `Float32Array` that can never overflow.
- **`TextLayoutError`** -- one shared validator behind both entry points; every
  degenerate argument throws a named error before the loop, so the hot loop
  never branches on a bad state.
- **Flag constants** -- `FLAG_NORMAL`, `FLAG_TRUNCATED`, `FLAG_OVERFLOW`, and
  `VERSION`. Flags are a value space compared by equality, never by truthiness.
- **Zero runtime dependencies**, single-file ESM, full `.d.ts`. The output is
  byte-for-byte the buffer `@zakkster/lite-bmfont`'s `drawWrapped` consumes, on
  both bmfont 1.x and 2.x (widths are decoded per format -- see below).

Full types ship in [`TextLayout.d.ts`](./TextLayout.d.ts). Every export is
documented.

## How wrapping works

<details>
<summary>Every wrapping and truncation rule, and why each one is the way it is.</summary>

`computeWrap` reads glyph advances and kerning from the font's two typed arrays
(`glyphs: Int16Array`, `kerning: Int16Array` -- a `BitmapFont` instance exposes
both directly) and walks the string once, tracking the current line width and
the last position a soft break could happen.

### Line breaks

- **Soft-break** at the last space (` `, code 32) when adding the next glyph
  would exceed `boxWidth`. The breaking space is excluded from both sides; runs
  of leading whitespace on the next line are skipped **after a soft break**.
- **Leading whitespace is content** at the start of the text and immediately
  after an explicit `\n` -- it is skipped only after a soft break.
  `computeWrap('   ', ...)` is one line of width `3 * space`, not an empty
  layout. Indentation is never silently destroyed; call `trim()` yourself if you
  want it gone. Deliberate; see [`decisions/0002-input-door.md`](./decisions/0002-input-door.md).
- **Hard-break** mid-word when no space is available within the current line.
  Kerning is reset across the break -- the first glyph of the new line gets a
  fresh kerning context.
- **An over-wide glyph is emitted, unflagged.** A single glyph wider than
  `boxWidth` produces a line wider than the box. "At least one glyph per line" is
  what makes the loop terminate; the over-wide line is the price of that
  guarantee.
- **Explicit `\n`** (code 10) starts a new line and is not rendered.
- **CRLF.** A `\r` (code 13) **immediately preceding** a `\n` is a line
  terminator and is excluded from the emitted range, so the range and
  `lineWidth` agree -- `'AAA\r\nBBB'` lays out identically to `'AAA\nBBB'`. A
  **lone `\r`** is not a terminator: it stays inside the range with its atlas
  advance (0 in a normal font). Mac-Classic line endings are unsupported by
  design. The LF-identity holds whenever the CR's own advance does not force a
  wrap -- always true for a real atlas, where a CR is not a printable glyph. A
  hand-rolled atlas giving glyph 13 a non-zero advance, in a box narrow enough
  to wrap on it, is out of contract; the CR is still never inside an emitted
  range.

### Box limits

- **`boxWidth === 0`** disables horizontal wrapping (only `\n` and truncation
  apply). `0` is the documented way to say "no limit"; a negative or non-finite
  `boxWidth` throws.
- **`boxHeight === 0`** disables vertical truncation entirely (`FLAG_TRUNCATED`
  is never written).
- **A box under one line returns `0`.** With `boxHeight > 0` and
  `lineHeight * scale > boxHeight`, `computeWrap` returns `0` and writes nothing.
  The boundary is `>`, not `>=`: a box exactly one line tall still emits its
  line.
- **Index ceiling.** `startIdx` and `endIdx` are Float32 slots, exact only to
  `2^24 = 16777216`. A longer text is out of domain -- documented, not policed.

### Truncation

When `boxHeight > 0` and the wrap would push content past the bottom of the box,
the **last fitting line** is flagged `FLAG_TRUNCATED`. The renderer appends `...`
(three ASCII `.` glyphs) -- no per-frame string allocation. To make the ellipsis
fit cleanly, `computeWrap` tracks the latest position on each line where
*content + ellipsis* still fits within `boxWidth`; the truncated line ends there.

- If the font is missing `'.'` (code 46), `ellipsisWidth` is treated as `0`:
  content is still truncated to fit `boxHeight`, but no marker is drawn.
- If `boxWidth` is narrower than *content + ellipsis* at every position on a
  wrapped line, the truncated line falls back to `FLAG_NORMAL` (no ellipsis
  attempt), so the renderer never draws dots that would themselves overflow.

### Non-ASCII

Characters with `id >= 256` contribute zero advance and reset the kerning
context, matching `BitmapFont.draw`. Widths stay finite; no `NaN` propagation.

</details>

## API reference

<!--API-START-->

### `computeWrap(text, font, boxWidth, boxHeight, lineHeight, outBuffer, scale?) -> number`

`TextLayout.computeWrap` computes the layout, writes 4-tuples into `outBuffer`,
and returns the line count.

| Name         | Type                              | Notes                                                                 |
|--------------|-----------------------------------|-----------------------------------------------------------------------|
| `text`       | `string`                          | Source string.                                                        |
| `font`       | `BitmapFontData`                  | Anything with `glyphs: Int16Array` and `kerning: Int16Array`; a `BitmapFont` works directly. |
| `boxWidth`   | `number`                          | px; `0` for no horizontal limit.                                      |
| `boxHeight`  | `number`                          | px; `0` for no vertical limit (no truncation).                       |
| `lineHeight` | `number`                          | px at `scale=1`, usually `font.lineHeight`.                          |
| `outBuffer`  | `Float32Array`                    | Pre-allocated; capacity caps the line count at `floor(length / 4)`.  |
| `scale`      | `number` *(optional, default 1)*  | Applied to all widths and the height-fit check.                      |

When `outBuffer` is too small, the last written line's flags slot is set to
`FLAG_OVERFLOW` and the partial layout is a true prefix of the full result. A
zero-capacity buffer (length `0..3`) returns `0` and writes nothing. Use
`countLines` to size a buffer that can never overflow. `FLAG_OVERFLOW` and
`FLAG_TRUNCATED` are mutually exclusive in one call.

### `countLines(text, font, boxWidth, boxHeight, lineHeight, scale?) -> number`

`TextLayout.countLines` counts the lines `computeWrap` would write into an
unbounded buffer -- same parameters, same order, minus `outBuffer`. Size an
overflow-proof buffer as `new Float32Array(countLines(...) * 4)`. Agrees with
`computeWrap` on every wrapping and truncating call.

### `TextLayoutError`

```javascript
import { TextLayoutError } from '@zakkster/lite-text-layout';
```

`class TextLayoutError extends Error`, with `name === 'TextLayoutError'`. Both
entry points validate every argument once, at entry, through **one shared
validator** called as their first statement -- before the loop, never from
inside it. The message names the argument, what it received, and what is
required.

`NaN` is not infinity and `null` is not zero. Before 1.2.0 none of these threw:
`boxWidth = NaN` silently meant "no horizontal limit", `scale = NaN` silently
disabled wrapping, a 700-entry glyph table silently made every width `NaN`, and
`text = 12345` silently returned `0`.

| Argument       | Requirement                                  |
|----------------|----------------------------------------------|
| `text`         | a string                                     |
| `font`         | an object exposing both tables               |
| `font.glyphs`  | length `>= 1792` (256 ids x 7 fields)        |
| `font.kerning` | length `>= 65536` (256 x 256 pair LUT)       |
| `boxWidth`     | finite and `>= 0` (`0` means no limit)       |
| `boxHeight`    | finite and `>= 0` (`0` means no limit)       |
| `lineHeight`   | finite always; `> 0` when `boxHeight > 0`    |
| `scale`        | finite and `> 0`                             |
| `outBuffer`    | a `Float32Array` (`computeWrap` only)        |

Checks run in that exact order, so a tuple wrong in two places always reports
the same argument. `lineHeight` is conditional on purpose:
`computeWrap('AAA', font, 0, 0, 0, out)` does **not** throw -- with no vertical
box the value is never read -- while `computeWrap('AAA', font, 0, 32, 0, out)`
does.

**Cross-realm caveat.** The `outBuffer` check is `instanceof Float32Array`, so a
`Float32Array` from another realm (a `vm` context, an iframe) is rejected. That
is deliberate: the alternative is a duck-type check that accepts any object
naming itself `Float32Array`. Copy into a same-realm view.

**Aliasing.** An `outBuffer` overlapping `font.glyphs` through a shared
`ArrayBuffer` is caller error with an undefined result, and is **not** checked
at runtime -- a `.buffer` identity check would reject a caller packing *disjoint*
views into one arena, which is correct code.

### Constants

| Constant         | Value     | Meaning                                                         |
|------------------|-----------|-----------------------------------------------------------------|
| `FLAG_NORMAL`    | `0`       | Normal line.                                                    |
| `FLAG_TRUNCATED` | `1`       | The TEXT did not fit the BOX; renderer appends `...`.           |
| `FLAG_OVERFLOW`  | `2`       | The BUFFER did not fit the TEXT (a caller bug); set on the last written line. |
| `VERSION`        | `'1.4.0'` | Package version string.                                         |

**Law 6 -- flags are a value space; compare by equality, never by truthiness.**
`if (flags === FLAG_TRUNCATED)`, never `if (flags)`. The domain may widen in a
MINOR release; only equality against a named constant is stable across that
widening. See [`decisions/0001-flag-overflow.md`](./decisions/0001-flag-overflow.md).

<!--API-END-->

## Output buffer and range contract

Each line is **4 consecutive Float32 values**:

| Slot   | Field       | Description                                                          |
|--------|-------------|---------------------------------------------------------------------|
| `[0]`  | `startIdx`  | Char index in `text` where this line begins (inclusive).            |
| `[1]`  | `endIdx`    | Char index in `text` where this line ends (exclusive).              |
| `[2]`  | `lineWidth` | Measured pixel width of this line, including any ellipsis allowance. |
| `[3]`  | `flags`     | `FLAG_NORMAL` (0), `FLAG_TRUNCATED` (1), or `FLAG_OVERFLOW` (2).     |

The buffer must hold at least `lineCount * 4` floats; surplus capacity is
ignored, so one fat buffer can be reused across many strings.

```javascript
import { FLAG_TRUNCATED } from '@zakkster/lite-text-layout';

// Read line n from the buffer.
const o = n * 4;
const startIdx  = layout[o];
const endIdx    = layout[o + 1];
const lineWidth = layout[o + 2];
const flags     = layout[o + 3];

if (flags === FLAG_TRUNCATED) {
    // Content was longer than boxHeight allowed.
}
```

The four range facts are stated once and drift-guarded byte-for-byte across this
README, the source docstring, `TextLayout.d.ts`, and `llms.txt`
(`test/TextLayout.drift.test.js` fails if any surface's wording drifts):

```
RANGE-CONTRACT v1
startIdx is inclusive and endIdx is exclusive, and both are indices into the original string.
The breaking space is excluded from both sides.
Leading whitespace is skipped only after a soft break; it is content at text start and immediately after an explicit newline.
lineWidth is at the rendered scale and includes the ellipsis allowance on a FLAG_TRUNCATED line.
END RANGE-CONTRACT
```

## Composability with the ecosystem

The whole pipeline, atlas to blitted glyphs, passing flat typed arrays at every
stage:

<!--RUN-->
```javascript
import { BitmapFont } from '@zakkster/lite-bmfont';
import { TextLayout } from '@zakkster/lite-text-layout';

// 1. Build the font once from an atlas image and its BMFont descriptor.
const font = new BitmapFont(atlasImage, fontJson);

const text = 'Welcome, traveller. The road ahead is long and the night is cold.';

// 2. Size an overflow-proof buffer with countLines, then compute the layout.
const box = { w: 220, h: 96 };
const lineCount = TextLayout.countLines(text, font, box.w, box.h, font.lineHeight);
const layout = new Float32Array(lineCount * 4);
const written = TextLayout.computeWrap(
    text, font, box.w, box.h, font.lineHeight, layout, 1,
);

// 3. Re-render every frame from the same buffer -- zero layout work per frame.
font.drawWrapped(
    ctx, text, layout, written,
    box.w, box.h, /* x */ 16, /* y */ 16,
    /* scale */ 1, /* align */ 0, /* vAlign */ 0,
);
```

`countLines` and `computeWrap` agree on the line count by construction, so the
buffer is exactly the right size and never overflows. Every stage passes a flat
`Float32Array` to the next -- no string splitting, no array conversion, no
allocation between planning and drawing.

## Zero-GC design notes

<details>
<summary>What the hot path allocates (nothing), and how it stays that way.</summary>

`computeWrap` and `countLines` hold all state in local primitives -- current x,
the last-space index, the line start, the running kerning id -- and read glyph
advances and kerning from the caller's font arrays. The only writes are into the
caller's `outBuffer`. There is no internal buffer, no closure, no per-call
object; the functions never read a slot they did not write this call.

| Operation                 | Steady-state allocations                          |
|---------------------------|---------------------------------------------------|
| `computeWrap` main loop   | **0** (writes into the caller's `outBuffer`)      |
| `countLines` main loop    | **0** (counts only, no buffer)                    |
| The input validator       | **0** on the happy path; a string only on a throw |

The validator's error strings are built only on the throw path -- never in
steady state. The torture gate (`@zakkster/lite-leak` + `@zakkster/lite-gc-profiler`,
run under `--expose-gc`) proves it:

- **TL-20 -- zero allocation.** 20000 `computeWrap` ops over a 360-char
  paragraph into a reused `Float32Array(256)`: verdict **pass**, **major 0,
  minor 0**, maxMs 0.000. Source of the collections observed: none.
  *Measured on 1.2.2, node v26.3.1 arm64.*
- **TL-21 -- near-linear, not quadratic.** The soft-break rescan costs about
  **1.16 glyph-table reads per character** on a 6000-char wrap (341 lines) and
  about **1.28 reads per character** on a narrow box (~836 lines). The rescan a
  reader of the loop might fear to be quadratic is a small constant factor.
  *Measured on 1.2.2, node v26.3.1 arm64.*

**The allocation-free pair, end to end.** `computeWrap` writing into a buffer you
own and bmfont's `drawWrapped` (`>= 1.6.0`) reading straight from it is 0
bytes/frame across the whole layout-to-glyphs pipeline -- neither half allocates
per frame, so a consumer can reason about which pairings are allocation-free.
The TL5 torture lane gates the pair together (`computeWrap` + `drawWrapped` over
a wrapped paragraph): verdict **pass**, **major 0, minor 0**, **0 B/op**.
*Measured on 1.4.0, node v26.3.1 arm64.*

<!--RUN-->
```javascript
import { BitmapFont } from '@zakkster/lite-bmfont';
import { TextLayout } from '@zakkster/lite-text-layout';

// The allocation-free PAIR. computeWrap writes ranges into a buffer you own;
// bmfont's drawWrapped (>= 1.6.0) renders straight from it. Both halves
// allocate nothing per frame, so layout-to-glyphs is 0 bytes/frame end to end.
const font = new BitmapFont(atlasImage, fontJson);

const text = 'Layout once, render every frame from the same buffer.';

// Allocate the layout buffer ONCE, outside the frame loop.
const layout = new Float32Array(64);

// boxHeight 0 means never truncate -- the paragraph lays out in full.
const lineCount = TextLayout.computeWrap(
    text, font, /* boxWidth */ 240, /* boxHeight */ 0,
    /* lineHeight */ font.lineHeight, layout, /* scale */ 1,
);

// One render frame: no computeWrap, no measureText, no split -- just re-blit
// from the buffer. Repeating this call 60x a second allocates nothing.
font.drawWrapped(
    ctx, text, layout, lineCount,
    /* box */ 240, 0, /* x */ 12, /* y */ 12,
    /* scale */ 1, /* align */ 0, /* vAlign */ 0,
);
```

</details>

## Benchmarks

Wall-time behaviour, not throughput tables -- the point of this package is what
it does *not* spend per frame:

```
Word-wrapping a 50-word paragraph each frame at 60 fps:
  ctx.measureText + manual line-build:  allocates strings/arrays every frame -> GC jitter
  TextLayout.computeWrap(buffer):       zero allocation -- output buffer is reused

Re-rendering an already-laid-out paragraph at 60 fps:
  any measure-per-frame engine:  re-runs layout on every frame
  drawWrapped(layout):           zero layout work -- the buffer is just indices and widths
```

The zero-allocation and near-linear-rescan numbers behind these claims are
gated (see [Zero-GC design notes](#zero-gc-design-notes)); a regression that
starts allocating fails the torture gate as loudly as a leak would.

## Design decisions worth knowing

- **Ownership boundary with `lite-bmfont`.** This package *lays out*; bmfont
  *draws*. `computeWrap` decides where lines break and how wide each is; it
  never blits a glyph. The two share one data shape -- the `Float32Array` layout
  buffer and the `glyphs`/`kerning` tables -- so they compose without a
  translation layer, but neither owns the other's job.
- **`FLAG_OVERFLOW` is distinct from `FLAG_TRUNCATED`.** `FLAG_TRUNCATED` means
  the TEXT was too big for the BOX -- expected, and the renderer draws an
  ellipsis. `FLAG_OVERFLOW` means the BUFFER was too small for the TEXT -- a
  caller bug in buffer sizing. Collapsing them would hide a programming error
  behind an expected content state. See
  [`decisions/0001-flag-overflow.md`](./decisions/0001-flag-overflow.md).
- **Indentation is preserved deliberately (TL-14).** Leading whitespace is
  content at the start of the text and immediately after an explicit `\n`;
  `computeWrap('   ', ...)` is one line of width `3 * space`, not an empty
  layout. It is skipped only after a soft break, where it would otherwise open
  the next line with a phantom gap. Destroying indentation silently is the wrong
  default; call `trim()` yourself if you want it gone.
- **`lineWidth` is at the rendered scale and includes the ellipsis allowance
  (TL-12).** A `FLAG_TRUNCATED` line measures wider than the glyphs in
  `[startIdx, endIdx)` -- for content 36 plus an 18px ellipsis the slot reads
  `54`, not `36`. A consumer summing widths for centring must expect this. The
  cross-package scale note (TL-25, filed against bmfont) is that `lineWidth` and
  the renderer's alignment math must agree on the same scale convention; both
  read this contract, so they do.
- **bmfont 1.x and 2.x are both supported (TL-28).** lite-bmfont 2.0.0 moved its
  advance and kerning stores to 1/16 fixed point (`stored * 0.0625`); 1.x stores
  whole pixels. This package decodes by feature-detecting the font's `advanceOf`
  accessor once at the input door -- present on 2.x, absent on 1.x -- and folds
  the factor into the scale, so the per-character loop pays no extra branch and a
  1.x font lays out byte-identically to before. `FORMAT_VERSION` is a bmfont
  module export, not a property of the font object this package receives, so a
  version handshake is not possible; the accessor is the only instance-reachable
  signal. See
  [`decisions/0005-bmfont-fixed-point.md`](./decisions/0005-bmfont-fixed-point.md).

## Testing

**68 deterministic `node:test` cases plus five test files**, plus a torture gate
that proves leak-freedom and the zero-allocation claim, and two drift guards
that keep the docs from rotting out of sync with the code.

```bash
npm test          # node:test: contract + boundary + range-drift + docs-drift + snippets
npm run torture   # @zakkster/lite-leak + lite-gc-profiler: 0 B/op, 0 retained, 0 major GC
npm run verify    # test + torture, the publish gate
```

The suites cover the wrapping and truncation contract, the full fail-closed
validation surface (every named-error path), buffer overflow and `countLines`
agreement, and CRLF / leading-whitespace / over-wide-glyph edge cases. Two
guards keep the documentation honest: `TextLayout.drift.test.js` pins the
range-contract sentences byte-identical across four surfaces, and
`TextLayout.docsdrift.test.js` asserts every runtime export is documented and
every documented API name resolves at runtime. `TextLayout.snippets.test.js`
extracts the runnable README blocks and executes this package's calls so a
copied example cannot silently rot.

## What this is not

- **Not a renderer.** It computes layout; `@zakkster/lite-bmfont` draws.
- **Not a justification engine.** No full or inter-word justification -- that
  needs a per-space distribution in the output stride, a breaking change in two
  packages.
- **Not bidi or RTL.** ASCII bitmap oriented, matching bmfont's 8-bit kerning
  LUT.
- **Not a hyphenator.** Hyphenation needs a dictionary, which is not a
  zero-dependency feature.
- **Not a per-glyph advance API.** That would duplicate bmfont's kerning LUT and
  give two packages two chances to disagree.

Each of these is deferred on purpose; see the
[Deferred section of `ROADMAP.md`](./ROADMAP.md#deferred-indefinitely).

## Ecosystem

Part of the **@zakkster** zero-GC stack:

- [`lite-bmfont`](https://www.npmjs.com/package/@zakkster/lite-bmfont) -- the
  bitmap-font renderer; consumes this package's layout buffer.
- [`lite-signal`](https://www.npmjs.com/package/@zakkster/lite-signal) -- zero-GC
  reactive graph for hot paths.
- [`@zakkster/lite-*`](https://www.npmjs.com/org/zakkster) -- ~170 zero-GC,
  single-file micro-libraries for deterministic, cache-friendly development.

## License

MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
