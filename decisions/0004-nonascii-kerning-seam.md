# 0004 -- the non-ASCII kerning seam is a carved exception (TL-28)

Status: accepted
Date: 2026-08-17
Session: TL3 (v1.2.1)
Findings: TL-28
Related: decisions/0003-scale-contract.md

## Context

TL3 makes the width contract executable across the package boundary with the
assertion `lineWidth === font.measure(text.slice(startIdx, endIdx), scale)`.
That assertion is TRUE on every ASCII line -- and FALSE on any line where a
non-ASCII character sits adjacent to a kerning pair, because the two packages
disagree, ON PURPOSE, about kerning across a non-ASCII gap.

`computeWrap` documents and implements: "chars with id >= 256 contribute zero
advance and RESET the kerning context." So the character after a `>= 256` id
does not kern against the character before it.

`@zakkster/lite-bmfont`'s `_measureRange` / `draw` / `drawWrapped` (all three
now share the F-03 reference form, e.g. `BitmapFont.js:157`) do NOT reset: an
out-of-range id is SKIPPED (`if (id >= 0 && id < 256)`) and `prevId` is left
intact, so kerning BRIDGES the gap.

Verified live this session against the installed peer (bmfont v1.2.3), font
`{A: adv 12, B: adv 12}`, `kerning(A, B) = -5`, text `'A' + U+20AC + 'B'`:

```
computeWrap lineWidth   -> 24    (A + B, NO kern; the U+20AC EURO reset the context)
font.measure(slice, 1)  -> 19    (A + B - 5; the kern bridged the U+20AC EURO)
```

Both packages are INTERNALLY consistent and each behaviour is documented in its
own package. They produce the SAME number on any ASCII line -- which is every
line a bitmap-font tool is for. But `24 !== 19`, so the width-agreement
assertion is FALSE on this input and would be VACUOUSLY true on the TL2 corpus,
whose `GLYPH_IDS` are ASCII letters only (`harness.mjs`). This is the F-24
vacuity shape on the layout/measure seam: an agreement asserted only because no
test ever emits the input that breaks it.

## The fork

**A. SCOPE the width-agreement assertion to ASCII ranges.** `computeWrap` resets
the kerning context on `id >= 256`; the peer's measure bridges it. Both are
internally consistent and documented. They agree on every ASCII line. State the
scope in the T8 tier header and here, keep `GLYPH_IDS` ASCII, and record that a
non-ASCII line is OUT OF the agreement's domain -- not that either package is
wrong.

**B. Reconcile the two packages on non-ASCII kerning-reset.** This means
deciding which package changes its documented, shipped, tested behaviour. That
is a semantic change to a shipped contract on ONE side, smuggled into a
documentation session on the OTHER. Wrong venue. If reconciliation is wanted it
is a bmfont finding (the F-24 family already lives there) with its own decision
record and its own release, not a TL3 side effect.

## Decision

**A now; file B as a bmfont finding.**

- The T8 width-agreement corpus is ASCII-only BY DECISION (not by accident). The
  tier header states the scope and cites this file. `GLYPH_IDS` stays ASCII.
- TL-28 is recorded in the ledger as **scoped, not fixed**, with the measured
  `24` vs `19` evidence.
- A single non-ASCII PROBE lives in the SAME T8 file as the width-agreement
  assertion, so the boundary is visible to the next reader. The probe asserts
  `computeWrap('A' + U+20AC + 'B') -> lineWidth 24` and
  `font.measure(slice, 1) -> 19`. It DOCUMENTS the divergence as defined
  behaviour; it is explicitly NOT a they-agree assertion. If either package
  changes its non-ASCII policy, the probe fails and this record is revisited.
- B is filed against `@zakkster/lite-bmfont` as the reconciliation finding: make
  measure/draw/drawWrapped RESET the kerning context on a skipped `>= 256` id so
  it matches `computeWrap`. It carries its own decision record and release
  there. This package does not change: `computeWrap`'s reset is the documented,
  correct-for-a-bitmap-atlas behaviour (a `>= 256` id has no glyph in a 256-slot
  atlas, so there is nothing to kern against).

## Why the width assertion's ASCII scope is not a weakness

The scope is stated, and the boundary (the TL-28 probe) lives beside the
assertion. The reader cannot MISTAKE the assertion for a general width proof: it
proves agreement WITHIN its domain (ASCII, which is the whole domain of a bitmap
font in this suite), and the probe marks exactly where that domain ends. A
corpus that silently never emitted a EURO would be the vacuity; a stated scope
with the counter-example pinned next to it is the opposite.

## Consequences

- No change to `TextLayout.js`.
- T8's width-agreement corpus is ASCII; the TL-28 probe documents the seam.
- This file is a planning artifact and is NOT added to `package.json` `files[]`.
