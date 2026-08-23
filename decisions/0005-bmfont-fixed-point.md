# 0005 -- decode bmfont's 1/16 fixed-point store by feature detection (TL-28)

Status: accepted
Date: 2026-08-23
Session: TL6 (v1.4.0)
Findings: TL-28
Related: decisions/0003-scale-contract.md, decisions/0004-nonascii-kerning-seam.md

## Context

`@zakkster/lite-bmfont` 2.0.0 moved the glyph advance (`glyphs[id * 7 + 6]`) and
the 64K kerning LUT to 1/16 FIXED POINT: whole pixels are recovered with
`stored * GLYPH_ADVANCE_SCALE`, where `GLYPH_ADVANCE_SCALE === 0.0625`. A 1.x
font stores whole pixels and needs a factor of 1.

This package reads both stores directly (nine expressions across `computeWrap`
and `countLines`) and multiplied only by `scale`. Against any bmfont >= 2.0.0
font that makes every computed width EXACTLY 16x too large; wrap collapses to
roughly three characters per line and nothing throws. Measured 2026-08-22
against bmfont 2.0.2: a 10-glyph string at `xadvance` 10 gives `bmfont.measure`
100 and this package's `lineWidth` 1600; a 306-char paragraph at `boxWidth` 560
wraps to 97 lines instead of 7. Filed here as TL-28, in the peer as F-56.

The single documented purpose of this package is to emit the buffer
`BitmapFont.drawWrapped` consumes, so against the current major of that consumer
it emits silently wrong geometry -- corruption of its one output, S1.

## Decision

Detect the store format ONCE, at the shared input door (`validateInput`), and
fold the decode factor into a per-call `s16 = scale * advScale`. Every one of
the nine advance/kerning reads uses `s16`; caller-space geometry
(`lineHeight * scale`) keeps raw `scale`.

```
advScale = (typeof font.advanceOf === 'function') ? 0.0625 : 1;
```

`advanceOf` is the detection signal. It is a 2.x prototype method (with `kernOf`
and, module-side, `GLYPH_ADVANCE_SCALE`); bmfont 1.6.0 contains zero
occurrences of any of the three. Verified against 1.6.0 and 2.0.2.

The factor is folded into `scale` rather than applied as a second multiply per
read, and the fold matches bmfont's own `_measureRange` (`s16 = scale * 0.0625`,
`BitmapFont.js:462`) TERM FOR TERM. Two reasons:

1. Hot-path law: `s16` is one multiply at entry and zero added multiplies in the
   per-character loop -- each site swaps `* scale` for `* s16`.
2. A1 requires `computeWrap`'s `lineWidth` to equal `font.measure(text, scale)`
   exactly. bmfont computes `stored * (scale * 0.0625)`; float multiply is not
   associative, so `stored * scale * 0.0625` could differ by a ULP and diverge.
   Mirroring bmfont's fold order makes the two packages agree to the bit.

## Why FORMAT_VERSION is not usable

`FORMAT_VERSION` and `GLYPH_ADVANCE_SCALE` are MODULE exports of bmfont, not
instance properties. A `BitmapFont` instance carries
`atlas, lineHeight, base, glyphs, kerning, _charScratch, _mapped, checked` and
no version; this package receives a duck-typed `{ glyphs, kerning }`. A
`font.FORMAT_VERSION` check would read `undefined` forever and silently select
the whole-pixel branch -- the exact silent-miscompute failure being fixed.
Verified on a live 2.0.2 instance: `'FORMAT_VERSION' in font` is false.

## Rejected alternatives

- **Call `font.advanceOf(id)` / `font.kernOf(a, b)` per glyph.** Correct, and it
  would track any future encoding for free -- but it puts a method call in the
  hot loop of a package whose identity is one linear pass, for no accuracy gain
  over the constant.
- **Always multiply by 0.0625.** Breaks every 1.x font, which is most of them.
- **Sniff the magnitude** ("advances look 16x too big") or **probe the ratio**
  (`advanceOf(id) / rawSlot6(id)` at entry). A heuristic on unverified state;
  the probe additionally needs a fallback when the probe glyph's raw slot is 0.
  This suite's law is that a gate exemption is an unverified state, and a format
  guess is the same defect wearing a different hat.
- **`font.FORMAT_VERSION`.** Not reachable on the instance (above).

## Fail-closed posture on an unknown future format

The chosen detection couples one fact -- presence of `advanceOf` -- to one
conclusion: the stores are in 1/16 fixed point. This is fully correct for the
two majors that exist (1.x, 2.x). It is NOT fail-closed against a hypothetical
bmfont 3.0 that keeps `advanceOf` but changes the encoding scale again: such a
font would be silently mis-scaled.

That residual is accepted, deliberately, for three reasons:

1. There is no instance-reachable signal that could detect it. Every candidate
   (FORMAT_VERSION, GLYPH_ADVANCE_SCALE) is module-side and invisible here, and
   the alternatives that could (per-glyph accessor, ratio probe) are rejected
   above on hot-path and unverified-state grounds.
2. It does not exist yet. Encoding a guard against an unspecified future format
   is itself an unverified assumption about what that format will look like.
3. The coupling is written loudly -- here, in the source comment at the
   detection site, and in `llms.txt`/`README` as "widths are decoded for
   bmfont >= 2.0.0". When a third format ships, this decision is the first thing
   its integrator reads, and the fix is one line at one site.

If a future maintainer wants a hard floor instead, the honest form is to require
the CALLER to pass the decode factor explicitly for any font this package cannot
place in `{1.x, 2.x}` -- a signature change, deferred until a third format makes
it concrete.

## Consequence

- A 1.x (or hand-rolled whole-pixel) font: `advScale === 1`, `s16 === scale`
  exactly (multiply by 1.0 is exact), output BYTE-IDENTICAL to v1.3.0 (A3).
- A 2.x font: widths decoded, `lineWidth === font.measure(text, scale)` (A1),
  `computeWrap` and `countLines` agree because both fold independently (A5).
- Hot path: one entry-time multiply, zero added loop multiplies, zero branches
  in the per-character body (A6).

## Falsifiability -- the Phase 3 mutation matrix

Each of the NINE store reads the fold touches was reverted to raw `* scale`, ONE
at a time, in a sandbox copy of the tree (never the live tree), and the suite was
watched go red. A cited-but-never-run mutation is not evidence; every row below
was applied and observed. `advScale` is folded into `s16 = scale * advScale`, so
the mutation is `* s16 -> * scale` at the named site.

| Site | what it reads | mutation reddens at |
|---|---|---|
| `:479` | glyph advance (computeWrap) | T6 (16x widths overflow the buffer -> a FLAG_OVERFLOW line -> a checked 2.x drawWrapped throws); independently T8 section 1 |
| `:478` | kerning (computeWrap)        | T8 section 7 A1-kerned (`ABAB` width != measureLine) |
| `:377` | ellipsis '.' advance         | T8 section 2 (a truncated line's ellipsis allowance moves) |
| `:413` | CR glyph advance             | T8 section 7 A4 (CRLF line-0 width stops matching LF) |
| `:416` | CR kerning                   | T8 section 7 A4 (needs `kern(A, CR) != 0` in the fixture, else inert) |
| `:551` | cursorX re-seed (computeWrap) | T8 section 1 on a hard-break line |
| `:703` | glyph advance (countLines)   | T8 section 7 A5 (countLines != computeWrap) |
| `:702` | kerning (countLines)         | T8 section 7 A5-kerned |
| `:738` | cursorX re-seed (countLines) | T8 section 7 A5 |
| detect | force `advScale = 0.0625`    | A3: T0 width law (every whole-pixel tier mis-decodes) |

Inert-test shapes encountered and handled (the five the brief names):

- **(1) mutation cannot redden.** `:416` (CR kerning) was initially inert: the CR
  fixture had no `kern(pre-CR, CR)`, so the term was 0 and the mutation changed
  nothing. Closed by adding `kern(A, CR) = -3` to the section-7 CR fixture.
- **(2)/(5) a cheaper assertion or another lane preempts.** `:479` is caught at T6
  before its T8 section-1 catcher, because a global 16x makes the buffer overflow
  and a checked 2.x `drawWrapped` throws first. A3's `advScale = 0.0625`
  unconditional is caught at T0 before its own section-1b lane, because it
  mis-decodes every whole-pixel tier. Both still redden -- the fix is protected --
  and the section-1b / section-1 lanes remain the DIRECT witnesses; they are not
  vacuous, they are merely downstream of an earlier tripwire for these
  particular whole-magnitude mutations. A per-site mutation that stays local to
  one lane (`:478`, `:702`, the CR reads) fires exactly at its own assertion.
- **(3) import crash / (4) hang.** None: every mutation is a runtime value change,
  the files parse, and every run terminated.
