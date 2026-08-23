# 0001 -- FLAG_OVERFLOW = 2 is a MINOR release

Status: accepted
Date: 2026-08-17
Session: TL1 (v1.1.0)
Findings: TL-01, TL-02, TL-11

## Context

`computeWrap` caps the line count at `floor(outBuffer.length / 4)` and, in the
words of its own 1.0.2 docstring, "extra content is silently dropped." That is
fail-OPEN: an undersized buffer produces output byte-for-byte identical to a
correct short layout, so the caller renders a truncated paragraph that looks
deliberate and has no way to detect the loss. TL0 pinned that
indistinguishability as an executable `knownFailing` entry (TL-01). TL1 removes
it by writing `FLAG_OVERFLOW = 2` into the flags slot of the last written line
whenever an unbounded run would have produced more lines.

The question this record settles is the semver rank of adding a third value to a
field that shipped documented as taking `{0, 1}`.

## Decision

The release is MINOR (1.0.2 -> 1.1.0).

### The three-point argument for MINOR

1. **Value 2 is reachable only on a call that is already wrong today.** The flag
   is set if and only if the buffer was too small for the text -- a caller bug.
   Every call that sizes its buffer correctly (including every call that uses the
   new `countLines` to do so) continues to see only `0` and `1`, byte-for-byte
   as before. No correct program can observe the new value.

2. **The one in-tree consumer already reads the field by equality.**
   `BitmapFont.drawWrapped` draws the ellipsis under `if (flags === 1)` at
   `../LiteBmfont/BitmapFont.js:361`. A `2` fails that test and falls through to
   "no ellipsis," which is exactly the right rendering for an overflow line: the
   text did not fit the box for a capacity reason, not a design one, so no "..."
   should be drawn. The existing consumer is correct against the new value with
   no change.

3. **The residual risk is cosmetic and confined to the already-broken case.**
   The only way the new value bites is a consumer whose branch is
   `if (flags) drawEllipsis()` -- treating "not 0" as truncated. Such a consumer
   would draw an ellipsis on an overflow line. That is a cosmetic artifact, and
   it appears only on a call that was already dropping content silently, i.e. a
   call that was already producing wrong output. The change replaces silent data
   loss with a visible-and-slightly-wrong marker on the same broken input. That
   is strictly more honest, never less.

### The counter-argument, in full

It is not free, and pretending otherwise would be dishonest:

- **The documented value space grew.** 1.0.2 published `Flags: 0 = normal,
  1 = truncated`. A downstream type, schema, or doc that enumerated exactly those
  two values is now incomplete. Anyone who wrote `type LineFlag = 0 | 1` has a
  type that no longer matches the runtime.
- **An exhaustive `switch` now has an unhandled arm.** A consumer who wrote
  `switch (flags) { case 0: ...; case 1: ...; }` with no `default` -- believing
  they had covered the space -- now silently does nothing on a `2`. Under a
  linter that demanded exhaustiveness over `{0, 1}`, the code compiled clean and
  is now wrong.
- **Someone will call that breaking.** A maintainer who holds "any widening of a
  documented output domain is a breaking change" will read this as a MAJOR, and
  they are not being unreasonable -- they are applying a stricter, defensible
  rule than the one adopted here.

### Resolution

The MINOR verdict stands, because every failure mode above requires the caller
to have (a) sized the buffer wrong and (b) branched on the flag by truthiness or
by an assumed-closed value space. (a) is a bug this release exists to surface;
(b) is a contract violation this record now names and forbids for our own code.
The honest cost -- a widened domain that a strict reader may rank MAJOR -- is
recorded here rather than hidden, and the CHANGELOG points at this file.

The rule it produces, adopted suite-wide:

> **Law 6 -- flags are a value space; compare by equality, never by
> truthiness.** `if (flags === FLAG_TRUNCATED)`, never `if (flags)`. A flags
> field is an enumeration whose domain may widen in a MINOR release; only
> equality against a named constant is stable across that widening. Truthiness
> and `switch` without `default` are contract violations, not the library's.

## The zero-capacity contract

There is no flags slot to write into when no line was written, so the buffer-full
signal has nowhere to live at zero capacity. The contract is therefore:

- `computeWrap(text, ...)` with `floor(outBuffer.length / 4) === 0` (buffer
  length `0`, `1`, `2`, or `3`) returns `0` and **writes nothing**. The early
  return at the top of the function keeps its exact position and behaviour.
- The caller detects a swallowed non-empty layout as
  `n === 0 && typeof text === 'string' && text.length > 0`. This detection rule
  is documented in the docstring, `TextLayout.d.ts` and `llms.txt`.
- It does NOT throw (that is TL2's door), does NOT return `-1` (no sentinel --
  an explicit non-goal), and does NOT write into a buffer of length `1..3`
  (there is no whole 4-slot stride, and a partial write is worse than silence).

`countLines` exists precisely so a caller never has to hit this case: size the
buffer as `new Float32Array(countLines(text, font, boxWidth, boxHeight,
lineHeight, scale) * 4)` and overflow becomes unreachable.

## FLAG_OVERFLOW wins over FLAG_TRUNCATED -- and the combination is unreachable

Precedence rule, written down even though it never fires: when both conditions
could apply, `FLAG_OVERFLOW` wins, because `FLAG_TRUNCATED` is a designed outcome
(the text did not fit the box, ellipsis included) while `FLAG_OVERFLOW` is a
caller bug that must be heard.

Unreachability proof that the combination cannot occur in one call:

- The two in-loop truncation `return`s each write exactly four slots and
  `return lineCount + 1`. At both sites the top-of-loop break has already
  guaranteed `lineCount <= maxLines - 1`, so `ptr + 4 <= 4 * maxLines`: a
  truncation return can never overrun the buffer, and it returns immediately
  without reaching the post-loop tail where `FLAG_OVERFLOW` is written.
- An unbounded run (`OUT_BIG`) takes identical branches inside the loop --
  nothing in the loop body reads `maxLines` except the break -- so it truncates
  at the same place and yields `lineCount + 1 <= maxLines` lines. By the overflow
  definition (`FLAG_OVERFLOW` iff the unbounded run produced MORE lines than the
  cap), a truncating call therefore never overflows.

Hence `FLAG_TRUNCATED` and `FLAG_OVERFLOW` cannot both appear in one call's
output. The one case that looks like a conflict and is not: if the break fires on
an iteration where an unbounded run would have truncated, the unbounded run
yields `maxLines + 1` lines, the definition says overflow, the code writes
`FLAG_OVERFLOW`, and the caller loses the ellipsis on a layout that was already
wrong. Consistent. The precedence rule is asserted as unreachable rather than
implemented as a resolution.

## Consequences

- `FLAG_NORMAL`, `FLAG_TRUNCATED`, `FLAG_OVERFLOW` are `0`, `1`, `2`; pairwise
  distinct; compared by equality everywhere.
- The partial layout is preserved and is a true prefix: for capacity `m` lines it
  equals the first `m` lines of the unbounded run, byte-identical except slot
  `4m - 1`, which is `FLAG_OVERFLOW` when `countLines > m` and equal otherwise.
- This file is a planning artifact and is NOT added to `package.json` `files[]`.

## Amendment (TL6, v1.4.0, 2026-08-23): the "inert in drawWrapped" premise is now checked-lane-dependent

The MINOR argument above rested on a load-bearing fact about the consumer: that
`FLAG_OVERFLOW` (2) is inert in `BitmapFont.drawWrapped` because the peer keyed
its ellipsis on `flags === 1`, so a `2` fell through harmlessly. That was true
against `@zakkster/lite-bmfont` 1.x.

**bmfont 2.0 (F-49) changed it.** `drawWrapped` now runs a flags-mask door:
`if (checked && (f & ~FLAG_MASK)) throw`, with `FLAG_MASK === 1`. So against a
2.x font:

- **checked (the default): a `FLAG_OVERFLOW` line THROWS** a `BitmapFontError`.
  It is no longer inert -- the peer refuses to render a layout it was told is
  incomplete.
- **`checked: false`: still inert** (ignored, no ellipsis) -- the 1.x behaviour.

This does NOT reopen the MINOR-vs-MAJOR decision for THIS package: nothing here
changed, `FLAG_OVERFLOW` is still `2`, and the value is still only ever reachable
on a call that under-sized its buffer (a caller bug). If anything the peer's new
throw AGREES with this package's fail-closed law: an overflow flag means "size
the buffer with `countLines`", and a checked 2.x peer now enforces exactly that
rather than silently rendering a truncated paragraph that looks deliberate --
the original TL-01 failure mode, closed on the consumer's side too.

What changed is a DOCUMENTED fact about the pairing, pinned executably in
`test/torture/t8-cross.mjs` section 4 (both the checked-throws and the
checked:false-inert directions) so a future peer bump cannot move it silently.
Found while decoding the 2.x store for TL-28; it is a sibling cross-package
finding, not part of the decode itself.
