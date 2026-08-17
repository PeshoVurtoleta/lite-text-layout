# 0002 -- The input door: NaN is not infinity, and null is not zero

Status: accepted
Session: TL2
Version: 1.2.0
Supersedes: nothing
Related: decisions/0001-flag-overflow.md

## Context

Every horizontal and vertical guard in `TextLayout.js` is written `x > 0`, and
every comparison against `NaN` is false. The consequences are uniform and
silent:

- `boxWidth = NaN` means "no horizontal limit".
- `boxWidth = -100` means "no horizontal limit".
- `scale = NaN` poisons `cursorX` on the first glyph, and a NaN cursor defeats
  every `cursorX + advance > boxWidth` test, so wrapping stops entirely.
- `scale = 0` and `scale = -1` are accepted; the second produces negative
  widths that a centring consumer reads as a number.
- A 700-entry `font.glyphs` reads `undefined` past its end, so every advance is
  `NaN` -- both "no wrapping at all" AND "every width is NaN".
- `lineHeight <= 0` with `boxHeight > 0` makes
  `(lineCount + 2) * lineHeight * scale > boxHeight` unfireable, so truncation
  is off while the caller believes they asked for it.
- `text = 12345` has no `.length`, so `len` is `undefined`, `len === 0` is
  false, the loop never runs, and the function returns `0`.
- `font = {}` throws `Cannot read properties of undefined (reading '324')` from
  inside the hot loop, naming an internal offset.

None of these throws a library error. All of them render. TL0 pinned
thirty-five of them as executable `knownFailing` entries.

They are one bug in fifteen costumes: the function trusts its arguments and
discovers the problem in the middle of a loop, where a poisoned local has
already defeated every downstream comparison.

## Decision

One shared internal validator, `validateInput`, declared before the
`TextLayout` object literal, not exported, not a property of the frozen
namespace, called as the FIRST statement of both `computeWrap` and
`countLines`. Fifteen separate guards would be the same door written fifteen
times in the wrong place, and `countLines` is a near-verbatim copy of
`computeWrap`'s pass -- two copies of a validator drift within one session.

```
validateInput(text, font, boxWidth, boxHeight, lineHeight, scale) -> void (throws)
```

`outBuffer` is deliberately NOT a parameter. `countLines` has no buffer, and a
validator that takes an argument one caller cannot supply grows an `undefined`
special case on day one. The `outBuffer` check lives in `computeWrap` alone, as
one statement immediately after the shared call.

### Check order

Fixed and written down, because tests assert which message comes back for a
tuple that is wrong in two places:

1. `text`
2. `font`
3. `font.glyphs`
4. `font.kerning`
5. `boxWidth`
6. `boxHeight`
7. `lineHeight`
8. `scale`

Then, in `computeWrap` only, `outBuffer`.

### Error shape

`export class TextLayoutError extends Error` with `this.name =
'TextLayoutError'`. Exported and documented in all four surfaces (source
docstring, `TextLayout.d.ts`, `llms.txt`, `README.md`).

The message names the argument, what it received, and what is required. The
whole point of TL-09 is that `Cannot read properties of undefined (reading
'324')` tells the caller nothing.

The message is built with a template literal AT THROW TIME. A pre-built shared
error instance is explicitly rejected: a shared error has a shared stack and
lies about where it came from. Error objects allocate, but the throwing path is
never measured and never hot, and no T6 lane may call it.

### instanceof Float32Array, not duck-typing

`outBuffer instanceof Float32Array`. Fail closed on every unverified state. A
cross-realm `Float32Array` (from a `vm` context, a worker `MessageChannel`
transfer wrapped in another realm's view, or an iframe in a bundled build)
fails `instanceof` and therefore throws. That is the correct answer for this
library: the alternative is `ArrayBuffer.isView(x) && x.constructor.name ===
'Float32Array'`, which accepts anything that renames itself. The caveat is
named in the docstring rather than papered over.

## The policy table

Three policy letters:

- **A -- throw.** A `TextLayoutError` naming the argument and the requirement.
- **B -- define.** A defined, pinned, documented return value where there was
  an accident.
- **C -- document.** The code is right; a documentation surface is wrong or
  silent. Closed with a pinned passing check so nobody "fixes" it later.

| Finding | Rows | Policy | Behaviour after TL2 |
|---|---|---|---|
| TL-03 | 2 | A throw | `scale` non-finite (`NaN`, `Infinity`, `-Infinity`) throws |
| TL-04 | 2 | A throw | `scale <= 0` throws |
| TL-05 | 4 | A throw | `boxWidth` non-finite or `< 0` throws; `0` still means no limit |
| TL-05v | 0 | A throw | `boxHeight` non-finite or `< 0` throws; `0` still means no limit. The VERTICAL axis of the same rule -- see below |
| TL-06 | 3 | A throw | `lineHeight` non-finite always throws; `lineHeight <= 0` throws only when `boxHeight > 0` |
| TL-07 | 2 | B define | `boxHeight > 0 && lineHeight * scale > boxHeight` returns `0` and writes nothing |
| TL-08 | 3 | A throw | `font.glyphs.length < 1792` or `font.kerning.length < 65536` throws, naming the table, the received length and the required length |
| TL-09 | 7 | A throw | `text` not a string; `font` null/undefined/missing either table |
| TL-10 | 3 | A throw | `outBuffer` not a `Float32Array` (Int32Array, Float64Array, plain Array, undefined) |
| TL-12 | 0 | C document | the ellipsis allowance is stated in all four surfaces, not just `d.ts` |
| TL-13 | 2 | B define | a CR immediately preceding an LF is excluded from the emitted range |
| TL-13 | 1 | C document | a lone CR keeps its atlas advance (0 in this font) and stays inside the range |
| TL-14 | 3 | C document | leading whitespace is preserved -- the code is right, the docstring is wrong |
| TL-15 | 1 | C document | indices are exact to 2^24; a text longer than 16,777,216 chars is out of domain |
| TL-23 | 0 | hygiene | `lastSpaceWidth` is reset alongside every `lastSpace = -1` |
| TL-24 | 1 | B define | a single glyph wider than `boxWidth` is emitted as an over-wide line, unflagged, documented |
| TL-26 | 1 | B define | the phantom zero-width line after a whitespace soft break is suppressed |

35 rows in the `knownFailing` ledger; 29 closed by a code change, 6 closed by
documentation plus a pinned check.

### TL-05: why `boxWidth = 0` survives and `boxWidth = -0` with it

`0` is the DOCUMENTED "no horizontal limit" value and thousands of callers pass
it. `-0 > 0` is false and `-0 < 0` is false, so `-0` aliases `0` through the
same door and through the same loop guard. That is deliberate and pinned.

### TL-05v: `boxHeight`, the row with no finding of its own

`boxHeight` gets the same treatment as `boxWidth` -- non-finite or negative
throws, `0` means no limit -- and it carries **0 rows in the executable
ledger**, because TL0 never pinned it as a `knownFailing`. `boxHeight = NaN`
and `boxHeight = -100` were recorded in 1.1.0 as PASSING checks reading "no
truncation", which is precisely the silent-alias shape TL-05 names on the
horizontal axis. They were invisible to the 35-row count because a `check()` is
not a `knownFailing`.

Applying the rule to one axis and not the other would leave
`computeWrap(text, font, 100, NaN, 16, out)` silently meaning "no vertical
limit" in a release whose entire subject is that `NaN` is not infinity. So the
rule is applied to both axes, `DOOR_ROWS` files the two `boxHeight` rows under
TL-05, and five 1.1.0 pins were converted from "no truncation" to throw pins:
`boxHeight` at `-1`, `-100`, `NaN`, `Infinity` and `-Infinity`. `-0` still
aliases `0` and `3.4e38` is still finite and accepted.

This row exists so that "shipped behaviour with no finding number" cannot hide
between the ledger and the policy table.

### TL-06: the conditional door, and why it is conditional

`lineHeight` is only ever read inside `boxHeight > 0` branches. Throwing on
`lineHeight <= 0` unconditionally would reject
`computeWrap('AAA', FONT, 0, 0, 0, out)` -- a caller who has no vertical box at
all and passed `0` for a value the function will never read. That is a legal
call and it lays out correctly today. So:

- `lineHeight` non-finite throws ALWAYS (a `NaN` line height is never
  meaningful and always indicates a computation upstream went wrong).
- `lineHeight <= 0` throws only when `boxHeight > 0`, which is exactly the
  regime in which the value is used.

The pinned row that proves the door is conditional and not blanket:
`computeWrap('AAA', FONT, 0, 0, 0, out)` returns `1` and does not throw, while
`computeWrap('AAA', FONT, 0, 32, 0, out)` throws naming `lineHeight`.

### TL-07: return 0, not throw

`boxHeight > 0 && lineHeight * scale > boxHeight` means the box cannot hold a
single line. Emitting one line is an accident of `(lineCount + 2)` requiring
room for a SECOND line before the truncation test fires. A caller who sized a
box too small for its own line height asked a coherent question -- "how much of
this fits?" -- and the answer is "nothing". `0` is that answer.

It is a `return`, not a throw, so it cannot live inside `validateInput` without
giving the validator a return value and a branch at both call sites. It is
duplicated in both entry points DELIBERATELY. The instrument that catches
drift between the two copies is the T0 agreement law with `BOX_HEIGHTS`
extended by `8` (a box under one line at `lineHeight = 16`).

### TL-08: the mitigating fact, stated in the error text

A real `@zakkster/lite-bmfont` `BitmapFont` always allocates the full table
(`../LiteBmfont/BitmapFont.js:19`, `new Int16Array(256 * 7)`). This door
therefore fires for hand-rolled font objects and half-built atlases, not for
the happy path. The error names the received length and the required length so
a caller building their own atlas is told the size to allocate.

### TL-14 is the non-obvious call and it is deliberate

The code preserves leading whitespace at the start of the text and after an
explicit `\n`. It skips it only after a soft break. The docstring says "runs of
leading whitespace on the next line are skipped", which reads broader than the
behaviour.

**The counter-argument, written out.** A caller who renders user-entered text
into a chat bubble, and whose user typed three spaces before their message,
gets an indent line they did not ask for. Worse, `'   '` alone -- a message of
nothing but spaces -- lays out as one line of width 18 rather than as nothing.
A caller who expected the docstring's broad reading will be surprised, and the
surprise is silent.

**The answer.** Skipping leading whitespace at the start of the text would
silently destroy indentation, and indentation is content in every case where it
was typed on purpose: code blocks, ASCII tables, poetry, aligned labels. A
library cannot tell an accidental indent from a deliberate one, and the
fail-closed rule says do not guess. `'   '` -> one line of width 18 is a
defensible indent line; `'   '` -> nothing is unrecoverable data loss inside
the library. A caller who wants trimming has `String.prototype.trim`, which is
one call and is theirs to make.

So the code stands and the DOCSTRING is narrowed, in all four surfaces, from
"runs of leading whitespace on the next line are skipped" to "runs of leading
whitespace on the next line are skipped AFTER A SOFT BREAK". The three
`knownFailing` rows become three named passing pins whose test names say
DELIBERATE, so nobody "fixes" them in TL3.

### TL-15 is DOCUMENT, not throw -- both sides

`startIdx` and `endIdx` are written into a `Float32Array`, so they are exact
only to 2^24 = 16,777,216. Above that the reported indices are wrong:
`Math.fround(16777217) === 16777216` and `Math.fround(16777219) === 16777220`.

**The case for a throw.** `text.length > 16777216` is one read at the door, on
the cold path, costing nothing. Fail closed on every unverified state: an index
the library cannot represent is an unverified state, and returning a wrong
index silently is exactly the class of bug this whole session exists to close.

**The case for documenting.** A 16 MB string lays out CORRECTLY for every index
below the ceiling. The failure is not "this call is wrong"; it is "indices past
character 16,777,216 of this call are wrong". A throw turns a legal input that
mostly works into a hard failure, and no caller in this library's domain -- a
bitmap-font wrapper for game HUDs and UI labels -- has a 16 MB label. The
ceiling is a property of the OUTPUT FORMAT (`Float32Array`, fixed by the
`drawWrapped` contract), not of the input, and format ceilings are documented,
not policed.

**Decision: document.** The ceiling is stated in all four surfaces with the
number `16777216` spelled out, and the two `Math.fround` round-trip facts are
pinned by name in `t0-laws.mjs` so the day the buffer type changes the pin
fails and the documentation follows.

### TL-23 is hygiene, not a bug

`lastSpaceWidth` is reset nowhere; only `lastSpace = -1` is, at three sites in
1.1.0's `computeWrap`. It is harmless today because `lastSpaceWidth` is read
ONLY when `lastSpace !== -1`, so no output can distinguish a stale value from a
correct one. The correctness of every soft-break width nonetheless rests on
those resets staying in sync with each other. `lastSpaceWidth = 0` is added
alongside every one.

**Count correction (post-QA).** 1.1.0 had three reset sites; the shipped 1.2.0
file has **four**, because the TL-26 suppression branch introduced one more.
The paired resets are at `TextLayout.js` 384/385, 420/421, 480/481 and 497/498.
The code is right -- every `lastSpace = -1` has its `lastSpaceWidth = 0` -- but
an earlier draft of this note said "three sites" and would have let a fifth site
be added one day without anyone noticing the invariant had grown. The invariant
is "every site, whatever the count", not "three".

The T5 fuzz is the only thing that proves they stay in sync. Note that the
obvious drift mutation -- delete one reset and expect a non-zero exit -- **does
not work, and that is finding TL-23 itself**: a deleted reset is unobservable,
because `lastSpaceWidth` is read only when `lastSpace !== -1` and the lines that
set `lastSpace` also set the width. The two mutations that ARE observable, and
do fire, are perturbing the `lastSpaceWidth` SET by 1 (T0 law2 width) and
deleting the paired `lastSpace = -1` (T0 law1 partition).

### The aliasing todo closes as DOCUMENT

`outBuffer` aliasing `font.glyphs` is possible only through a shared
`ArrayBuffer`. A `.buffer` identity check would reject this caller:

```js
const arena = new ArrayBuffer(1024 * 64);
const glyphs = new Int16Array(arena, 0, 256 * 7);
const layout = new Float32Array(arena, 4096, 256);
```

Those views are DISJOINT and the code is correct; packing a font atlas and a
layout buffer into one arena is a normal thing to do in a WASM or
shared-memory build. Rejecting it to catch a caller who genuinely overlapped
two views is a bad trade.

**Policy: documented as caller error with undefined result, no runtime check.**
The falsifiable half is pinned in `t2-capacity.mjs`: a `Float32Array` and an
`Int16Array` that are disjoint views of ONE `ArrayBuffer` do NOT throw.

## TL-26 -- the carved exception

The stated non-goal of TL2 is "no change to the wrapping algorithm itself --
the doors decide what enters the loop, not what the loop does". TL-26 is a
behaviour bug INSIDE the loop. The exception is granted, once, and this is the
reason:

> TL-26 is the last inhabitant of the `knownFailing` ledger, it lives in the
> newline branch that TL-13 must edit anyway, and the alternative is two
> sessions editing the same eight lines of the only hot loop in the package.
> One edit to one branch is cheaper and safer than two.

It does not inherit into TL3. TL3's non-goals gain "no wrapping-loop edits; TL2
spent that budget."

**The bug.** `computeWrap('AAA \nBBB', FONT, 40, 0, 16, out)` returns `3`: the
soft break emits `[0,3,36,0]`, the space-eater stops at the `\n` and sets
`lineStart = 4`, and the newline branch then emits `[4,4,0,0]` -- a zero-width
phantom line -- before `[5,8,36,0]`. Forty of the 50,000 fuzz cases hit it.

**The fix.** In the `id === 10` branch only, read `text.charCodeAt(i - 1)` ONCE
into a local, compute the CR-adjusted end index from it, and suppress the
emission when the resulting range is empty AND the character before `lineStart`
is a space:

```
end === lineStart && lineStart > 0 && text.charCodeAt(lineStart - 1) === 32
```

Suppression means: no write, no `lineCount++`, `lineStart = i + 1`, the same
state resets the branch already does, `continue`. It is tested BEFORE the
truncation sub-branch, or a phantom line could trigger a truncation return with
a zero-length range.

The `text.charCodeAt(lineStart - 1)` form (rather than the cheaper `prev === 32`
on the character before the newline) is required: `'AAA \r\nBBB'` reaches the
newline with the preceding character `13`, and the cheap form would leave the
phantom in place for CRLF text -- the exact intersection of the two findings
this branch is being edited for.

**A deliberate blank line must survive.** `'AAA\n\nBBB'` has
`text.charCodeAt(lineStart - 1) === 10`, not `32`, so it still emits `[4,4,0,0]`
and still returns `3`. That is the whole difference between a fix and a
regression, and both sides of the discriminator were executed before the fix
was written.

**The residual.** A hard break that lands on a CR could in principle satisfy
the predicate. The arbiter is the fuzz corpus, not argument: `divergences=0
unexpected=0` over 50,000 cases, plus hand-written rows in `t1-degenerate.mjs`.

## TL-13, the same branch, the same read

The CR-adjusted end index is `(prev === 13 && i > lineStart) ? i - 1 : i`, used
for the `endIdx` slot in both the truncated-fallback emit and the normal emit
of the `id === 10` branch. The width slot stays `cursorX`, unchanged: the CR's
atlas advance is 0 in a normal font, so the width already excluded it -- that
mismatch between a range that included the CR and a width that did not is the
bug TL-13 names.

`countLines` has no `endIdx`, so it needs only the TL-26 suppression. Both
functions are edited in the same pass or the T0 agreement law fires
immediately.

A LONE CR (not followed by LF) keeps its atlas advance and stays inside the
range. It is not a line terminator in this library and never was; treating it
as one would be a new wrapping rule, which is out of scope, and Mac-Classic
line endings are not a live format.

## Consequences

### Semver

MINOR. A new export (`TextLayoutError`) and new throws on input that was
previously accepted and silently wrong.

**The counter-argument.** A throw where there was none is breaking for a caller
who relied on the silent path.

**The answer.** The silent path produced `NaN` widths and no wrapping. There is
no caller relying on `scale = NaN` returning one line of `NaN` width; there is
only a caller who has not noticed yet. A minor bump with a loud CHANGELOG entry
and a named error class is the shortest path from "silently wrong" to "loudly
correct".

### Cost

The door is real per-call work: eight comparisons and two `.length` reads on
the cold path, once per call, before the loop. Every check runs ONCE, at
function entry. Not one new branch enters the per-character body.
`font.glyphs.length` and `font.kerning.length` are read at the door and never
per character; the loop keeps indexing the tables directly.

TL-26/TL-13 add one `charCodeAt` per LINE, not per character, inside the
`id === 10` branch.

The measured delta is recorded in `CHANGELOG.md` under 1.2.0.

## Ledger reconciliation -- all 27 findings, TL-01 through TL-27

Every ID is in exactly one bucket. No ID in two buckets, no gap in the range.

| ID | Bucket | Session | Note |
|---|---|---|---|
| TL-01 | closed by code | TL1 | `FLAG_OVERFLOW` on the last written line |
| TL-02 | closed by code | TL1 | `countLines` added |
| TL-03 | closed here by code | TL2 | policy A, `scale` finiteness |
| TL-04 | closed here by code | TL2 | policy A, `scale > 0` |
| TL-05 | closed here by code | TL2 | policy A, `boxWidth` finite and `>= 0` |
| TL-06 | closed here by code | TL2 | policy A, conditional on `boxHeight > 0` |
| TL-07 | closed here by code | TL2 | policy B, return `0` |
| TL-08 | closed here by code | TL2 | policy A, table lengths |
| TL-09 | closed here by code | TL2 | policy A, `text` and `font` |
| TL-10 | closed here by code | TL2 | policy A, `outBuffer instanceof Float32Array` |
| TL-11 | closed by code | TL1 | `Object.freeze(TextLayout)` |
| TL-12 | closed here by documentation plus a pin | TL2 | ellipsis allowance in all four surfaces |
| TL-13 | closed here by code plus documentation | TL2 | CRLF excluded (B), lone CR documented (C) |
| TL-14 | closed here by documentation plus a pin | TL2 | docstring narrowed to "after a soft break" |
| TL-15 | closed here by documentation plus a pin | TL2 | 2^24 ceiling in all four surfaces |
| TL-16 | closed by code | TL0 | `node:test`, tests moved to `test/` |
| TL-17 | closed by code | TL0 | ASCII-only sweep |
| TL-18 | closed by code | TL0 | `VERSION`, `CHANGELOG.md` |
| TL-19 | closed by code | TL0 | torture gate, no network in prepublish |
| TL-20 | closed by gate | TL0 | zero-allocation claim measured, T6 lane 1 |
| TL-21 | closed by gate | TL0 | 1.14 glyph reads per char, not quadratic |
| TL-22 | deferred | TL4 | README spine rebuild against the blueprint |
| TL-23 | closed here by code | TL2 | `lastSpaceWidth` reset at every `lastSpace = -1` site (four in 1.2.0) |
| TL-24 | closed here by documentation plus a pin | TL2 | policy B, over-wide glyph emitted unflagged |
| TL-25 | deferred | TL3 | cross-package double-scale in `drawWrapped` |
| TL-26 | closed here by code | TL2 | policy B, phantom line suppressed |
| TL-27 | closed by code | TL1 | watchdog plus the termination invariant comment; TL2 answers the residual guard question -- NO per-iteration guard, bytes in a hot body |

Counts: 27 IDs, each in exactly one bucket.

| Bucket | Count | IDs |
| --- | --- | --- |
| Closed in TL0 | 6 | TL-16..TL-21 |
| Closed in TL1 | 4 | TL-01, TL-02, TL-11, TL-27 |
| Closed here by code | 11 | TL-03..TL-10, TL-13, TL-23, TL-26 |
| Closed here by documentation plus a pin | 4 | TL-12, TL-14, TL-15, TL-24 |
| Deferred | 2 | TL-22 (TL4), TL-25 (TL3) |
| **Total** | **27** | no gaps, no ID in two buckets |

`6 + 4 + 11 + 4 + 2 = 27`.

**Column correction (post-QA).** An earlier draft said "Closed here by code: 12"
while listing 11 IDs, because it put TL-13's documentation half in the code
column. TL-13 is ONE ID: its code half (the CR exclusion) is what buckets it,
and its lone-CR documentation half does not earn it a second unit anywhere. The
bucket table above is per-ID and sums to 27 with no double counting.

**Two axes, do not conflate them.** A finding's POLICY LETTER (A throw / B
define / C document) describes what the door decides about it. How it was
PROMOTED (by a code change, or by documentation plus a pin) describes whether
1.2.0's observable behaviour differs from 1.1.0's. These are independent, and
TL-24 is the case that shows it: its policy letter is **B define** -- the
over-wide line is a deliberate, documented outcome -- yet it sits among the six
DOC-promoted entries, because that outcome was already 1.1.0's behaviour and
nothing changed. Verified empirically: TL-24's output is identical between the
two versions. A B-define finding is doc-promoted whenever the definition
ratifies what the code already did.

The 35-row executable ledger below counts LEDGER ROWS, not IDs, which is why its
arithmetic (29 code + 6 doc) differs from the 27 above. One ID can own several
rows -- TL-09 owns seven -- and TL-13's three rows split two code, one doc.

### Executable-ledger arithmetic

```
35 known-failing entries at pre-flight
-29 promoted by a code change (door throw, TL-07 return 0, CRLF, TL-26)
     TL-03 2  TL-04 2  TL-05 4  TL-06 3  TL-07 2  TL-08 3
     TL-09 7  TL-10 3  TL-13 2  TL-26 1
- 6 promoted by documentation plus a pinned check, behaviour unchanged
     TL-13 lone CR 1   TL-14 3   TL-15 1   TL-24 1
= 0 known-failing entries remain

 5 todos at pre-flight, 3 closed (TL-12 doc, aliasing policy, T6-lane3)
= 2 todos remain: TL-25 and control-6, both owned by TL3
```

## Rejected alternatives

**Fifteen inline guards, one per finding.** The same door written fifteen times
in the wrong place, and twice over because `countLines` copies `computeWrap`.

**A `validateInput` that returns a boolean and a sentinel return at each call
site.** Sentinel returns are forbidden by the package's own law; a caller who
does not check the sentinel is back where they started, silently.

**A pre-built shared `TextLayoutError`.** Zero allocation on the throwing path,
at the cost of a stack trace that points at module load. The throwing path is
never hot and never measured.

**`ArrayBuffer.isView(x) && x.constructor.name === 'Float32Array'`.** Accepts
any object that renames its constructor, and accepts a `Float32Array`-named
view over the wrong element type in a hostile realm. `instanceof` fails closed.

**Throwing on `text.length > 16777216`.** See TL-15 above.

**A `.buffer` identity check for aliasing.** See the arena counter-example
above.

**A defensive per-iteration progress guard in `countLines` (TL-27).** Bytes in
a hot body. The termination invariant is proved by construction and written
where the next editor will see it, and the torture entry point's watchdog turns
any future hang into a non-zero exit. The answer is no, and TL2 is the session
that answers it.
