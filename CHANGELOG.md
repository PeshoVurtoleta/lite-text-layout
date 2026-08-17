# Changelog

All notable changes to `@zakkster/lite-text-layout` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2026-08-18

Documentation made to match the frozen surface. TL1, TL2 and TL3 moved the public
surface (a new flag value and `countLines`, `TextLayoutError` and the input door,
the pinned range contract); the README was patched along the way but never
rebuilt. 1.2.2 rebuilds it on the ecosystem blueprint spine, replaces the
hand-maintained changelog copies with a single source of truth, and adds two
executable guards so the docs cannot silently drift from the code again. No
runtime behaviour change: the only edit to `TextLayout.js` is the `VERSION`
constant bump; the zero-allocation hot path is byte-identical to 1.2.1 (T6 lanes:
major 0, minor 0, source gc, arrayBuffers 0).

### Added

- Docs-drift guard (`test/TextLayout.docsdrift.test.js`): reads the runtime export
  surface from the module (`Object.keys` over the module and the `TextLayout`
  namespace, never a hardcoded list) and asserts, in both directions, that every
  export is documented in the README API-reference region (delimited by
  `<!--API-START-->` / `<!--API-END-->`) and in `llms.txt`, and that every name
  documented in those regions resolves at runtime. Scoping to the delimited region
  means a name appearing only in prose cannot satisfy the check.
- Runnable-snippet test (`test/TextLayout.snippets.test.js`): mechanically extracts
  the README blocks marked `<!--RUN-->` and executes them, running this package's
  `computeWrap` / `countLines` over a real `@zakkster/lite-bmfont` `BitmapFont` and
  asserting line count, flags and widths; the `drawWrapped` line runs through a
  recording `ctx` stub with an exact blit-count assertion, so the shown example
  cannot rot without failing.
- `npm test` rises from 68 to 74.

### Changed

- `README.md` rebuilt on the `LiteSepforge/README.md` blueprint spine (18 sections
  in order: tagline, badges, positioning H2, table of contents, why-this-exists,
  what-you-get, a `<details>` core-surface deep dive, API reference, the output
  buffer / range contract, composability, a `<details>` zero-GC design notes,
  benchmarks, design decisions, testing, what-this-is-not, ecosystem, license). The
  `RANGE-CONTRACT` sentinel block is preserved byte-identical (TL3's drift guard
  holds).
- Benchmark numbers (TL-20 zero-allocation, TL-21 rescan cost) re-measured this
  release and stamped with version and machine (`1.2.2, node v26.3.1 arm64`).

### Fixed

- Total-downloads badge pointed at the nonexistent `@zakkster/lite-ext-layout`;
  corrected to `@zakkster/lite-text-layout`.

### Removed

- Version-by-version changelog duplication from `README.md` and `llms.txt`. Both
  had gone stale in different ways (`README.md` missing 1.0.2 and 1.2.1;
  `llms.txt` missing 1.2.1); both now point to `CHANGELOG.md` as the single source
  of truth. `llms.txt` retains the full API surface.

## [1.2.1] - 2026-08-17

The range contract, made executable. 1.2.0 stated the output-buffer semantics in
prose, separately, across four files; 1.2.1 pins them in one canonical block that
a test holds byte-identical, and turns the cross-package width contract with
`@zakkster/lite-bmfont` into a gated conformance tier instead of a sentence. No
runtime behaviour changes: the `TextLayout.js` diff is comment-only and the
zero-allocation hot path is byte-identical to 1.2.0 (T6 lanes: major 0, minor 0,
source gc, arrayBuffers 0).

### Added

- Range-contract drift guard (`test/TextLayout.drift.test.js`): the four
  documentation surfaces -- source docstring, `TextLayout.d.ts`, `llms.txt`,
  `README.md` -- carry one canonical range-contract block behind
  `RANGE-CONTRACT` / `END RANGE-CONTRACT` sentinels; the test extracts all four,
  asserts they are byte-identical after prefix/whitespace normalization, and pins
  them to a fixed canonical text, so the contract cannot rot into four
  slightly-different sentences.
- Cross-package conformance tier (torture T8) against `@zakkster/lite-bmfont`, a
  test-only devDependency (zero runtime dependencies, both directions, unchanged):
  width agreement `lineWidth === font.measure(text.slice(startIdx, endIdx),
  scale)` over 19685 wrapped lines at scale 0.5/1/2; the truncated-line exception
  `lineWidth - measure(content) === 3 * xadvance('.') * scale`; stride-4 and
  `flags === 1` format checks.
- CRLF differential coverage: `makeCorpus` emits `\r\n` on ~40% of between-word
  newlines and the brute-force oracle models the CR as the zero-advance glyph it
  is, so the 50,000-case fuzz differential and a truncating-arm `crlfInRange`
  invariant sweep now exercise the CRLF path 1.2.0's gate was blind to
  (divergences 0, crInRange 0). T9 control 13 reproduces the truncating-arm CR
  exclusion two-directionally.
- 12 boundary tests (`test/TextLayout.boundary.test.js`); `npm test` rises from
  54 to 68.
- Torture `RULES` pins `maxMinor: 0`; `runOpsGate` dies on a gc-profiler source
  other than `gc`.
- Decision records `0003-scale-contract.md` (rendered-scale width; TL-25 closes
  in the peer) and `0004-nonascii-kerning-seam.md` (ASCII-scoped width agreement).

### Changed

- Documentation only. The canonical range sentences replace four independently
  paraphrased copies. `VERSION` is `1.2.1`.

### Known

- TL-25: `BitmapFont.drawWrapped` applies `* scale` to a `lineWidth` this package
  has already scaled, displacing centred and right-aligned lines by a factor of
  `scale` (measured: lineWidth 51/102/204 at scale 0.5/1/2; drawWrapped uses
  25.5/102/408, agreeing only at scale 1). Recorded as a named `knownFailing`
  entry in T8 and filed against the peer; the fix is one term in
  `@zakkster/lite-bmfont`, not here.
- TL-28: this package resets the kerning context on a non-ASCII glyph (id >= 256)
  while bmfont's `measure` bridges it, so width agreement is scoped to ASCII
  (measured divergence: 24 vs 19). Defined behaviour, recorded in
  `decisions/0004-nonascii-kerning-seam.md`.

## [1.2.0] - 2026-08-17

`NaN` is not infinity, and `null` is not zero. Every guard in this file was
written `x > 0`, and every comparison against `NaN` is false -- so `boxWidth =
NaN` meant "no horizontal limit", `scale = NaN` meant "no wrapping at all", a
700-entry glyph table meant "no wrapping AND every width is NaN", and
`lineHeight <= 0` with `boxHeight > 0` meant "truncation is off" while the
caller believed they had asked for it. None of them threw. All of them
rendered. 1.1.0 shipped with thirty-five of these pinned as executable
`knownFailing` entries in the torture gate; 1.2.0 closes that ledger to zero.

They were one bug in fifteen costumes: the function trusted its arguments and
discovered the problem in the middle of a loop, where a poisoned local had
already defeated every downstream comparison. The fix is ONE door at the top,
shared by both entry points, because `countLines` is a near-verbatim copy of
`computeWrap`'s pass and two copies of a validator drift within one session.

### Added

- `export class TextLayoutError extends Error`, `name === 'TextLayoutError'`.
  The message names the argument, what it received and what is required. The
  point is that `Cannot read properties of undefined (reading '324')` raised
  from inside the wrapping loop tells the caller nothing. Messages are built
  with a template literal AT THROW TIME; a pre-built shared instance was
  rejected because a shared error carries a shared stack and lies about where
  the call came from. The throwing path allocates, is never hot, and no
  measured window calls it.
- **The input door.** One internal `validateInput(text, font, boxWidth,
  boxHeight, lineHeight, scale)`, not exported and not a property of the frozen
  namespace, called as the FIRST statement of both `computeWrap` and
  `countLines`. `outBuffer` is deliberately not a parameter -- `countLines` has
  no buffer, and a validator taking an argument one caller cannot supply grows
  an `undefined` special case on day one -- so `computeWrap` checks its buffer
  itself in one statement immediately after. Check order is fixed and part of
  the contract: `text`, `font`, `font.glyphs`, `font.kerning`, `boxWidth`,
  `boxHeight`, `lineHeight`, `scale`, then `outBuffer`.

### Changed

Fifteen findings, each with its policy letter. **A** = throw, **B** = define a
result where there was an accident, **C** = document (the code was right).

- **TL-03 (A).** `scale` non-finite throws. Was: one line of `NaN` width, no
  wrapping.
- **TL-04 (A).** `scale <= 0` throws. Was: `0` gave all-zero widths, `-1` gave
  negative widths, both silently.
- **TL-05 (A).** `boxWidth` non-finite or negative throws. `0` still means no
  horizontal limit, and `-0` still aliases `0`.
- **TL-06 (A).** `lineHeight` non-finite throws ALWAYS; `lineHeight <= 0`
  throws only when `boxHeight > 0`, the one regime in which the value is read.
  `computeWrap('AAA', font, 0, 0, 0, out)` is still legal and still returns 1.
- **TL-07 (B).** `boxHeight > 0` with `lineHeight * scale > boxHeight` returns
  `0` and writes nothing. Was: one line, an accident of `(lineCount + 2)`
  requiring room for a SECOND line before truncation could fire. The boundary
  is `>`, not `>=`.
- **TL-08 (A).** `font.glyphs.length < 1792` or `font.kerning.length < 65536`
  throws, naming the table, the received length and the required length. A real
  `@zakkster/lite-bmfont` `BitmapFont` always allocates the full table, so this
  door fires for hand-rolled fonts and half-built atlases, not the happy path.
- **TL-09 (A).** `text` not a string, and `font` null/undefined/missing either
  table, throw. Was: `text = 12345` returned `0` silently (a number has no
  `.length`, so the loop never ran), and `font = {}` raised a raw `TypeError`
  naming an internal offset.
- **TL-10 (A).** `outBuffer` must be a `Float32Array`. Was: a plain `Array` and
  a `Float64Array` were accepted, and an `Int32Array` silently truncated every
  `lineWidth` to its integer part. The check is `instanceof`, so a CROSS-REALM
  `Float32Array` is rejected -- deliberately, since the alternative accepts
  anything that renames its constructor. Named as a caveat in all four surfaces.
- **TL-12 (C).** A truncated line's `lineWidth` includes the ellipsis
  allowance. Behaviour unchanged; it was stated only in the `.d.ts` and is now
  in the source docstring, `llms.txt` and `README.md` too.
- **TL-14 (C).** Leading whitespace is preserved at the start of the text and
  after an explicit `\n`; it is skipped only AFTER A SOFT BREAK. The code was
  right and the docstring was too broad. Narrowed in all four surfaces.
  Skipping it would silently destroy indentation, and a library cannot tell an
  accidental indent from a deliberate one.
- **TL-15 (C).** `startIdx`/`endIdx` are Float32 and exact only to
  2^24 = 16777216. Documented, not thrown: the ceiling is a property of the
  OUTPUT FORMAT, not the input, and a 16 MB string lays out correctly for every
  index below it. Pinned by `Math.fround(16777217) === 16777216` and
  `Math.fround(16777219) === 16777220`.
- **TL-23 (hygiene).** `lastSpaceWidth` is now reset alongside every
  `lastSpace = -1` -- three sites in `computeWrap`. Not a live bug: the stale
  value is read only when `lastSpace !== -1`, so no output can observe it. The
  three sites simply have to stay in sync.
- **TL-24 (B).** A single glyph wider than `boxWidth` is emitted as an
  over-wide line, unflagged, and that is now documented. "At least one glyph
  per line" is what makes the loop terminate.
- **Aliasing (C).** An `outBuffer` overlapping `font.glyphs` through a shared
  `ArrayBuffer` is caller error with an undefined result, with NO runtime
  check. A `.buffer` identity check would reject a caller packing DISJOINT
  views into one arena, which is correct code -- pinned as a passing test.

### Fixed

- **TL-26 -- the phantom line.** `computeWrap('AAA \nBBB', font, 40, 0, 16,
  out)` returned `3`: the soft break emitted `[0,3,36,0]`, the space-eater
  stopped at the `\n` and set `lineStart = 4`, and the newline branch then
  emitted `[4,4,0,0]` -- a zero-width line with no content. Now `2`. The
  discriminator is the character BEFORE `lineStart`: `32` means the space-eater
  put us there (suppress), `10` means the author wrote a blank line (keep). A
  DELIBERATE blank line survives: `'AAA\n\nBBB'` still returns `3` with its
  `[4,4,0,0]`. Forty of the 50,000 differential-fuzz cases hit this; the count
  is now `0` with the oracle unchanged.
- **TL-26 corollary, found by the fuzz during this session.** The buffer-cap
  `break` can fire on the very iteration that would have suppressed a phantom,
  leaving `lineStart` parked on a newline that consumes itself. Left alone, a
  capped run reported `FLAG_OVERFLOW` where the unbounded run had nothing more
  to write, breaking the 1.1.0 iff (`FLAG_OVERFLOW` <=> `countLines(...) >
  capacity`). The newline is now consumed on the cold flush path, once per
  call. At most one terminator can qualify.
- **TL-13 -- CRLF.** A `\r` immediately preceding a `\n` is a line terminator
  and is excluded from the emitted range. `computeWrap('AAA\r\nBBB', font, 0,
  0, 16, out)` now gives `[0,3,36,0, 5,8,36,0]`; it gave `[0,4,36,0, ...]`,
  putting the CR INSIDE a range whose `lineWidth` excluded it, so a renderer
  walking `[start, end)` drew a character the width did not account for. A LONE
  `\r` is NOT a terminator: it keeps its atlas advance and stays in range.
  The exclusion applies to **all three emitting arms** of the newline branch --
  the normal emit and BOTH sub-arms of the truncation return. The truncating arm
  cuts at `lastSafeEllipsisIdx + 1`, which equals the newline index when the CR
  is the last position where content-plus-ellipsis fits, so it is clamped to the
  CR-adjusted end. And because the CR leaves the RANGE, its advance leaves the
  WIDTH: `lineWidth` has the CR's glyph advance and its kerning pair subtracted,
  or the documented "range and `lineWidth` agree" would be false in any atlas
  where glyph 13 is not zero-advance.
- **Scope of the CRLF identity, stated rather than implied.** CRLF lays out
  identically to LF -- same line count, same widths, start indices shifted by
  one -- whenever the CR's own advance does not force a wrap. That is always
  true for a real bitmap atlas, where a CR is not a printable glyph and its
  advance is `0`. In a hand-rolled atlas that gives glyph 13 a non-zero advance
  AND a `boxWidth` narrow enough for it to matter, the CR hard-breaks onto its
  own line in the wrap test, before the newline branch is ever reached, and no
  line-count identity is possible without teaching the per-character body about
  CRs -- which the hot-path law forbids. 1.2.0 is still strictly better than
  1.1.0 out there: the CR is no longer inside an emitted range. Pinned by name
  in `t1-degenerate.mjs`, both sides of the boundary.

Both fixes live in the same `id === 10` branch and share ONE `charCodeAt` read.
Editing that branch was a deliberate, once-only exception to "no changes to the
wrapping algorithm", recorded with its reasoning in
`decisions/0002-input-door.md`: the alternative was two sessions editing the
same eight lines of the only hot loop in the package.

### Measured

Node v26.3.1, darwin arm64, `@zakkster/lite-gc-profiler`, all numbers from this
release's gate run.

- **Allocation: 0 bytes/op on all three T6 lanes.** Lane 1 (`computeWrap` over
  the 360-char paragraph), lane 2 (`countLines`), lane 3 (NEW -- doors on valid
  input: an explicit `scale = 2`, a truncating `boxHeight = 64`, the seventh
  argument supplied, so the door's full comparison chain runs).
  `measureOps(fn, { ops: 20000, warmup: 1000, stabilize: 'deep' })` ->
  `verdict: pass`, `source: gc`, major `0`, minor `0`, `maxMs` `0.000`,
  `arrayBuffers` growth `0`. `measureAllocs(fn, { iterations: 2000 })` ->
  `bytesPerCall: 0`, `settled: true`. No lane calls a throwing path: error
  construction allocates by design, and measuring it would gate a cost the
  contract deliberately accepts.
- **The door's per-call cost.** On a 7-character string
  (`computeWrap('AAA BBB', font, 100, 0, 16, out, 1)`, 2,000,000 iterations,
  median of 3 runs, interleaved against the 1.1.0 file in one process):
  **24.2 ns -> 29.0 ns, a delta of roughly +4 ns per call.** Two independent
  runs of this shape measured +4.8 ns and +3.84 ns; run-to-run spread is around
  15%, so one significant figure is all the method supports and the honest
  claim is "a few nanoseconds", not a two-decimal figure. That is the eight
  comparisons, two `.length` reads and one `instanceof`, and it is a FIXED cost
  paid once per call regardless of text length. The CRLF work adds nothing to
  it: the CR advance and its kerning pair are read only when a CR actually
  precedes the newline, inside a branch that already runs once per LINE.
- **T6 lane 1 wall time, against the 1.1.0 baseline.** Five interleaved
  20,000-op windows each: 1.1.0 median **36.45 ms**, 1.2.0 median
  **36.34 ms** -- a delta of **-0.3%**, i.e. no regression. Run-to-run spread on
  this window is roughly +/-10%, so the honest reading is "within noise": the
  door's few ns is amortised to nothing across a 360-character paragraph, and
  the TL-20 text contains no `\r`, so the CRLF branch never fires there. The
  pre-agreed +5% ceiling was not approached, so the CRLF half did NOT revert to
  policy C.
- **Retention.** T7 runs 4096 cycles, each now including one caught
  `TextLayoutError`: `trackerSize=0`, `heapGrowthKB=36` against a 512 KB bound.
  4096 retained errors with their stacks could not fit under that bound, which
  is why the throwing path is asked the question there and nowhere else.
- **Differential fuzz.** `T5 cases=50000 divergences=0 (tl26=0 unexpected=0)`,
  from `divergences=40 (tl26=40)` in 1.1.0. The oracle was not touched.
- **The flags tripwire (new).** `flagslots=157820 badvalue=0 bothflags=0`. It
  walks the flags slots of every capped run and counts two independent
  violation classes: a value outside `{0, 1, 2}`, and one output carrying both
  a `FLAG_TRUNCATED` and a `FLAG_OVERFLOW` line. It was added BEFORE any
  behaviour change, and read `flagslots=161249 badvalue=0 bothflags=0` against
  the unmodified 1.1.0 file. **The 3429-slot drop is fully accounted for and no
  fuzz case was rejected by the door (0 throws in 50,000 cases):** 3427 cases
  draw the single combination `boxHeight = 16, scale = 2`, where
  `lineHeight * scale = 32 > 16` and TL-07 now returns `0` lines; 3417 of them
  previously contributed exactly one flags slot each (1.1.0's truncation fired
  on the first break, returning 1) and 10 had empty text and contributed none,
  giving `161249 - 3417 = 157832` after the door. The remaining 12 slots are
  phantom lines removed by TL-26 from inside capped prefixes:
  `157832 - 12 = 157820`. The corpus did not shrink; one truncation regime
  legitimately stopped producing lines.
- **The gate.** `known-failing=0 todo=2` (from `35` and `5`). The two survivors
  are `TL-25` and `control-6`, both owned by the next session. `npm test`: 54
  pass, 11 suites, 0 fail. Full torture run: ~2 s.

### Semver

MINOR. A new export, and new throws on input that was previously accepted and
silently wrong.

**The counter-argument, stated plainly:** a throw where there was none is
breaking for a caller relying on the silent path.

**The answer:** the silent path produced `NaN` widths and no wrapping. There is
no caller relying on `scale = NaN` returning one line of `NaN` width; there is
only a caller who has not noticed yet. A minor bump with a loud entry and a
named error class is the shortest path from "silently wrong" to "loudly
correct". Full reasoning, including every rejected alternative, in
`decisions/0002-input-door.md`.

### Known issues

Shrinks by fourteen findings. What remains: **TL-22** (the README does not
follow the suite blueprint spine) and **TL-25** (cross-package double-scale --
`BitmapFont.drawWrapped` computes alignment as `boxWidth - lineWidth * scale`
while `lineWidth` is already at the rendered scale).

## [1.1.0] - 2026-08-17

An undersized buffer must say so. TL1 makes overflow observable, gives callers a
way to size the buffer, and freezes the namespace. `computeWrap`'s loop body is
byte-for-byte identical to 1.0.2; only the post-loop tail, a new export, the new
`countLines` method, comments, and the `Object.freeze` line differ.

### Added

- `export const FLAG_OVERFLOW = 2`. Set on the flags slot of the LAST written
  line if and only if the same call against an unbounded buffer would have
  produced more lines (equivalently, iff
  `countLines(...) > floor(outBuffer.length / 4)`). Distinct from
  `FLAG_TRUNCATED`: `FLAG_TRUNCATED` means "the TEXT did not fit the BOX" (a
  designed outcome), `FLAG_OVERFLOW` means "the BUFFER did not fit the TEXT" (a
  caller bug being reported).
- `TextLayout.countLines(text, font, boxWidth, boxHeight, lineHeight, scale?)`.
  Counts the lines `computeWrap` would write into an unbounded buffer -- same
  parameters, same order, minus `outBuffer`. `new Float32Array(countLines(...) *
  4)` is the buffer size that can never overflow. A separate function, not an
  `outBuffer === null` branch, so `computeWrap`'s hot call site stays monomorphic.
- `Object.freeze(TextLayout)`. The namespace is now frozen; assignment and delete
  throw `TypeError` in strict mode.

### Changed

- The overflow contract replaces the old "extra content is silently dropped."
  The partial layout is preserved and is a true PREFIX: for capacity `m` lines
  the output equals the first `m` lines of the unbounded run, byte-identical
  except slot `4m - 1`, which carries `FLAG_OVERFLOW`.
- **Zero-capacity rule:** a buffer with no whole 4-slot stride (length 0..3)
  returns `0` and writes nothing -- there is no flags slot to signal into. A
  caller detects a swallowed non-empty layout as `n === 0 && text.length > 0`.
  It does not throw (that is TL2's door) and does not return a sentinel.
- **Mutual-exclusivity rule:** `FLAG_OVERFLOW` and `FLAG_TRUNCATED` never both
  appear in one call's output. A truncating run fits within its cap (the two
  in-loop truncation returns write four slots and return before the cap is hit),
  so it can never also overflow. Precedence, written down though it never fires:
  `FLAG_OVERFLOW` wins, because truncation is designed and overflow is a bug.
- Law 6, adopted suite-wide: **flags are a value space; compare by equality,
  never by truthiness.** `if (flags === FLAG_TRUNCATED)`, never `if (flags)`. The
  documented flag domain may widen in a MINOR release; only equality against a
  named constant is stable across that widening.

### Fixed

- **TL-01 (S1)** -- Buffer overflow was silent and byte-for-byte
  indistinguishable from a correct short layout. Now the last written line of an
  undersized run carries `FLAG_OVERFLOW`, so a 10-word text into
  `Float32Array(12)` differs from `'AAA BBB CCC'` into it in exactly slot 11.
  Struck from Known issues.
- **TL-02 (S3)** -- No `countLines`, so a caller could not size the buffer up
  front. `countLines` now exists and agrees with `computeWrap` on all 512 T0
  cases across five box heights, all 50,000 T5 cases, and all 40 `node:test`
  cases. Struck from Known issues.
- **TL-11 (S3)** -- `TextLayout` was not frozen. It is now; assignment and delete
  throw. Struck from Known issues.

### Measured

Recorded so no future session invents work the evidence refutes. Both produced on
Node v26.3.1 for 1.1.0.

- **`Object.freeze` cost.** 50,000 `computeWrap` calls: 87.5 ms unfrozen vs
  87.9 ms frozen -- a 0.4% delta, noise. T6 lane 1 reports `verdict: pass` under
  the freeze, byte-identical to the 1.0.2 TL-20 baseline. The freeze is a
  one-time module-load cost, not a per-call cost.
- **`countLines` zero allocation (T6 lane 2).** `measureAllocs(hot2, {
  iterations: 2000 })` -> `bytesPerCall === 0`, `settled === true`;
  `measureOps({ ops: 20000, warmup: 1000, stabilize: 'deep' })` +
  `checkNoGc({ maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 })` ->
  `verdict: pass`, major 0, minor 0. A `SINK` accumulator defeats dead-code
  elimination so a dropped call cannot pass as a zero-alloc call.

### Note on the torture watchdog and TL-27

TL1's own assertion-15 drift mutation (deleting the `lastSpace` reset from
`countLines`' soft-break) found TL-27 (S3): because `countLines` correctly omits
`computeWrap`'s `maxLines` top-of-loop break (which doubles as a progress
backstop), a broken soft-break invariant makes `countLines` loop forever instead
of returning a wrong count -- e.g. `countLines('AAA   AAAAAA   AAA', F, 46, 0,
16)` never returns. `countLines` is correct and unchanged (a defensive
per-iteration guard would be bytes in a hot body); the termination invariant is
now documented in a comment there, and `test/torture.mjs` gained a 120s
wall-clock watchdog that forks the tiers into a child and kills it from the
parent, so a non-terminating tier fails the gate instead of wedging CI silently.
TL-27 is registered in the roadmap for TL2. This is test/tooling only; no shipped
file changed for it.

### Semver note

MINOR. The output flag domain widened from `{0, 1}` to `{0, 1, 2}`; value `2` is
reachable only on a call that was already dropping content silently, and the one
in-tree consumer (`BitmapFont.drawWrapped`, `if (flags === 1)` at
`BitmapFont.js:361`) reads the field by equality, so a `2` correctly falls
through to no ellipsis. The full verdict, its counter-argument, the zero-capacity
contract, and the precedence proof are recorded in
`decisions/0001-flag-overflow.md`.

## [1.0.2] - 2026-08-17

No behaviour change. `computeWrap` is byte-for-byte identical to 1.0.1; this
release stands up the tooling that lets a future session change it safely.

### Changed

- Ported the 31-case test suite to `node:test` + `node:assert/strict` (off the
  previous third-party runner), per the suite law (`node:test` only). All 9
  describe groups and all 31 cases survive with their names.
- Moved the test file from the package root to `test/TextLayout.test.js` and
  fixed its import to `../TextLayout.js`.
- Rewrote `package.json` `scripts`: `test` runs `node --test
  test/TextLayout.test.js` (naming the file explicitly so a bare `node --test`
  does not also execute the torture entry point), plus `torture`, `verify`, and
  `prepublishOnly` = `verify`.
- Deleted the `bundle-check` script and its network bundler invocation: a
  publish gate must not fetch from the network.
- Swapped the previous third-party test-runner devDependency for
  `@zakkster/lite-gc-profiler ^1.15.0` and `@zakkster/lite-leak ^1.8.1`.
- Added `engines: { node: ">=18" }`.
- ASCII-only sweep of every shipped file (em dashes, arrows, `>=`, `x`, ellipsis,
  box-drawing rules, and README emoji headings). Source law allows U+00D7 and
  U+00B5; this release normalises U+00D7 to `x` anyway so the ASCII gate is a
  plain `grep` with no exception clause.

### Added

- `export const VERSION = '1.0.2'` in `TextLayout.js`, mirrored in
  `TextLayout.d.ts` and `llms.txt`. Version now lives in three places at once.
- `test/torture.mjs` plus `test/torture/` (harness, oracle, and tiers
  T0/T1/T2/T5/T6/T7/T8/T9): the `node --expose-gc test/torture.mjs` gate that
  every later session's DONE-WHEN reduces to. It prints exactly `ok` and can
  fail -- T9 carries deliberately-broken controls, and
  `TEXTLAYOUT_TORTURE_BREAK=1` must exit non-zero.
- `CHANGELOG.md` (this file), added to `package.json` `files[]`.

### Note on the fuzz corpus

The first T5 corpus joined words with exactly one space, so the documented
soft-break "space-eater" (skip the run of leading spaces on the line after a
wrap) was never exercised in 50,000 cases. Mutation testing -- deleting that
one line from `computeWrap` -- proved the gap: the mutant survived a full green
run. The generator now emits runs of 1..4 spaces plus leading, trailing, and
all-whitespace cases, and T0 gained a law forbidding a mid-paragraph
whitespace-only line. The lesson for the next session: a differential fuzz is
only as strong as the domain its generator covers -- mutation-test the generator,
not just the subject. That work also surfaced TL-26 (below).

## Known issues

Recorded from ROADMAP section 2, reproduced against the working tree with the
font stub (`glyphs` `Int16Array(256*7)`, `kerning` `Int16Array(65536)`,
uppercase/lowercase `xadvance` 12, space 6, `'.'` 6). None are fixed here; each
is scheduled for a later session. Severity: S1 data loss/corruption, S2 broken
guarantee, S3 hygiene/contract gap, S0 verified-good baseline.

- **TL-03 (S1)** -- `scale = NaN` poisons every width and silently disables
  wrapping. -- `computeWrap('AAA BBB', F, 40, 0, 16, out, NaN)` -> 1 line,
  `lineWidth === NaN`.
- **TL-04 (S2)** -- `scale = -1` and `scale = 0` are accepted silently. --
  `scale = -1` -> one line, `lineWidth === -120`; `scale = 0` -> one line, widths 0.
- **TL-05 (S2)** -- Negative and NaN `boxWidth` silently mean "infinite". --
  `boxWidth = -100` and `boxWidth = NaN` both give one unwrapped line.
- **TL-06 (S2)** -- `lineHeight <= 0` with `boxHeight > 0` disables truncation
  entirely. -- 5-line text into a 20px box, `lineHeight = 0` -> 5 lines, no flag.
- **TL-07 (S3)** -- A `boxHeight` smaller than one line still emits a line. --
  `boxHeight = 8`, `lineHeight = 16` on single-line text -> 1 line, `FLAG_NORMAL`.
- **TL-08 (S1)** -- A short `font.glyphs` table NaN-poisons the layout silently
  (a real `BitmapFont` always allocates `Int16Array(256*7)`, so this bites
  hand-rolled fonts). -- `glyphs = Int16Array(100*7)` with `'AAA zzz'` -> 1 line,
  `lineWidth === NaN`.
- **TL-09 (S2)** -- No door on `font` or `text`. -- `font = {}`/`null` throw raw
  `TypeError`s from the hot loop; a non-string `text = 12345` returns `0` silently.
- **TL-10 (S2)** -- `outBuffer` type is unchecked. -- `Array(16)` and
  `Float64Array` are accepted; `Int32Array` is accepted and truncates every
  `lineWidth` to an integer.
- **TL-12 (S3)** -- A truncated line's `lineWidth` includes the ellipsis
  allowance, stated only in the `.d.ts`. -- `54 = content 36 + ellipsis 18`.
- **TL-13 (S2)** -- `\r` is inside the emitted line range but not in `lineWidth`.
  -- `computeWrap('AAA\r\nBBB', F, 0, 0, 16, out)` -> `[[0,4,36,0],[5,8,36,0]]`.
- **TL-14 (S2)** -- Leading whitespace is skipped only after a soft break, never
  at text start and never after a `\n`. -- `'   '` -> one line `[0,3]` width 18.
- **TL-15 (S3)** -- `startIdx`/`endIdx` are Float32, exact only to 2^24. --
  `Math.fround(16777217) === 16777216`; `Math.fround(16777219) === 16777220`.
- **TL-16 (S3)** -- Test runner violated the suite law (a third-party runner in
  `package.json`, test file in the package root). -- *Resolved in 1.0.2.* --
  `node --test TextLayout.test.js` used to fail on the third-party import.
- **TL-17 (S3)** -- ASCII-only law violated in shipped files. -- *Resolved in
  1.0.2.* -- `LC_ALL=C grep -c '[^ -~\t]'` now returns 0 for every file.
- **TL-18 (S3)** -- Version drift; no `VERSION` export, no `CHANGELOG.md`. --
  *Resolved in 1.0.2.*
- **TL-19 (S3)** -- No torture gate, and the publish gate fetched from the
  network. -- *Resolved in 1.0.2.*
- **TL-20 (S0)** -- The zero-allocation claim is true today, measured. -- See
  Measured baselines below.
- **TL-21 (S0)** -- The soft-break rescan is not quadratic. -- See Measured
  baselines below.
- **TL-22 (S3)** -- The README does not follow the suite blueprint (positioning
  H2, TOC, Composability, Zero-GC design notes, etc. all missing). -- Scheduled
  for TL4.
- **TL-23 (S3)** -- *(read, not run)* `lastSpaceWidth` is not reset at any line
  break; harmless today because it is read only when `lastSpace !== -1`. --
  `TextLayout.js:74`, resets at 116/174/190.
- **TL-24 (S3)** -- A single glyph wider than `boxWidth`
  produces a line wider than the box; the hard-break path does not re-check
  `boxWidth`. -- `TextLayout.js:196`, guard at 144.
- **TL-25 (S2)** -- Cross-package scale is applied twice: `computeWrap` widths
  are already at scale, and `BitmapFont.drawWrapped` multiplies by `scale` again.
  -- `lineWidth` 51/102/204 for scale 0.5/1/2; `drawWrapped` then mis-aligns by a
  factor of `scale` at every scale but 1.
- **TL-26 (S2)** -- **Found by this session's own torture suite, not by a hand
  probe.** When whitespace soft-breaks immediately before a `\n` (or end of
  text), `computeWrap` emits a spurious zero-width line, violating its own "no
  phantom trailing line" guarantee once the pre-newline content wraps. Surfaced
  as 40/50,000 T5 divergences the moment the corpus gained multi-space runs; the
  oracle was left correct and the finding recorded rather than absorbed. --
  `computeWrap('AAA  \n', F, 40, 0, 16, out)` -> 2 lines `[[0,3,36],[5,5,0]]`,
  where `'AAA\n'` and `'AAA  '` each give 1. Scheduled for TL2.

## Measured baselines

Recorded so no future session invents work the evidence refutes. Both produced
on Node v26.3.1 for 1.0.2.

- **TL-20 -- zero allocation (S0).** 20,000 ops of `computeWrap` over a 360-char
  paragraph into a reused `Float32Array(256)`:
  `measureOps(fn, { ops: 20000, warmup: 1000, stabilize: 'deep' })` then
  `checkNoGc(summary, { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 })`
  -> `verdict: pass`, `source: gc`, major 0, minor 0, maxMs 0.000, arrayBuffers
  growth 0. A second witness, `measureAllocs(fn, { iterations: 2000 })`, reports
  `bytesPerCall === 0`, `settled === true`.
- **TL-21 -- the soft-break rescan is not quadratic (S0).** 1.14 glyph-table
  reads per character at 10,150 chars over 550 lines; 1.33 at 6,000 chars. The
  rescan after a soft break costs about a third of a pass, not a second pass.

[1.1.0]: https://github.com/PeshoVurtoleta/lite-text-layout
[1.0.2]: https://github.com/PeshoVurtoleta/lite-text-layout
