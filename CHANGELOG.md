# Changelog

All notable changes to `@zakkster/lite-text-layout` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- **TL-01 (S1)** -- Buffer overflow is silent and byte-for-byte indistinguishable
  from a correct short layout. -- A 10-word text into `Float32Array(12)` yields
  the same buffer as `'AAA BBB CCC'` into it; both last lines `FLAG_NORMAL`.
- **TL-02 (S3)** -- No `countLines`, so a caller cannot size the buffer up front.
  -- `typeof TextLayout.countLines === 'undefined'`.
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
- **TL-11 (S3)** -- `TextLayout` is not frozen. -- `Object.isFrozen(TextLayout)`
  is `false`; `TextLayout.computeWrap2 = () => {}` succeeds.
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

[1.0.2]: https://github.com/PeshoVurtoleta/lite-text-layout
