# 0003 -- lineWidth is at the RENDERED scale (TL-25)

Status: RESOLVED (accepted TL3; closed in the peer TL5)
Date: 2026-08-17 (resolved 2026-08-19)
Session: TL3 (v1.2.1); resolved TL5 (v1.3.0)
Findings: TL-25
Related: decisions/0001-flag-overflow.md, decisions/0002-input-door.md

## RESOLVED (TL5, 2026-08-19)

TL-25 is fixed IN THE PEER, exactly as this record predicted. `@zakkster/lite-bmfont`
1.6.0 (finding F-45) dropped the `* scale` from `drawWrapped`'s alignment terms:
it now compares `lineWidth` DIRECTLY to `boxWidth` (`BitmapFont.js:1136-1137`,
`(boxWidth - lineWidth) / 2` and `boxWidth - lineWidth`), adopting THIS package's
rendered-scale contract; bmfont's Law now reads `lineWidth@render-scale`. TL5
bumped the devDependency floor to `^1.6.0` and PROMOTED the T8 detector from
`knownFailing('TL-25', ...)` to a live assertion: the recorded first-dx equals
`round(boxWidth - lineWidth)` at scale 0.5, 1 AND 2 (`test/torture/t8-cross.mjs`,
the hoisted `tl25`/`ALIGN_BW` at :146,152). T9 control 6 drives the SAME
`alignMisses` detector with the pre-1.6.0 double-scaled formula and proves the
promoted assertion still rejects it. `known-failing` is back to 0. Decision A
below stands unchanged -- `TextLayout.js` never moved.

## Context

`computeWrap` writes four floats per line: `[startIdx, endIdx, lineWidth,
flags]`. `lineWidth` is the pixel width of the line's glyph range. The question
this record settles is the ONE that two packages sharing this buffer must not
disagree on: is `lineWidth` measured at scale 1, or at the rendered scale?

`computeWrap` multiplies every advance and every kerning term by `scale` as it
accumulates the width (`TextLayout.js`, the `advance` and `cursorX`
computations). Measured live this session against the installed peer
(`@zakkster/lite-bmfont` v1.2.3 -- NOT the v1.2.0 the roadmap's stale line
claims):

```
computeWrap('AAAA BBBB', F, 0, 0, 16, out, s):  lineWidth  51 / 102 / 204   at s = 0.5 / 1 / 2
```

So `lineWidth` scales with `scale`: it is at the RENDERED scale.

`@zakkster/lite-bmfont`'s `drawWrapped` disagrees in writing. At
`BitmapFont.js:476` a comment asserts "`lineWidth` is at scale=1 per contract",
and at `:479-480` it aligns with `boxWidth - lineWidth * scale`:

```
drawWrapped then uses lineWidth * scale for alignment:   25.5 / 102 / 408   at s = 0.5 / 1 / 2
```

At `scale === 1` the two agree (`102 === 102`), which is why the disagreement
has never been seen: the README's Full Example, and every hand-written example,
pass `1` to both. At every `scale !== 1` they disagree by a factor of `scale`:
`25.5` where `51` is right, `408` where `204` is right. A right-aligned or
centred multi-scale layout is mispositioned by exactly `lineWidth * (scale - 1)`
pixels per line. Two packages, one number, two beliefs -- exactly the failure
the FORMAT contract exists to prevent.

## The fork

**A. `lineWidth` is at the RENDERED scale** (what this package does).
`drawWrapped` drops its `* scale` on the two alignment terms, aligning with
`boxWidth - lineWidth`. Cheapest: it matches the code that produced every layout
buffer this package has ever shipped, the fix is one term in the peer and ZERO
here, and it makes the peer's own comment true by deleting the clause that made
it aspirational.

**B. `lineWidth` is at scale 1** (what the peer's comment claims). This package
would stop scaling the STORED width -- but it still must scale internally for
the `cursorX + advance > boxWidth` wrap comparisons (those are in rendered
pixels against `boxWidth`, which is a rendered-pixel box). So it would compute
the scaled width, then DIVIDE it back out before storing: a division per line
for the benefit of a comment, and a second multiply back in every consumer. Bad
trade, and it changes a shipped, tested output field in a way that breaks every
existing correct-at-scale-1 caller for no gain.

## Decision

**A.** `lineWidth` is at the RENDERED scale, and this package does not change.

It is what the data already says. It needs no change in this package -- the
subject stays frozen at sha `2d198b7a...`, verified before and after this
session. And it makes the peer's comment true instead of aspirational.

The truncated-line corollary (TL-12, unchanged): on a `FLAG_TRUNCATED` line the
stored `lineWidth` INCLUDES the ellipsis allowance, `3 * xadvance('.') * scale`,
also at the rendered scale. The width of a truncated line therefore measures
wider than its character range by exactly that allowance. This is asserted as a
literal in the T8 tier, not an inequality.

## The promotion mechanism -- TL-25 closes in the PEER, not here

This package's whole job in TL3 is to make the claim EXECUTABLE and to file the
one-term peer change with a failing test attached. Recorded explicitly so the
next reader does not expect the fix here:

- TL-25 is **not** closed in this session. It ends TL3 as the single named,
  counted, non-exiting `knownFailing('TL-25', ...)` entry in the torture gate's
  T8 tier (`known-failing=1`). The detector asserts that `drawWrapped`'s
  alignment agrees with `computeWrap`'s rendered-scale `lineWidth` for `scale`
  in `{0.5, 1, 2}`; it PASSES at `1` and FAILS at `0.5` and `2` against the
  installed peer today.
- The buggy CODE PATH is in bmfont (`BitmapFont.js:479-480`), not in
  `computeWrap`. `computeWrap`'s scaled width is correct on its own. Asserting a
  `computeWrap` value here as the finding would be the AR-02 trap (a value near
  the finding, not the code path it names), so the subject-side fact
  (`computeWrap`'s width scales) is pinned as a PASSING precondition and the
  cross-package disagreement is the `knownFailing`.
- TL-25 is filed against `@zakkster/lite-bmfont` as a minor bump: `drawWrapped`
  drops `* scale` on the two alignment terms at `BitmapFont.js:479-480`, and the
  `:476` comment is corrected from "at scale=1 per contract" to "at the rendered
  scale". The TL-25 detector body ships as the failing test attached to that
  brief; it flips from `knownFailing` to a passing assertion in the SAME commit
  as the peer fix -- and the `knownFailing` entry is deleted then, not before. A
  silently-red gate is a gate nobody reads; a gate red with one named entry is a
  filed bug.

## Consequences

- No change to `TextLayout.js`. The HOT PATH is unchanged; the diff of TL3 is
  documentation, a test-only devDependency, a torture tier, and test-harness
  additions.
- The FORMAT is now falsifiable across the package boundary: T8 measures
  `lineWidth === font.measure(text.slice(startIdx, endIdx), scale)` within one
  f32 ulp (ASCII-scoped -- see `0004-nonascii-kerning-seam.md`) and asserts the
  truncated-line allowance as a literal.
- This file is a planning artifact and is NOT added to `package.json` `files[]`.
