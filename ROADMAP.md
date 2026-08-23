# lite-text-layout -- enriched roadmap

Six sessions for one package, plus a torture-suite spec built for a pure
function over a string. Supersedes the three-session `ROADMAP.md` (ownership
boundary, buffer overflow, range contract, frame reuse) -- none of which is
discarded; every one of them is re-anchored to a finding ID below.

**Why it grew.** The old roadmap assumed the package was small, correct and
waiting for consumers. I pulled the source and ran it. The zero-allocation
claim is TRUE and measured (TL-20) -- but eleven distinct inputs produce
silently wrong output, the package cannot be tested under the suite's own
runner, and there is no gate of any kind. Twenty-seven findings are listed in
section 2 and all but two were **reproduced by execution**, not inferred from
reading; the one exception is marked `read, not run` and says so in the table.
TL-26 was found by the TL0 torture suite itself.

| Area | State | What it needs |
| --- | --- | --- |
| **Hot body** | One linear pass, 0 bytes/op at 20,000 ops, `verdict: pass`, major 0, minor 0, maxMs 0.000 | **Nothing.** Lock it behind a gate that can fail. Do not invent allocation work. |
| **Correctness** | Buffer overflow fails CLOSED (`FLAG_OVERFLOW`, `countLines`, 1.1.0); the input door + `TextLayoutError` throw on NaN/negative/short-table/non-string/non-buffer args, CRLF is excluded from the emitted range, and the zero-line box is defined (1.2.0). Behaviour surface is closed | TL1 + TL2 done; range/cross-package contract (TL3) is the remaining non-doc session |
| **Harness** | `vitest run`, test file in the package root, no `test/`, no torture gate, no CHANGELOG, no `VERSION`, `npx esbuild` in `prepublishOnly` | TL0, first, before any behaviour change |
| **Docs** | Three version numbers disagree, README is not on the suite blueprint, 126 non-ASCII lines across five shipped files | TL4, last, after the surface stops moving |
| **Cross-package** | The bmfont contract is stated nowhere executable, and `drawWrapped` re-scales a width this package already scaled (TL-25) | TL3 now, TL5 when bmfont ships |

None of the sessions is padding. Each is anchored to a finding ID.

---

## 0. Scope and metadata correction (do this before anything else)

The published scope is **`@zakkster`** (one `s`). Grep for `@zakksters`
anywhere in this package before trusting a devDep line; that scope 404s.

Three files claim three different versions and the fourth does not exist:

| Source | Says | Truth |
| --- | --- | --- |
| `package.json` | `1.0.1` | the released version |
| `llms.txt` line 8 | `Version: 1.0.0` | stale |
| `README.md` changelog | stops at `### 1.0.0` | stale |
| `TextLayout.js` `VERSION` export | absent | must exist |
| `CHANGELOG.md` | absent | must exist |

The suite's three-place version sync has nothing to sync. TL0 fixes this and
every later session maintains it (TL-18).

**Repository metadata.** `homepage`, `repository` and `bugs` all point at
`github.com/PeshoVurtoleta/lite-text-layout`. Unlike the cross-wired
`lite-arena` case, these are at least self-consistent -- but the owner does not
match the publishing identity, so verify the remote actually exists and
actually receives issues before the next publish. Check every sibling
`package.json` in one pass, not one at a time.

**The description field ships an em dash.** `package.json`'s `description`
contains U+2014, and the registry page renders it. CLAUDE.md permits U+00D7 and
U+00B5 only. The ASCII sweep in TL0 covers `package.json`, not just the source
(TL-17).

**`prepublishOnly` fetches from the network.** It runs `npm run bundle-check`,
which is `npx esbuild ...` -- an undeclared dependency downloaded at publish
time, writing `test-bundle.js` into the package root. A publish gate that needs
the network is a publish gate that fails offline and can install anything. TL0
deletes it (TL-19).

---

## 1. Shared law (holds for every session)

1. **The FORMAT is a two-package contract.** `Float32Array`, stride 4,
   `[startIdx, endIdx, lineWidth, flags]`, indices into the ORIGINAL string,
   `endIdx` exclusive. `@zakkster/lite-bmfont`'s `drawWrapped` reads exactly
   these four slots in this order. There is no runtime dependency in either
   direction and there never will be. Any stride or slot change is a breaking
   change twice.
2. **The ownership boundary is settled and is not reopened.**
   **lite-text-layout owns LINE BREAKING** -- where lines end, and nothing
   else. **lite-bmfont owns GLYPH PLACEMENT** -- it has the atlas, the 7-field
   glyph table and the 64K kerning LUT. **This package therefore does NOT grow
   a per-glyph API.** Per-glyph animation is served by bmfont's `layoutGlyphs`
   consuming the ranges this package already reports. The job here is to make
   those ranges usable without allocating.
3. **Fail closed on every unverified state. Null is not zero, and NaN is not
   infinity.** Today NaN means "no limit" in three separate places because
   every guard is written `x > 0` and every comparison against NaN is false.
   A degenerate input is rejected at the door or defined in the contract. It is
   never accepted, never silently poisons a width, and never surfaces as a
   paragraph that renders as one NaN-wide line.
4. **Bytes in a hot body, not instructions.** `computeWrap` is one linear pass
   over `text.length`. Every guard added below is validated ONCE at function
   entry and is provably absent from the per-character loop body. A branch that
   never fires still costs its bytes in the hot body. Diff the loop, then
   re-gate with `measureOps`.
5. **The zero-allocation claim is true today and the gate exists to keep it
   true.** TL-20 is a measurement, not an aspiration. No session may propose
   allocation work; a session that "optimises" the single linear pass is
   rejected on sight, and TL-21 is the number that rejects it.
6. **Flags are a value space, not a boolean.** `FLAG_NORMAL = 0`,
   `FLAG_TRUNCATED = 1`, and from TL1 `FLAG_OVERFLOW = 2`. Consumers compare by
   equality against a named constant, never by truthiness. bmfont already does
   this correctly (`if (flags === 1)`), which is what makes TL1 additive.
7. **Documentation is contract.** The source docstring, `TextLayout.d.ts`,
   `README.md` and `llms.txt` must state the same thing. Where they disagree
   today (TL-12, TL-14) the finding is drift, and the fix may legitimately be
   to correct the sentence rather than the code.
8. **Every gate must be provably able to fail.** Every torture tier ships with
   a deliberately-broken control that makes the suite exit non-zero.

---

## 2. Verified findings

Reproduced against the working tree on 2026-08-17 with this font stub:
`glyphs` `Int16Array(256*7)`, `kerning` `Int16Array(65536)`, uppercase letters
`xadvance` 12, space 6, `'.'` 6.

Severity: **S1** = silent data loss or corruption. **S2** = broken documented
guarantee. **S3** = hygiene or contract gap. **S0** = a verified-good baseline,
recorded so that no future session invents work the evidence does not support.

One row is marked **read, not run**. The habit of this document is that
findings come from execution; that one is reasoned from the source and is
labelled so a reviewer treats it differently. TL-24 carried the same label
until the TL0 torture suite pinned it with a live, die-on-fix entry in
`test/torture/t1-degenerate.mjs`; it is now executed, and the label is gone.

| ID | Sev | Finding | Reproduction |
| --- | --- | --- | --- |
| **TL-01** | **S1** | **Buffer overflow is silent and byte-for-byte indistinguishable from a correct short layout.** The docstring says it out loud: "extra content is silently dropped". A caller cannot tell "this text is 3 lines" from "this text is 12 lines and you gave me room for 3", because the two produce identical buffers -- same ranges, same widths, same `FLAG_NORMAL` on the last line. An undersized buffer renders a truncated paragraph that looks deliberate. This is the fail-OPEN violation of law 3. | 10-word text into `Float32Array(80)` -> 10; same text into `Float32Array(12)` -> 3, last line `flags === FLAG_NORMAL`, buffer `[[0,3,36,0],[4,7,36,0],[8,11,36,0]]` -- identical to `'AAA BBB CCC'` into the same buffer |
| **TL-02** | S3 | **No `countLines`.** There is no measure-only pass, so a caller cannot size the buffer up front. This is what makes TL-01 unavoidable rather than merely undetected. | `typeof TextLayout.countLines === 'undefined'` |
| **TL-03** | **S1** | **`scale = NaN` poisons every width and silently disables wrapping entirely.** `cursorX` becomes NaN on the first glyph and stays NaN; every `cursorX + advance > boxWidth` comparison is false against NaN, so a whole paragraph collapses into a single line of NaN width. Nothing throws, nothing reports. | `computeWrap('AAA BBB', F, 40, 0, 16, out, NaN)` -> 1 line, `lineWidth === NaN`, no wrap |
| **TL-04** | S2 | **`scale = -1` and `scale = 0` are accepted silently.** `-1` gives one line of `lineWidth === -120` and no wrapping; `0` gives one line, all widths 0, and no wrapping. A negative width is not detectable downstream -- bmfont's alignment arithmetic consumes it as a number. | `computeWrap('AAA BBB CCC', F, 40, 0, 16, out, -1)` -> 1, `-120`; with `0` -> 1, `0` |
| **TL-05** | S2 | **Negative and NaN `boxWidth` silently mean "infinite".** Every horizontal guard is `boxWidth > 0`, so `-100` and `NaN` both alias the documented `0` = no limit. A caller who computed a box width by subtracting padding from a container and went negative gets one unwrapped line instead of an error. | `boxWidth = -100` and `boxWidth = NaN` both -> `[[0,15,162,0]]` on a 4-word text |
| **TL-06** | S2 | **`lineHeight <= 0` with `boxHeight > 0` disables truncation entirely.** The check `(lineCount + 2) * lineHeight * scale > boxHeight` can never fire when `lineHeight` is `0` or negative, so `FLAG_TRUNCATED` is never written and the text overflows the box the caller asked it to fit. The documented guarantee "when `boxHeight > 0`, the last fitting line is flagged" is false. | `computeWrap(5-line text, F, 40, 20, 0, out)` -> 5 lines, no flag, in a 20px box; `lineHeight = -16` -> same |
| **TL-07** | S3 | **A `boxHeight` smaller than one line still emits a line.** No policy was decided; today it is an accident of `(lineCount + 2)` requiring room for a SECOND line before it fires. | `boxHeight = 8`, `lineHeight = 16` -> 1 line, `FLAG_NORMAL`; `boxHeight = 1` -> same |
| **TL-08** | **S1** | **A short `font.glyphs` table NaN-poisons the layout silently.** `font.glyphs[id*7+6]` reads `undefined` past the end, `advance` becomes NaN, `cursorX` is NaN forever, and NaN defeats every wrap comparison so line breaking stops too. **Mitigating fact, and it must be stated:** a real `@zakkster/lite-bmfont` `BitmapFont` always allocates `Int16Array(256*7)` (`BitmapFont.js:19`), so this bites hand-rolled font objects and partially-initialised atlases, not the happy path. | `glyphs = Int16Array(100*7)` with `'AAA zzz'` (id 122) -> 1 line, `lineWidth === NaN`; `glyphs = Int16Array(4)` -> same |
| **TL-09** | S2 | **No door on `font` or `text`.** `font = {}` throws `Cannot read properties of undefined (reading '324')` and `font = null` throws `Cannot read properties of null (reading 'glyphs')` -- raw `TypeError`s from inside the hot loop, naming an internal offset, not a library error. Worse, a non-string `text` returns `0` silently: a number has no `.length`, so `len === undefined`, `len === 0` is false, the loop never runs and the flush is skipped. | `computeWrap('A', {}, ...)` and `(.., null, ..)` throw; `computeWrap(12345, F, ...)` -> `0` |
| **TL-10** | S2 | **`outBuffer` type is unchecked.** A plain `Array(16)` is accepted and written. A `Float64Array` is accepted. An `Int32Array` is accepted and **silently truncates every `lineWidth` to an integer**, which a centring consumer then mis-aligns by up to a pixel per line. There is no type door anywhere. | all three accepted; `Int32Array` -> a fractional `lineWidth` stored as its integer part |
| **TL-11** | S3 | **`TextLayout` is not frozen.** Runtime monkey-patching succeeds. Direct analogue of the blueprint's A-06. | `Object.isFrozen(TextLayout)` -> `false`; `TextLayout.computeWrap2 = () => {}` succeeds |
| **TL-12** | S3 | **A truncated line's `lineWidth` includes the ellipsis allowance, and only the d.ts says so.** `54 = content 36 + ellipsis 18`. The source docstring and llms.txt do not state it. A consumer summing widths for centring gets a different answer for a truncated line than for a normal one. | `computeWrap('AAAA BBBB CCCC DDDD', F, 60, 40, 16, out)` -> `[[0,4,48,0],[5,8,54,1]]` |
| **TL-13** | S2 | **`\r` is inside the emitted line range.** Line 0's range is `[0,4)` and `text.charCodeAt(3) === 13`, so a renderer walking `[start,end)` draws the CR -- and the CR is NOT in `lineWidth` (36 is three glyphs), so the width and the drawn run disagree. CRLF is ordinary on Windows and from any `fetch`ed `.txt`. | `computeWrap('AAA\r\nBBB', F, 0, 0, 16, out)` -> `[[0,4,36,0],[5,8,36,0]]` |
| **TL-14** | S2 | **Leading whitespace is skipped only after a soft break -- never at the start of the text and never after a `\n`.** The docstring's "runs of leading whitespace on the next line are skipped" is narrower than it reads, and a whitespace-only text yields a whitespace-only line. | `computeWrap('   ', F, 40, 0, 16, out)` -> 1 line `[0,3]` width 18; `'   AAA'` -> `[0,6]` width 54 |
| **TL-15** | S3 | **`startIdx`/`endIdx` are Float32 and therefore exact only to 2^24.** Above 16,777,216 characters the reported indices are wrong. Exotic, but this is the direct analogue of the blueprint's A-10, and it belongs pinned by name rather than left as folk knowledge. | `f32(16777217) === 16777216`; `f32(16777219) === 16777220` |
| **TL-16** | S3 | **The package violates the suite law on the test runner.** `"test": "vitest run"`, devDep `vitest ^3.0.0` (v4.1.10 actually resolved), and `TextLayout.test.js` sits in the package root rather than `test/`. CLAUDE.md says `node:test` only. | `npx vitest run` -> 31 passed; `node --test TextLayout.test.js` -> FAILS, cannot resolve the vitest import |
| **TL-17** | S3 | **ASCII-only law violated in shipped files.** Em dashes, right arrows, greater-or-equal, multiplication signs and box-drawing rules. CLAUDE.md permits U+00D7 and U+00B5 only. | `LC_ALL=C grep -c '[^ -~\t]'` -> `TextLayout.js` 18, `TextLayout.d.ts` 7, `llms.txt` 17, `README.md` 42, `TextLayout.test.js` 42 |
| **TL-18** | S3 | **Version drift: two places disagree and the third does not exist.** No `VERSION` export, no `CHANGELOG.md`. | see the table in section 0 |
| **TL-19** | S3 | **No torture gate at all**, and the publish gate fetches from the network. No `test/`, no `test/torture.mjs`, no `@zakkster/lite-gc-profiler` or `@zakkster/lite-leak` devDep, no `npm run torture`, no `verify`. `prepublishOnly` shells out to `npx esbuild`. | `package.json` `scripts` |
| **TL-20** | **S0** | **The zero-allocation claim is TRUE today, measured, not assumed.** 20,000 ops of `computeWrap` over a 360-char paragraph into a reused `Float32Array(256)`, `measureOps(fn, { ops: 20000, warmup: 1000, stabilize: 'deep' })`, `checkNoGc(summary, { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 })` -> `verdict: pass`, `source: gc`, major 0, minor 0, maxMs 0.000. The roadmap's job is to lock this behind a gate that can fail, not to fix it. | as stated |
| **TL-21** | **S0** | **The soft-break rescan is NOT quadratic.** Measured: 10,150 chars over 550 lines with an early space per line -> **1.14 glyph-table reads per character**; a 6,000-char run -> **1.33**. The re-scan after a soft break costs a third of a pass in the worst realistic shape, not a second pass. | as stated |
| **TL-22** | S3 | **The README does not follow the suite blueprint.** Its spine is emoji-headed (`What is` / `Install` / `Quick Start` / `Why a separate package?` / `Layout buffer format` / `Wrapping rules` / `Truncation` / `API` / `Benchmark` / `TypeScript` / `LLM-Friendly Documentation` / `Changelog` / `License`). Against `LiteSepforge/README.md` it is missing: the positioning H2, the TOC, "Why this exists", "What you get", the `<details>` core-surface deep dive, the constants table, "Composability" with a full end-to-end pipeline, the `<details>` Zero-GC design notes with an allocation table, "Design decisions worth knowing", "Testing", "What this is not", and "Ecosystem". The emoji headings are themselves part of TL-17. | compare `README.md` to `LiteSepforge/README.md` |
| **TL-23** | S3 | *(read, not run)* **`lastSpaceWidth` is not reset at any line break.** Only `lastSpace = -1` is reset, in several separate places. The stale width is harmless today because it is read only when `lastSpace !== -1`, but the correctness of every soft-break width rests on all those resets staying in sync. One missed reset is a silently wrong `lineWidth`, not a crash. | `TextLayout.js:74`, resets at 116, 174, 190 |
| **TL-24** | S3 | **A single glyph wider than `boxWidth` produces a line wider than the box.** The hard-break path re-seeds `cursorX` from the glyph's own `xadvance` and does not re-check `boxWidth`; the `i > lineStart` guard is what prevents an infinite loop, and the cost of that guard is an over-wide line. Related to TL-07: neither over-wide nor over-tall has a decided policy. | `computeWrap('AB', FONT, 8, 0, 16, out)` -> 2 lines, each `lineWidth` 12 against a `boxWidth` of 8, both `FLAG_NORMAL`; source at `TextLayout.js:196`, guard at 144 |
| **TL-27** | S3 | **`countLines` has no loop bound, so a broken progress invariant hangs instead of failing.** `computeWrap`'s `if (lineCount >= maxLines) break;` is not only a capacity cap -- it is also the backstop that makes a non-advancing `lineStart` terminate with wrong output rather than spin forever. `countLines` deliberately omits it (there is no buffer to cap), so the same defect becomes an infinite loop. Not reachable in correct code: `lastSpace` is only set when `i > lineStart`, so `nextStart = lastSpace + 1 > lineStart` and `lineStart` strictly increases. But a hang is the worst failure mode under the fail-closed law -- no signal at all, and CI wedges rather than reporting. **Found by TL1's own drift mutation**, which is what the mutation was for. Two consequences: the torture entry point needs a watchdog so any future hang exits non-zero, and the termination invariant needs to be written where the next editor will see it. | delete the soft-break `lastSpace = -1;` from `countLines`, then `countLines('AAA   AAAAAA   AAA', F, 46, 0, 16)` never returns; the same mutation in `computeWrap` returns a wrong count and terminates |
| **TL-26** | **S2** | **A phantom zero-width line appears when trailing whitespace soft-breaks immediately before a `\n`.** The package ships a pinned test named "does not emit a phantom trailing line for text ending in `\n`", and it passes -- for `'A\n'`. Add trailing spaces wide enough to force a soft break and the guarantee fails: the space-eater advances `lineStart` past the run, the `\n` branch then emits the empty span before it, and the caller gets a line with no content. Width-dependent, so the same text yields a different line count purely as a function of `boxWidth`. **Found by the TL0 torture suite** after the T5 corpus was widened to emit multi-space runs -- the first finding in this document produced by the gate rather than by a hand probe. Belongs to the TL2 whitespace family with TL-13 and TL-14. | `computeWrap('AAA  \n', F, 40, 0, 16, out)` -> 2, `[[0,3,36],[5,5,0]]`; `computeWrap('AAA\n', ...)` -> 1; `computeWrap('AAA  ', ...)` -> 1 |
| **TL-25** | **S2** | **Cross-package scale is applied twice.** `computeWrap` multiplies every advance by `scale`, so `lineWidth` is already at the rendered scale. `BitmapFont.drawWrapped` then computes alignment as `boxWidth - lineWidth * scale` with a comment asserting "`lineWidth` is at scale=1 per contract" (`BitmapFont.js:295-299`). Passing the same `scale` to both -- which the README's own Full Example does, with `scale: 1`, where the bug is invisible -- mis-aligns every centred or right-aligned line by a factor of `scale`. Two packages hold two different beliefs about one number, which is exactly the failure the FORMAT contract exists to prevent. | `computeWrap('AAAA BBBB', F, 0,0,16,out, s)` -> `lineWidth` 51 / 102 / 204 for s = 0.5 / 1 / 2, each equal to the true rendered width. `drawWrapped` then uses `lineWidth * s` = 25.5 / 102 / 408 -- wrong by a factor of `s` at every scale but 1 |
| **TL-28** | **S1** | **CLOSED v1.4.0 (TL6): decoded by feature-detecting `font.advanceOf` at the door (`0.0625` for 2.x, `1` for 1.x) and folding it into `s16 = scale * advScale` at all nine reads -- NOT the `FORMAT_VERSION` gate the FIX SHAPE below floated, because `FORMAT_VERSION` is a bmfont module export unreachable on the font instance. A 1.x font is byte-identical to 1.3.0. Sibling finding surfaced and pinned: a checked bmfont 2.x `drawWrapped` now THROWS on `FLAG_OVERFLOW` (F-49). --- Every advance and kerning value is read RAW from lite-bmfont's stores, so against bmfont >= 2.0.0 every computed width is EXACTLY 16x too large and wrap collapses silently.** bmfont 2.0.0 moved `glyphs[id * 7 + 6]` and the 64K kerning LUT to **1/16 FIXED POINT**, recovered with `stored * GLYPH_ADVANCE_SCALE` where `GLYPH_ADVANCE_SCALE === 0.0625`. This package never decodes: `TextLayout.js:341` (`dotAdvance`), `:377`/`:380` (the CR path), `:443`/`:442` and `:662`/`:661` (the two main advance+kerning accumulations), and `:515`/`:697` (the `cursorX` re-seed) all read the store directly and multiply only by `scale`. Measured 2026-08-22 against lite-bmfont 2.0.2: a 10-glyph string on a font with `xadvance` 10 gives `bmfont.measure` **100** and this package's `lineWidth` **1600** -- ratio EXACTLY 16 (raw slot 6 holds 160). A 306-character paragraph at `boxWidth` 560 wraps to **97 lines instead of 7**. There is no throw and no warning; the caller sees text collapsed to roughly three characters per line. **S1, not S2:** the package's single documented purpose is to emit the buffer lite-bmfont consumes (`llms.txt:3`, `package.json` description), and against the current major of that consumer it emits silently wrong geometry. That is corruption of the one output this library exists to produce, not merely a broken guarantee. **WHY BOTH TEST SUITES ARE GREEN.** This repo pins `"@zakkster/lite-bmfont": "^1.6.0"`, so npm installs a 1.x copy and every local test measures against the PRE-2.0 whole-pixel format. bmfont, for its part, added a deliberate boundary guard (`LiteBmfont/test/packaging.test.js:441`) asserting this repo's installed bmfont stays below 2.0.0 and reddening on purpose when it is bumped -- an honest guard that is currently green and correctly reports "the format has not crossed the boundary yet". Neither repo is internally wrong. The defect exists only in the GAP, where `@zakkster/lite-bmfont@2.0.1` and `@zakkster/lite-text-layout@1.3.0` are both live on npm and both READMEs advertise the pairing. Found 2026-08-22 from the lite-bmfont side while building a compound demo -- i.e. by USING the advertised integration, which is the only thing that catches this class. Filed there as **F-56**. **FIX SHAPE:** decode `stored * 0.0625` at all six sites, OR read the font's `FORMAT_VERSION` (bmfont exports it, value 2) and select the decode -- and FAIL CLOSED on a format version this package does not know, rather than assuming whole pixels. A version-gated decode is the honest one: it keeps 1.x fonts working and refuses an unknown future format instead of silently mis-scaling it. Whatever ships, it needs a fixture built from a REAL bmfont 2.x font, since a hand-written whole-pixel stub is exactly what hid this. | 10 glyphs @ `xadvance` 10 -> `bmfont.measure` **100**, raw `glyphs[65*7+6]` **160**, `computeWrap` `lineWidth` **1600**, ratio **16**; 306-char paragraph @ `boxWidth` 560 -> **97 lines** vs **7**; a whole-pixel Int16 adapter view restores agreement exactly (110 vs 110) |

### The one law that catches six of these at once

```
scale-invariance:
  computeWrap(text, F, W * s, H * s, LH, out, s)
    yields the SAME line ranges as
  computeWrap(text, F, W,     H,     LH, out, 1)
    and widths multiplied by exactly s
```

TL-03, TL-04, TL-05, TL-06 and TL-25 all violate it immediately, and TL-12's
ellipsis allowance is the one legitimate place the width side needs a stated
exception. It is cheap, it holds for every input, and it belongs in T0 as the
centrepiece of the metamorphic tier -- not in the hot path.

---

## 3. The torture suite (`test/torture.mjs`) -- spec

One harness, eight tiers, built once in TL0 and extended by every later
session. The DONE-WHEN of every session is one command:

```
node --expose-gc test/torture.mjs      -> prints exactly "ok", exit 0
npm run torture
```

### Layout

```
test/
  TextLayout.test.js    # the 31 vitest cases, ported to node:test
  torture.mjs           # entry: runs tiers in order, prints exactly "ok", exit 0/1
  torture/
    harness.mjs         # seeded PRNG, check(), the gc gate wrapper, the font fixtures
    oracle.mjs          # the brute-force reference wrapper for T5
    t0-laws.mjs         # metamorphic laws over the fuzz corpus
    t1-degenerate.mjs   # the simple nasty scalars, crossed with every parameter
    t2-capacity.mjs     # outBuffer capacity and type abuse -- where TL-01 lives
    t5-fuzz.mjs         # differential fuzz against the oracle
    t6-alloc.mjs        # the zero-alloc gate (TL-20, made falsifiable)
    t7-soak.mjs         # leak_cycles churn + lite-leak retention witness
    t8-cross.mjs        # lite-bmfont conformance -- where TL-25 lives
    t9-controls.mjs     # every gate above, deliberately broken, must fail
```

`test/` never enters `package.json` `files[]`. `npm pack --dry-run` proves it.

### Why the bvh tiers that are missing are missing

This package is a **pure function over a string**, not a mutable structure with
handles and a free list. The bvh tier set is not copied mechanically:

- **T3 adversarial sequences -- dropped.** There is no sequence. Every call is
  independent and stateless; there is no order of operations that can drive the
  subject into a bad state, because there is no state. The adversarial *content*
  (pathological space placement, one-glyph-wider-than-the-box, 10k-char runs
  with no space) lives in T1 and T5 where it belongs.
- **T4 handle abuse -- dropped.** There are no handles, no ids and no free
  list. The analogous surface is the output buffer, and it gets its own tier
  (T2) because that is where the highest-severity finding lives.
- **T2 aliasing matrix -- narrowed to one case, not a tier.** `text` and `font`
  are read-only and `outBuffer` is write-only, so there is no out/a/b overlap
  matrix to cross. The single case worth pinning is an `outBuffer` that is a
  `Float32Array` view over the same `ArrayBuffer` as `font.glyphs`; it is one
  named test inside T2, not nine.
- **Free-list conservation -- dropped.** No allocator, nothing to conserve. Its
  role as "the invariant that catches five bugs at once" is taken by
  scale-invariance in T0.

The tier numbers keep the bvh names where the intent matches (`t5-fuzz`,
`t6-alloc`, `t7-soak`, `t8-cross`, `t9-controls`) so a reader who knows one
suite knows this one.

### Harness rules

- All fonts, output buffers and text corpora allocated **once**, outside every
  loop. No `makeFont()` per iteration, no template literal per iteration, no
  closure per iteration. The subject allocates nothing; the harness must not
  either, or the gate measures the harness.
- `check(cond, msgThunk)` -- the message is a thunk so the happy path builds no
  string. A template literal per iteration is an allocation and will fail your
  own gate.
- Seeded **xorshift32**, seeded from `TORTURE_SEED` (default `0x9e3779b9`,
  never 0). On any failure print the seed and the case index so the run replays
  with `TORTURE_SEED=... node --expose-gc test/torture.mjs`.
- `export const RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 }`
  with `stabilize: 'deep'` on every `measureOps` call. `maxArrayBuffersGrowth`
  is node/`source:'gc'` only and is **inconclusive without `stabilize:'deep'`**;
  the deep mode is what makes it resolvable.
- lite-gc-profiler is **one measurement at a time**. `measureOps`,
  `measureFrames`, `measureOpsAsync` and `measureAllocs` share one heap and
  throw "already in flight" if nested. Tiers run **strictly sequentially**,
  never nested, never concurrent.
- **Unknown rule keys throw** on every lane including `checkNoGc`. Do not write
  options from memory -- read `../LiteGCProfiler/llms.txt` for the current
  surface before adding a key. There is no `maxExternalGrowth`.
- Never resolve an unexpected `inconclusive` with `allowInconclusive`. That is
  the escape hatch, not the fix; triage via the profiler's `INCONCLUSIVE.md`.
- `TEXTLAYOUT_TORTURE_BREAK=1` is the whole-suite control. It injects a
  retained allocation into the T6 hot body and **must exit non-zero**; reaching
  the end of the run with it set is itself a failure.
- The gate prints **exactly `ok`** on stdout and nothing else. Every diagnostic
  goes to stderr. No gate output is a FAIL.

### Tier T0 -- metamorphic laws

Properties that must hold for *any* input, checked over the T5 corpus. High
yield, no oracle needed:

- **Scale invariance** (the law from section 2), with TL-12's ellipsis
  allowance as the one stated exception, asserted rather than tolerated.
- **Partition**: for every emitted line, `0 <= startIdx <= endIdx <= len`, and
  `line[k+1].startIdx >= line[k].endIdx`. Everything skipped between two lines
  is a break character (code 32 or 10) or, post-TL2, a CR.
- **Width agreement**: `lineWidth` equals the sum of `xadvance * scale` plus
  `kerning * scale` over `[startIdx, endIdx)`, computed independently.
- **Monotonicity in `boxWidth`**: for a fixed text and `boxWidth` at least as
  wide as the widest single glyph, growing `boxWidth` never increases the line
  count.
- **`boxWidth === 0` means no horizontal limit**: line count equals
  `1 + count('\n')` exactly.
- **Purity**: two identical calls into two distinct buffers produce
  byte-identical output; the function is stateless across calls in any order.
- **No read-back**: pre-fill `outBuffer` with a poison value; assert every slot
  past `lineCount * 4` is still poison, and that the result does not depend on
  the pre-fill. The README claims this; nothing asserts it.
- **`countLines` agreement** (from TL1): `countLines(...)` equals
  `computeWrap(..., oversizedBuffer)` for every case in the corpus, including
  the truncating ones.
- **No empty line** unless it came from an explicit `\n`.

### Tier T1 -- degenerate values

Cross every parameter with the simple nasty ones and pin the *actual* answer,
including the ugly ones. Pinning "this returns NaN" is a valid contract for
exactly as long as it is deliberate; leaving it unpinned is not.

- `boxWidth`: `0`, `-0`, `-1`, `-100`, `NaN`, `+Infinity`, `-Infinity`, `1e-7`,
  `3.4e38`, one ulp above and below a glyph advance (TL-05).
- `boxHeight`: the same set, plus `1` and `8` against `lineHeight = 16` (TL-07).
- `lineHeight`: `0`, `-16`, `NaN`, `Infinity` (TL-06).
- `scale`: `1`, `0`, `-1`, `NaN`, `Infinity`, `1e-30`, `2`, `0.5` (TL-03,
  TL-04).
- `text`: `''`, `' '`, `'   '`, `'   AAA'`, `'\n'`, `'\n\n\n'`, `'\r\n'`,
  `'AAA\r\nBBB'`, a lone `'\r'`, a trailing `'\n'`, 10k chars with no space,
  every code point 0..255 in sequence, ids 255/256/65535, a lone surrogate
  (TL-13, TL-14).
- `font`: full stub, `glyphs` short at 100*7 and at 4, `kerning` short, `'.'`
  missing from the atlas, `{}`, `null`, `undefined`, a frozen object (TL-08,
  TL-09).
- `text` not a string: `12345`, `null`, `undefined`, an array of chars (TL-09).
- **The f32 index boundary, by name**: assert that an index of 16,777,217 does
  not round-trip, and that the documented ceiling is 2^24 characters (TL-15).

### Tier T2 -- output buffer capacity and type (this is where TL-01 lives)

| Case | Status today |
| --- | --- |
| `length === 0` | returns 0 -- correct |
| `length` 1, 2, 3 (under one stride) | returns 0 -- correct |
| `length === 4 * n` exactly, text fits in `n` lines | correct |
| `length === 4 * n` exactly, text needs `n + 1` lines | **BROKEN (TL-01): silent, indistinguishable** |
| `length === 4 * n + 3` (partial trailing stride) | correct, surplus ignored -- pin it |
| oversized buffer, tail untouched | claimed, unasserted -- pin it |
| plain `Array(16)` | accepted (TL-10) |
| `Float64Array` | accepted (TL-10) |
| `Int32Array` | accepted, **truncates every width** (TL-10) |
| `outBuffer` viewing the same `ArrayBuffer` as `font.glyphs` | undefined, undocumented -- decide it |

Every row gets a named test. Post-TL1 the broken row asserts
`flags === FLAG_OVERFLOW` on the last written line. Post-TL2 the type rows
assert the recorded policy: **throw**, **documented coercion**, or
**documented undefined**. "Silently returns garbage" is not one of the three.

### Tier T5 -- differential fuzz against a brute-force oracle

**Name the oracle concretely.** `test/torture/oracle.mjs` exports
`oracleWrap(text, font, boxWidth, scale) -> Array<{start, end, width}>`: an
obvious, slow, deliberately naive reference wrapper written in plain JS that

- splits the text into paragraphs on `\n`,
- splits each paragraph into words on single spaces,
- measures a run by summing `glyphs[id * 7 + 6] * scale` plus
  `kerning[(prev << 8) | id] * scale` for each character, resetting `prev` at
  the start of every line and on every non-ASCII id,
- greedily packs words onto a line while the running width plus the next word
  fits `boxWidth`, and hard-breaks mid-word when a single word alone exceeds
  the box.

It is **allowed to allocate freely** -- it builds arrays and slices strings,
and it is never called inside a measured window. It is written from the five
documented wrapping rules top-down, not by copying the implementation; an
oracle transcribed from the subject proves nothing.

Domain: `boxHeight = 0` only. Truncation is deliberately outside the oracle --
the "latest position where content plus ellipsis still fits" rule is intricate
enough that a second implementation of it would be a second chance to be wrong
in the same way. Truncation is pinned by named cases in T0 and T1 instead, and
that exclusion is written in the file header so nobody assumes it is covered.

Run 50,000 seeded cases: word lengths 1..12 over the populated glyph ids,
0..40 words, 0..4 newlines, `boxWidth` in `[0, 300]`, `scale` in
`{0.5, 1, 2}`. Compare line ranges exactly and widths within one f32 ulp of the
oracle's f64 sum. On divergence print the seed, the case index and the exact
call so it replays in one line. This is the tier that finds the bug nobody
thought to name.

### Tier T6 -- the zero-alloc gate

TL-20 measured this by hand and it passed. T6 is that measurement, made
repeatable and made able to fail.

```js
// shape only -- read ../LiteGCProfiler/llms.txt for the exact current surface
const res = measureOps(hot, { ops: 20000, warmup: 1000, stabilize: 'deep' });
const report = checkNoGc(res.summary, RULES);   // maxMajor 0, maxPauseMs 4,
                                                // maxArrayBuffersGrowth 0
```

Three lanes, sequential, never nested:

1. `computeWrap` over a 360-char paragraph into a reused `Float32Array(256)` --
   the exact TL-20 shape, so a regression is comparable against a recorded
   number.
2. `countLines` over the same paragraph (TL1 onward) -- a measure-only pass
   that touches no buffer must also be 0 bytes/op.
3. The doors from TL2 active on **valid** input -- proof that validation at the
   entry did not cost the loop. The throwing paths are never measured; an
   `Error` allocates, and it allocates exactly once, on a path that is a caller
   bug.

Plus a second, independent witness that a rate gate cannot give:

```js
const allocs = measureAllocs(hot, { /* iterations per llms.txt */ });
checkAllocs(allocs, { maxBytesPerCall: 0 });   // literal zero-retention claim
```

Plus the structural assertion no heap gate can substitute for:
`out.buffer.byteLength` is identical before and after the window.

### Tier T7 -- soak and retention

`leak_cycles: 4096`. Each cycle takes one text from a pre-built pool of 64
strings (built once, before the loop), computes a wrap into a reused buffer,
registers a per-cycle resource with `createLeakTracker()` and untracks it.
After every cycle assert the line count matches the pooled expectation. After
the last cycle assert **`tracker.size() === 0`** -- a JS-object leak and a
buffer leak cannot hide behind each other if two independent witnesses have to
agree. Sample `heapUsed` at cycle boundaries only, after `globalThis.gc()`,
never within a cycle, and assert growth under 512 KB across all 4096.

### Tier T8 -- cross-package conformance with lite-bmfont

`@zakkster/lite-bmfont` is a **test-only devDependency**. This package keeps
zero runtime dependencies, in both directions, forever.

Shippable today (bmfont v1.2.0, public surface only):

- **Width agreement**: for every line of a wrapped corpus,
  `lineWidth === font.measure(text.slice(startIdx, endIdx), scale)` within one
  f32 ulp. The `slice` allocates; a test may allocate. Only the *runtime*
  claim needs the range API.
- **TL-25, the scale-double-application detector**: assert that
  `computeWrap(..., scale)` and `drawWrapped(..., scale)` agree on the meaning
  of `lineWidth` for `scale` in `{0.5, 1, 2}`. This test **fails today at
  `scale = 0.5` and `scale = 2`**, and that is the point -- it is the
  executable form of the finding. The fix is a one-package decision recorded in
  TL3, not a silent edit on either side.
- **Format conformance**: assert the stride is 4, the slot order is
  `[startIdx, endIdx, lineWidth, flags]`, and that `drawWrapped` tests
  `flags === 1` by equality (`BitmapFont.js:361`) -- which is what makes
  `FLAG_OVERFLOW = 2` additive rather than breaking.

Deferred to TL5 and stated as blocked, not silently omitted:
`layoutGlyphs` and a range-aware `measure` are lite-bmfont's Sessions 1 and 2
and are **NOT shipped in v1.2.0**. `_measureRange` exists but is private and
underscore-prefixed; the torture suite does not call it. When bmfont ships the
public range parameters, the `slice` above becomes a range call and the
0-bytes-per-frame end-to-end gate lands in this tier.

### Tier T9 -- controls (the gate must be able to fail)

Every gate above, deliberately broken, must be caught:

1. An allocating hot body (`leak.push(new Float64Array(64))`) must be rejected
   by the T6 gate.
2. A corrupted oracle (drop the last line, or add 1 to one width) must be
   flagged as divergent by the T5 comparator.
3. A stub `countLines` that returns the capped `computeWrap` result must fail
   the T0 agreement law -- otherwise the law is vacuous on exactly the input
   TL-02 exists for.
4. An overflow that is written without `FLAG_OVERFLOW` must fail T2.
5. Assignment to a frozen `TextLayout` must throw in strict mode; a
   non-frozen namespace must be detected.
6. A scale-invariance checker fed a deliberately double-scaled width must
   report the violation -- the TL-25 detector proving it can bite.
7. The whole-suite `TEXTLAYOUT_TORTURE_BREAK=1` run must exit non-zero.

If a control passes, the gate is decorative.

---

## 4. Session order

```
TL0 --> TL1 --> TL2 --> TL3 --> TL4
 |       |       |       |
 |       |       |       `--> TL5   (BLOCKED)
 |       |       |                     ^
 |       |       |                     |
 |       |       |        lite-bmfont S1 --> S2 (range-aware measure)
 |       |       |
 |       |       `-- input doors: needs TL1's countLines to size the
 |       |           measure-only path it validates
 |       `-- fail-closed: needs a gate that can prove the fix costs nothing
 `-- harness: everything downstream leans on one torture command
```

`TL0` blocks everything: no behaviour change lands in this package until
`node --expose-gc test/torture.mjs` can fail. `TL1` precedes `TL2` because
`countLines` is a second entry point, and a door written once for one entry
point and then retrofitted to two is a door written twice. `TL3` precedes `TL4`
because TL-25's resolution changes what the README must say about `scale`.
`TL5` is **blocked on a package this roadmap does not own** and is written as
blocked; it does not sit in the critical path and no session's DONE WHEN
depends on it.

---

## 5. The briefs

===============================================================================
# TL0 -- lite-text-layout v1.0.2 -- node:test + the torture skeleton
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.0.2
status: shipped
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [TL-16, TL-17, TL-18, TL-19, TL-20, TL-21]
blocks: [TL1, TL2, TL3, TL4, TL5]
---

# lite-text-layout -- enforce node:test, stand up the gate that can fail

PURPOSE
  The package cannot be tested under the suite's own runner, has no gate of
  any kind, and its publish step downloads a bundler from the network. Every
  later session's DONE WHEN is one torture command; this session builds it.

  It also records the good news as a baseline. TL-20 measured 0 bytes/op and
  TL-21 measured 1.14 glyph reads per character. Both numbers go in the
  CHANGELOG so that no future session invents work the evidence refutes.

TASKS
  - Port TextLayout.test.js to node:test and move it to test/TextLayout.test.js.
    Keep all 31 cases and every describe group.
    `import { test, describe } from 'node:test'`,
    `import assert from 'node:assert/strict'`. Set `"test": "node --test"`.
    Drop the vitest devDep. Grep proves no `vitest` import survives anywhere.
  - Add `engines: { "node": ">=18" }`. `node --test` requires it and the
    package currently declares no floor at all.
  - Add `CHANGELOG.md` and a `VERSION` const exported from TextLayout.js.
    Correct `llms.txt` line 8 to the shipping version. Add CHANGELOG.md to
    `files[]`. Three-place version sync from this release forward (TL-18).
  - Delete `bundle-check` and its `npx esbuild` call. Replace `prepublishOnly`
    with `npm run verify` = `node --test && node --expose-gc test/torture.mjs`.
    A publish gate must not need the network (TL-19).
  - ASCII sweep across TextLayout.js, TextLayout.d.ts, llms.txt, README.md,
    the ported test file AND package.json's `description`. Replace with `->`,
    `<=`, `x`, "degrees", `...`. U+00D7 and U+00B5 excepted, and neither
    appears here (TL-17).
  - Build test/torture.mjs + test/torture/harness.mjs per section 3. Register
    T0, T1, T2, T5, T6, T7, T9 now, each with at least the cases that pass
    today. Register T8 as an empty tier that TL3 fills.
  - Wire the T6 lane to the exact TL-20 shape (20,000 ops, 360-char paragraph,
    reused Float32Array(256), warmup 1000, stabilize 'deep') so the number in
    the CHANGELOG and the number in the gate are the same number.
  - devDeps `@zakkster/lite-gc-profiler` and `@zakkster/lite-leak`
    (NOT `@zakksters` -- that scope 404s).
  - Record every finding in section 2 in CHANGELOG.md under "Known issues",
    each with its ID and its one-line reproduction.

HOT PATH
  Untouched. This session must not change one byte of the `computeWrap` loop.
  `git diff TextLayout.js` shows the VERSION export, ASCII replacements in
  comments, and nothing else. If the T6 lane reads anything other than the
  TL-20 numbers at the end of this session, the ASCII sweep touched code.

ASSERTIONS
  - `node --test` green, 31 passing, 0 failing.
  - `node --expose-gc test/torture.mjs` prints exactly "ok", exit 0.
  - `TEXTLAYOUT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` exits
    non-zero.
  - T9 controls 1, 2 and 5 all fire (the other four arrive with their sessions).
  - T6 reports major 0, minor 0, maxPauseMs under 4, arrayBuffers growth 0 --
    matching the TL-20 baseline.
  - T7: 4096 cycles, `tracker.size() === 0`, heap growth under 512 KB.
  - `LC_ALL=C grep -c '[^ -~\t]'` returns 0 for every shipped file and for
    package.json.
  - `npm pack --dry-run` excludes test/ and includes CHANGELOG.md.
  - VERSION, package.json and llms.txt all read 1.0.2.

NON-GOALS
  No behaviour change of any kind. No new exports besides VERSION. No fixes --
  every finding is recorded in CHANGELOG as a known issue and fixed in TL1/TL2.

DONE WHEN
  node --test green under node:test; torture prints exactly "ok"; the BREAK
  control exits non-zero; the TL-20 and TL-21 baselines are in the CHANGELOG
```

===============================================================================
# TL1 -- lite-text-layout v1.1.0 -- fail closed on buffer overflow
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.1.0
status: shipped
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [TL-01, TL-02, TL-11]
depends_on: [TL0]
blocks: [TL2]
---

# lite-text-layout -- an undersized buffer must say so

PURPOSE
  `computeWrap` caps the line count at `floor(outBuffer.length / 4)` and, in
  the words of its own docstring, "extra content is silently dropped." That is
  fail-OPEN. The caller receives a buffer that is byte-for-byte identical to a
  correct short layout, renders a truncated paragraph that looks deliberate,
  and has no way to find out. This is the highest-severity item in the package
  and the old roadmap's Session 1, kept whole.

  Two halves, and they are not the same problem. FLAG_TRUNCATED means "the TEXT
  did not fit the BOX" -- a designed outcome with an ellipsis. FLAG_OVERFLOW
  means "the BUFFER did not fit the TEXT" -- a caller bug being reported. Both
  can occur on the same call. Do not merge them.

THE SEMVER DECISION (commit to it before coding)
  `FLAG_OVERFLOW = 2` is a NEW VALUE in an EXISTING field, and the question is
  whether that is minor or major. It is **MINOR**, and here is the argument:

    1. The value 2 is reachable only on a call that overflows the buffer --
       that is, only on a call whose output is already wrong today. No call
       that behaves correctly today can start seeing a 2.
    2. The one in-ecosystem consumer reads the field by equality:
       `BitmapFont.drawWrapped` does `if (flags === 1)` (BitmapFont.js:361).
       A 2 falls through to no ellipsis, which is exactly right.
    3. The documented contract lists two values, so a consumer with an
       `if/else` treating "not 0" as truncated would now draw an ellipsis on
       an overflow line. That is the real risk, it is cosmetic, and it occurs
       only in the already-broken case from (1).

  Record this in decisions/0001-flag-overflow.md before writing code, together
  with the counter-argument, so the next person does not relitigate it from
  scratch. Add law 6 ("flags are a value space, compare by equality") to
  README, d.ts and llms.txt in the same release.

THE SIGNATURE DECISION
  The old roadmap proposed
  `countLines(text, font, boxWidth, lineHeight, scale)`. That signature is
  wrong: without `boxHeight` it cannot agree with `computeWrap` on any call
  where truncation fires, and "agrees with computeWrap for every case" is the
  whole point of the function. Ship the full parameter list minus the buffer:

    countLines(text, font, boxWidth, boxHeight, lineHeight, scale = 1.0)
      -> number

  Same parameters in the same order as computeWrap, with `outBuffer` removed.
  A caller sizes `new Float32Array(countLines(...) * 4)` and can never overflow.

TASKS
  - Add `export const FLAG_OVERFLOW = 2;` with a docstring that states the
    distinction from FLAG_TRUNCATED in one sentence.
  - When the loop stops because `lineCount >= maxLines` while text remains,
    OR the remainder flush is skipped because the buffer is full, set the LAST
    written line's flags slot to FLAG_OVERFLOW. The partial layout is
    preserved -- a sentinel `-1` return would throw away work the caller can
    still use, which is why the flag was chosen over the sentinel.
  - Decide and document the interaction: a line that is BOTH the truncation
    point and the overflow point. Recommended: FLAG_OVERFLOW wins, because
    truncation is a designed outcome the caller asked for and overflow is a
    bug the caller needs to hear about. Write the rule down either way.
  - Implement `countLines` as the same single pass with every `outBuffer[ptr++]`
    removed and `maxLines` unbounded. Do NOT implement it by calling
    computeWrap with a scratch buffer -- that reintroduces a capacity and
    therefore reintroduces TL-01 inside the function that exists to prevent it.
  - `Object.freeze(TextLayout)` (TL-11). One line; the namespace is a law, not
    a mutable bag.
  - Fill torture T2 completely per section 3. Add the T0 countLines-agreement
    law over the whole T5 corpus. Add T9 controls 3 and 4.
  - Update d.ts, llms.txt, README constants table, and the source docstring --
    all four, in this release, including deleting "extra content is silently
    dropped."

HOT PATH
  `computeWrap` is one linear pass and TL-20 proves it allocates nothing. This
  session must keep both properties.
    - The overflow flag is written ONCE, after the loop, at a `ptr` the
      function already knows. It is not a per-character branch. The existing
      `if (lineCount >= maxLines) break;` at the top of the loop stays exactly
      where it is; the new work happens after the break, on the cold side.
    - `countLines` is a SECOND function, not an `outBuffer === null` branch
      inside the first. A null check per emitted line would be cheap, but a
      second entry point keeps `computeWrap`'s call site monomorphic and its
      body byte-identical. Duplicating a 60-line pass is the cost; measure both
      and record the choice.
    - `Object.freeze` is a one-time cost at module load. V8 does not slow
      property reads on a frozen object; confirm with the T6 lane, do not
      assume.

ASSERTIONS
  - A 1-line buffer given 10 lines of text returns 1 with
    `flags === FLAG_OVERFLOW` on line 0.
  - The TL-01 reproduction, executable: the 10-word text into
    `Float32Array(12)` is now DISTINGUISHABLE from `'AAA BBB CCC'` into the
    same buffer. Both directions asserted -- the short text must NOT be
    flagged, or the flag is noise.
  - `countLines` equals `computeWrap` into an oversized buffer for every one of
    the 31 ported cases and for all 50,000 T5 fuzz cases, including the
    truncating ones.
  - A buffer sized from `countLines` never overflows -- asserted over the fuzz
    corpus.
  - `Object.isFrozen(TextLayout)` is true; assignment throws in strict mode.
  - T6: `computeWrap` still 0 bytes/op against the TL-20 baseline, and
    `countLines` is 0 bytes/op on its own lane.
  - `FLAG_OVERFLOW === 2`, and `drawWrapped` draws no ellipsis for it (T8).
  - torture prints "ok"; T9 controls 3 and 4 exit non-zero.

NON-GOALS
  No input validation (TL2). No per-glyph anything, ever (law 2). No sentinel
  return. No change to FLAG_TRUNCATED's meaning or value.

DONE WHEN
  an undersized buffer reports itself; countLines agrees with computeWrap on
  every case in the corpus; the namespace is frozen; 0 bytes/op unchanged
```

===============================================================================
# TL2 -- lite-text-layout v1.2.0 -- the input door
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.2.0
status: shipped          # 2026-08-17; 54 tests, torture ok; TL-03..10/12/13/14/15/23/24/26 closed; input door + TextLayoutError + CRLF
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [TL-03, TL-04, TL-05, TL-06, TL-07, TL-08, TL-09, TL-10, TL-12, TL-13, TL-14, TL-15, TL-23, TL-24, TL-26]
depends_on: [TL1]
blocks: [TL3]
---

# lite-text-layout -- NaN is not infinity, and null is not zero

PURPOSE
  Ten findings, one root cause: every guard in the function is written `x > 0`,
  and every comparison against NaN is false. So NaN boxWidth means "no
  horizontal limit", NaN scale means "no wrapping at all", a short glyph table
  means "no wrapping at all AND every width is NaN", and `lineHeight <= 0`
  means "truncation is off" while the caller believes they asked for it.

  None of these throws. All of them render.

WHY THESE TOGETHER
  They are one bug in ten costumes: the function trusts its arguments and
  discovers the problem in the middle of a loop, where a poisoned local has
  already defeated every downstream comparison. One door at the top of the
  function closes all ten, and writing ten separate guards means writing the
  same door ten times in the wrong place.

THE DECISION (record it in decisions/0002-input-door.md BEFORE coding)
  Three policies, and each finding gets exactly one:

  A. THROW a named library error at the door. For arguments that cannot mean
     anything: `text` not a string (TL-09); `font` null/undefined or missing
     either table (TL-09); `font.glyphs.length < 256 * 7` or
     `font.kerning.length < 65536` (TL-08); `scale` non-finite or `<= 0`
     (TL-03, TL-04); `boxWidth`/`boxHeight`/`lineHeight` non-finite (TL-03,
     TL-05, TL-06); `outBuffer` not a Float32Array (TL-10).
     The TL-08 check is the interesting one: it is two length reads at the
     door and it converts an invisible NaN paragraph into a message naming
     the table. State the mitigating fact in the error text -- a real
     BitmapFont always allocates the full table (BitmapFont.js:19), so this
     door fires for hand-rolled fonts and half-built atlases.
  B. DEFINE the semantics and document them. For arguments that could
     reasonably mean something: negative `boxWidth`/`boxHeight` (recommended:
     throw, because silently aliasing 0 is how TL-05 hides a padding
     subtraction that went negative); `lineHeight <= 0` with `boxHeight > 0`
     (recommended: throw -- the caller asked for truncation and cannot get
     it); `boxHeight` smaller than one line (TL-07, recommended: emit zero
     lines, because a line that does not fit the box is not a line that fits
     the box, and returning 0 is the only answer a caller cannot misread);
     a single glyph wider than `boxWidth` (TL-24, recommended: emit the
     over-wide line and document it, because the alternative is dropping
     content).
  C. DOCUMENT, change nothing. **This is the right answer for TL-14 and it is
     the non-obvious call in this session.** Skipping leading whitespace at
     the start of the text would silently destroy deliberate indentation, and
     `'   '` -> one line of width 18 is a defensible indent line. The code is
     right; the docstring's "runs of leading whitespace on the next line are
     skipped (no whitespace-only lines)" is the thing that is wrong. Narrow
     the sentence to "after a soft break" in all four documentation surfaces.
     Same for TL-12: state the ellipsis allowance everywhere, not just d.ts.

  TL-13 (CR inside the range) is the one that needs code AND a decision:
  recommended is to exclude a single CR immediately preceding an LF from the
  emitted range, so CRLF text lays out identically to LF text. See HOT PATH --
  this belongs in the newline branch, which runs once per line, and NOT as a
  per-character `id === 13` test. A lone CR keeps its current behaviour (a
  glyph with whatever advance the atlas gives id 13, normally 0) and that gets
  documented rather than special-cased.

TASKS
  - Write the decision file first, with a row per finding and its policy.
  - Implement the door as a single validation block at the top of BOTH
    `computeWrap` and `countLines`, before the first loop iteration. Extract
    it to one shared internal function so the two entry points cannot drift.
  - Library error type: one named error with a message that says which
    argument, what it received, and what is required. A raw
    `Cannot read properties of undefined (reading '324')` tells the caller
    nothing (TL-09).
  - Implement the CRLF rule in the `id === 10` branch only.
  - TL-23: reset `lastSpaceWidth` alongside every `lastSpace = -1`, or hoist
    both into one small reset. It is not a live bug; it is several places that
    must stay in sync, and the T5 fuzz is what proves they do.
  - **TL-15 -- assigned here as of this revision.** It was a live known-failing
    gate entry that no session's `findings:` list owned; TL2 is the right home
    because a `text.length` ceiling is an input-domain fact and this is the
    input-door session. `startIdx`/`endIdx` are Float32 and exact only to 2^24,
    so a text longer than 16,777,216 characters reports indices that do not
    round-trip. Policy B, and the recommendation is DOCUMENT the ceiling rather
    than throw: the check is one `text.length` read at the door, but a throw
    turns a 16 MB string -- legal input that lays out correctly for every index
    below the ceiling -- into a hard failure. Pin the two round-trip facts by
    name (`f32(16777217) === 16777216`, `f32(16777219) === 16777220`) and state
    the ceiling in all four documentation surfaces. If the decision file argues
    for a throw instead, that is acceptable; what is not acceptable is leaving
    it unowned for a third session.
  - **Inherited from TL1's QA: add the missing T5 flag tripwire.** Two universal
    claims hold today but have no standalone instrument -- every flags slot is in
    `{0, 1, 2}`, and no single output ever carries both a `FLAG_TRUNCATED` and a
    `FLAG_OVERFLOW` line. TL1's QA measured them directly (0 violations over
    161,249 flag slots across the 50,000-case corpus) but they survive only as an
    emergent consequence of the per-case iff check plus an unreachability proof
    written in prose. `t5-fuzz.mjs` does not even import `FLAG_TRUNCATED`. TL2
    edits the whitespace and newline machinery those claims rest on, so it is the
    session that must give them their own check before it starts.
  - Extend torture T1 to cross every parameter with every degenerate value and
    pin the post-door answer for each -- throw, defined result, or documented.
  - Extend T2 with the buffer-type rows now that they have a policy.
  - Add the T0 scale-invariance law as an executable check across the corpus;
    it is the single assertion that catches TL-03 through TL-06 at once.
  - Update d.ts, llms.txt, README and the source docstring for every policy,
    including the TL-12 and TL-14 sentence corrections.

HOT PATH
  This is the session most likely to break the package's identity, so the
  discipline is explicit:
    - Every check runs ONCE, at function entry, before the loop. Not one new
      branch enters the per-character body. Diff the loop body before and
      after; it must be character-identical apart from the newline branch.
    - `font.glyphs.length` and `font.kerning.length` are read once at the door,
      never per character. The loop keeps indexing the tables directly.
    - The CRLF rule adds ONE `charCodeAt` inside the `id === 10` branch, which
      executes once per line, not once per character. On the 360-char TL-20
      paragraph that is a handful of extra reads per call. Measure it; if it
      is not within noise, the rule moves to option C (document, normalise
      upstream) and the decision file records why.
    - Error objects allocate. They are allocated only on the throwing path,
      which is never measured and never hot. Do not pre-build a shared error
      instance to avoid the allocation -- a shared error has a shared stack
      and lies about where it came from.
    - Re-run the T6 lane against the TL-20 baseline. "Likely zero" is not a
      measurement.

ASSERTIONS
  - Every one of TL-03 through TL-10, TL-13 has a named test that FAILED
    before this session and PASSES after, with the reproduction from section 2
    as the test body.
  - `scale` NaN / 0 / -1 / Infinity each throw a library error naming `scale`.
  - `boxWidth` -100 and NaN each throw; `boxWidth` 0 still means no limit.
  - `lineHeight` 0 and -16 with `boxHeight > 0` each throw.
  - `glyphs = Int16Array(100 * 7)` throws and the message names `font.glyphs`
    and the required length.
  - `font = {}`, `font = null`, `text = 12345` each throw a library error, not
    a TypeError mentioning an internal offset.
  - `Int32Array`, `Float64Array` and plain `Array` output buffers behave per
    the recorded policy, one named test each.
  - `computeWrap('AAA\r\nBBB', ...)` yields `[[0,3,36,0],[5,8,36,0]]` -- the CR
    is outside the range, and the widths are unchanged.
  - `'   AAA'` still yields `[0,6]` width 54, with a test named for the fact
    that this is DELIBERATE (indentation is preserved) so nobody "fixes" it.
  - TL-15's two round-trip facts are pinned by name and the 2^24 ceiling
    appears in d.ts, llms.txt, README and the source docstring.
  - Scale invariance holds across the whole T5 corpus.
  - T6: 0 bytes/op, within noise of the TL-20 baseline, on all three lanes.
  - torture "ok"; T9 control 6 exits non-zero.

NON-GOALS
  No cross-package work (TL3). No README rebuild (TL4). No change to the
  wrapping algorithm itself -- the doors decide what enters the loop, not what
  the loop does.

DONE WHEN
  every degenerate input either throws a named error or has a pinned,
  documented result; the per-character loop body is diff-identical apart from
  the CRLF rule; 0 bytes/op measured, not assumed
```

===============================================================================
# TL3 -- lite-text-layout v1.2.1 -- the range contract, made executable
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.2.1
status: shipped          # 2026-08-18 (v1.2.1); brief archived briefs/TL3-shipped.md
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-bmfont"]
findings: [TL-12, TL-25]
depends_on: [TL2]
blocks: [TL4, TL5]
---

# lite-text-layout -- two packages, one number, currently two beliefs

PURPOSE
  This is the old roadmap's Session 2, and reading the peer turned it from a
  documentation task into a defect. The output format is already correct --
  `[startIdx, endIdx]` are indices into the original string, deliberately, so
  a consumer never has to `slice()`. What is missing is any executable
  agreement, and in the gap between the two packages a real bug has been
  sitting:

  `computeWrap` multiplies every advance by `scale`, so `lineWidth` is already
  at the rendered scale. `BitmapFont.drawWrapped` then computes alignment as
  `boxWidth - lineWidth * scale`, with a comment asserting "`lineWidth` is at
  scale=1 per contract" (BitmapFont.js:295-299). Pass the same scale to both
  and every centred or right-aligned line is displaced by a factor of `scale`.
  Measured: `'AAAA BBBB'` reports `lineWidth` 51 / 102 / 204 at scale
  0.5 / 1 / 2 -- each the true rendered width -- and `drawWrapped` then uses
  25.5 / 102 / 408. The README's own Full Example passes 1 to both, which is
  precisely why nobody has seen it (TL-25).

  This is a two-package contract in the same spirit as the lite-bvh /
  lite-aabb FORMAT agreement: no dependency edge, a shared definition, and a
  test that proves the agreement.

THE DECISION (record it in decisions/0003-scale-contract.md BEFORE coding)
  One of the two packages is wrong about `lineWidth` and they must be told
  apart in writing:
  A. `lineWidth` is at the RENDERED scale (what this package does). bmfont's
     `drawWrapped` drops its `* scale` on the alignment terms. Cheapest;
     matches the code that produced every shipped layout buffer.
  B. `lineWidth` is at scale 1 (what bmfont's comment claims). This package
     stops scaling the stored width -- but it must still scale internally for
     the wrap comparisons, so it would divide back out, and a division per
     line for the benefit of a comment is a bad trade.
  Recommendation: **A**. It is what the data already says, it needs no change
  here, and the fix is one term in the peer. This package's job in this
  session is to make the claim executable and to file the peer change with a
  failing test attached.

TASKS
  - Write the range semantics down, in one place, in the same words in the
    source docstring, d.ts, llms.txt and README: `startIdx` inclusive,
    `endIdx` exclusive, both indices into the ORIGINAL string; the breaking
    space is excluded from both sides; leading whitespace is skipped only
    after a soft break (TL-14's corrected sentence); `lineWidth` is at the
    rendered scale and INCLUDES the ellipsis allowance on a FLAG_TRUNCATED
    line (TL-12).
  - Add `@zakkster/lite-bmfont` as a test-only devDependency. This package
    keeps zero runtime dependencies in both directions.
  - Fill torture T8 with the three conformance groups from section 3: width
    agreement via `font.measure(text.slice(s, e), scale)`, the TL-25 scale
    detector, and the format/flag-equality assertions.
  - The TL-25 detector fails on arrival. Land it as a failing-by-design case
    behind an explicit `known_failing` list that the harness prints and counts
    but does not use to exit 0 -- then remove it from the list in the same
    commit as the peer fix. A gate that is silently red is a gate nobody reads;
    a gate that is explicitly red with one named entry is a filed bug.
  - File the corresponding brief against lite-bmfont with the failing test
    attached. It is a one-term change in `drawWrapped`.
  - State in the roadmap and in T8's header what is NOT possible yet:
    lite-bmfont is v1.2.0; `layoutGlyphs` and range-aware `measure` are its
    Sessions 1 and 2 and are NOT shipped. `_measureRange` exists and is
    private; the suite does not call it. Do not plan against an API that does
    not exist.

INHERITED FROM TL2 (all four came out of TL2's reviewer and QA)

  - **BLOCKING, and it must land before any further edit to the `id === 10`
    branch: `makeCorpus` emits no `\r`.** Measured in TL2's QA: 250,000
    generated cases across 5 seeds, 42,635,887 characters, **zero** containing
    a CR. `oracle.mjs` has no CR handling at all, so `divergences=0` over
    50,000 cases says NOTHING about CRLF. The entire CRLF contract rests on 42
    hand-built (config x boxHeight) combinations in `t1-degenerate.mjs`.

    This is not hypothetical tidiness -- it is the hole that hid TL2's only
    blocker. TL2 shipped `crlfInRange`, a CORRECT detector, and pointed it at
    the non-truncating arm only; the truncating arm, which has entirely
    different width arithmetic (`safeW` versus `cursorX - crAdv`), carried the
    CR inside the emitted range on every truncating CRLF layout and the gate
    stayed green. A 42-point grid catches only what its author imagined. The
    oracle is the sole instrument in the suite that is independent of the
    subject, and CRLF currently has zero differential coverage.

    The fix is small and bounded: emit `\r\n` in place of some fraction of
    `makeCorpus`'s `\n`, add one condition to `oracle.mjs`, and 50,000 cases of
    search come free. Do it FIRST in TL3, before touching anything else.

  - `crlfInRange` (`harness.mjs:375`) reads `charCodeAt(j + 1)` at `j === e - 1`
    -- one past the range end. This is CORRECT and LOAD-BEARING: `charCodeAt`
    past the end returns NaN, `NaN !== 10`, so the last-character case cannot
    false-positive, and the bug it hunts is exactly a CR sitting AT the range
    end with its LF just outside. Narrowing the scan to `j + 1 < e` would blind
    the detector to the precise TL-13 signature and the whole 42-point sweep
    would pass vacuously. It is undocumented. **Add the comment** -- an
    apparent off-by-one with no explanation is one tidy-up away from silently
    converting the CRLF suite into a no-op.

  - `RULES` gates `maxMajor`, `maxPauseMs` and `maxArrayBuffersGrowth` but NOT
    `minor` or `source`. TL2's assertion 17 asserts `minor === 0` and
    `source === 'gc'`, and QA measured both by hand on all three lanes -- but
    the gate would not notice if either moved. Add `maxMinor` and pin `source`.

  - Adopt `briefs/TL3-boundary-tests.mjs` into `test/`. TL2's QA wrote 12
    boundary cases covering contract corners that were asserted in prose but
    not executable; they pass against 1.2.0 and were deliberately kept out of
    the shipped tree so as not to break TL2's verified freeze. `node:test`
    only, no imports outside the package. Moving them in raises `npm test`
    from 54 to 66.

HOT PATH
  No code in TextLayout.js changes under recommendation A. The diff is
  documentation, a devDependency, and a torture tier. Re-run T6 anyway --
  a session that claims to change no code and moves a number changed code.

ASSERTIONS
  - For every line of a 200-case corpus, `lineWidth` equals
    `font.measure(text.slice(startIdx, endIdx), scale)` within one f32 ulp,
    for `scale` in {0.5, 1, 2}.  The `slice` is test-only.
  - The truncated-line exception is asserted explicitly: on a FLAG_TRUNCATED
    line the difference between `lineWidth` and the measured content is
    exactly `3 * xadvance('.') * scale` (TL-12).
  - The TL-25 detector fails at scale 0.5 and 2 before the peer fix and passes
    after, with the same test body.
  - Stride is 4; slot order is asserted against the four reads in
    `drawWrapped`; `drawWrapped` compares `flags === 1` by equality, so
    FLAG_OVERFLOW is inert there.
  - The four documentation surfaces contain the same range sentences --
    enforced by a drift-guard test, not by review.
  - torture "ok" with T8 registered and its one known-failing entry named.

NON-GOALS
  No runtime dependency, in either direction, ever. No per-glyph API (law 2).
  No 0-bytes-per-frame end-to-end claim -- that is TL5 and it is blocked.

DONE WHEN
  the range semantics are identical in four places and guarded; the width
  agreement is gated in CI; TL-25 is either fixed in the peer or filed with a
  named failing test and a decision record
```

===============================================================================
# TL4 -- lite-text-layout v1.2.2 -- the README the suite actually specifies
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.2.2
status: shipped          # 2026-08-18 (v1.2.2); brief archived briefs/TL4-shipped.md
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: []
findings: [TL-17, TL-18, TL-22]
depends_on: [TL3]
---

# lite-text-layout -- the front page is not on the blueprint

PURPOSE
  CLAUDE.md names `LiteSepforge/README.md` as the blueprint every README is
  modelled on. This one is not: it has no positioning H2, no TOC, no "Why this
  exists", no "What you get", no core-surface deep dive, no constants table in
  the required shape, no Composability pipeline, no Zero-GC design notes with
  an allocation table, no "Design decisions worth knowing", no Testing
  section, no "What this is not", no Ecosystem. Its section headings are
  emoji, which is also half of TL-17.

WHY IT COMES LAST
  TL1, TL2 and TL3 all change the public surface: a new flag value, a new
  function, a set of doors that throw, and a corrected statement about scale.
  Writing the docs before them means writing them twice.

TASKS
  - Rebuild README.md on the LiteSepforge spine, in order: title plus one-line
    blockquote tagline; badges; the positioning H2 ("The word wrapper the
    bitmap-font ecosystem was missing") with inline install and a runnable
    quick-start; TOC; Why this exists; What you get; a `<details>` deep-dive on
    `computeWrap`; API reference with signatures and a constants table
    (FLAG_NORMAL 0, FLAG_TRUNCATED 1, FLAG_OVERFLOW 2, VERSION);
    Composability with the full end-to-end pipeline
    (atlas -> BitmapFont -> countLines -> computeWrap -> drawWrapped);
    a `<details>` Zero-GC design notes with the allocation table and the TL-20
    and TL-21 numbers, stamped with the version and machine they were measured
    on; Design decisions worth knowing; Testing; What this is not; Ecosystem;
    License.
  - "Design decisions worth knowing" carries the four that matter: the
    ownership boundary with lite-bmfont; FLAG_OVERFLOW as distinct from
    FLAG_TRUNCATED; indentation is preserved deliberately (TL-14); `lineWidth`
    is at the rendered scale and includes the ellipsis allowance (TL-12,
    TL-25).
  - "What this is not": no justification, no bidi/RTL, no hyphenation, no
    per-glyph advances. Link the Deferred section of this roadmap.
  - Testing section: `node --test`, the case count or the group names,
    `npm run torture`, and the `TEXTLAYOUT_TORTURE_BREAK=1` control. Never
    quote a number that goes stale every session without saying which version
    produced it.
  - Correct the README changelog to point at CHANGELOG.md rather than
    duplicating it (TL-18).
  - Same reconciliation for llms.txt. It is the file another package's
    pipeline reads when it needs this one's API; a stale llms.txt is how a
    sibling hallucinates a signature.
  - Re-run the ASCII sweep over the rewritten files. `->`, `<=`, `x`,
    "degrees", `...`.
  - Add a docs-drift guard to the test suite: every exported name in
    TextLayout.js appears in llms.txt and in the README API reference, and
    every name in the API reference exists at runtime. Both directions.

HOT PATH
  Zero code. `git diff TextLayout.js` is empty. Run the gate anyway.

ASSERTIONS
  - The README has every section of the blueprint spine, in the blueprint's
    order, verified section by section against LiteSepforge/README.md.
  - `LC_ALL=C grep -c '[^ -~\t]'` returns 0 for every file in `files[]`.
  - Grep for stray tool-call tags in every rewritten file before trusting it.
  - Every relative link in README and llms.txt resolves to a file in the repo.
  - Every runnable snippet in the README executes: the quick-start and the
    Composability pipeline are extracted and run in a test.
  - The drift guard passes in both directions and fails when a name is
    removed from either side.
  - Benchmark and allocation numbers carry a version and machine stamp.
  - node --test green; torture "ok".

NON-GOALS
  No behaviour change of any kind. This is a docs release and the diff must
  contain no logic.

DONE WHEN
  README, llms.txt, d.ts and code agree; the drift guard is in CI; every
  shipped file is ASCII
```

===============================================================================
# TL5 -- lite-text-layout v1.3.0 -- allocation-free rendering, end to end
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.3.0
status: shipped          # 2026-08-19 (v1.3.0); unblocked by bmfont 1.4.0 (measureLine) + 1.6.0 (F-45); TL-25 promoted, known-failing=0; brief archived briefs/TL5-shipped.md
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-bmfont"]
findings: [TL-25]
depends_on: [TL3, "lite-bmfont Session 2"]
---

# lite-text-layout -- close the loop when the peer can

STATUS: SHIPPED v1.3.0 (2026-08-19). The BLOCKED brief below is preserved as
  the historical record; the peer shipped the public range API (bmfont 1.4.0
  `measureLine`, 1.6.0 F-45), which discharged the block. The live brief is
  briefs/TL5-shipped.md.

  [HISTORICAL] STATUS: BLOCKED. DO NOT START.
  `@zakkster/lite-bmfont` is v1.2.0. Range-aware `measure`/`draw`/`layoutGlyphs`
  is its Session 2 and `layoutGlyphs` is its Session 1; NEITHER IS SHIPPED. Its
  `_measureRange(text, start, end, scale)` exists but is private, underscore-
  prefixed and free to change. This session opens when bmfont publishes the
  public range parameters, and not before. Planning against an API that does
  not exist is how a roadmap ages into fiction.

PURPOSE
  The whole point of reporting `[startIdx, endIdx)` into the original string is
  that a renderer never has to `slice()`. Until bmfont accepts a range on its
  public surface, every line of a wrapped paragraph costs one string allocation
  per line per frame at the consumer -- which means the allocation this package
  eliminated reappears one call downstream. TL3 proves the WIDTHS agree using a
  test-only slice. TL5 proves the PIPELINE allocates nothing.

WHAT TO DO IN THE MEANTIME
  Nothing in this package. TL3 already ships the executable width contract, and
  it is the honest half: a test may slice, a frame may not. The remaining work
  is entirely in the peer, it is filed as bmfont Session 2, and the correct
  action here is to leave this brief `status: blocked` and visible rather than
  to invent a shim. Specifically, do NOT ship a range-aware measure helper in
  this package to work around the wait -- that is a glyph-placement API wearing
  a convenience hat, and law 2 forbids it.

TASKS (when unblocked)
  - Swap T8's `font.measure(text.slice(s, e), scale)` for the range call.
  - Add a T6 lane: a full wrapped paragraph rendered line by line through the
    range API against a stub context, gated at maxMajor 0 / maxPauseMs 4 /
    maxArrayBuffersGrowth 0 with stabilize 'deep', plus `measureAllocs` with
    `maxBytesPerCall: 0` as the second witness.
  - Confirm the TL-25 scale fix is live in the shipped peer, not just in a
    branch, and delete the known-failing entry from the T8 header.
  - Bump the peer devDep floor to the version that ships the range API and say
    so in the CHANGELOG, so a consumer can reason about which pairs are
    allocation-free.

HOT PATH
  Still zero code in TextLayout.js. The pipeline gate measures the peer's hot
  path as much as this one; if it fails, the finding belongs to the peer and is
  filed there.

ASSERTIONS
  - Rendering a full wrapped paragraph line by line reports 0 bytes/frame under
    both the rate gate and the retention gate.
  - `draw(text, ..., s, e)` is pixel-identical to `draw(text.slice(s, e), ...)`
    for every line of the corpus.
  - The TL-25 detector passes at scale 0.5, 1 and 2 with no known-failing
    entries remaining.
  - torture "ok"; every control still exits non-zero.

NON-GOALS
  No per-glyph API here (law 2). No runtime dependency. No shim while blocked.

DONE WHEN
  a full wrapped paragraph lays out and renders at 0 bytes/frame, gated in CI,
  with no test-only slice anywhere in the measured path
```

---

## Deferred indefinitely

Each with the number that justifies the deferral, so nobody rediscovers them
as novel.

- **Layout reuse across frames (the old roadmap's Session 3).** Stays deferred,
  and now there is a number. `computeWrap` costs 0 bytes/op (TL-20) and the
  soft-break rescan is 1.14 to 1.33 glyph-table reads per character, not the
  quadratic blow-up a reader of the code might fear (TL-21). A dirty-flag or
  versioning helper would be convenience, not performance. The README's advice
  -- compute when the text changes, re-render free every frame -- is already
  the right pattern and already costs nothing. Ship only if a consumer is
  measurably spending time in `computeWrap`; at the driving consumer's volume
  (one banner, changing a few times a minute) it never will. **A session that
  "optimises" this linear pass is rejected by TL-21.**
- **Justification (full and inter-word).** No consumer. It needs per-space
  distribution in the output stride, which is a stride change, which is a
  breaking change in two packages (law 1).
- **Bidi and RTL.** Structurally out of scope. The package is ASCII bitmap
  oriented, matching lite-bmfont's 8-bit kerning LUT
  (`(first << 8) | second`), which is 2.0 territory with a different data
  structure in the peer.
- **Hyphenation.** Needs a dictionary. Not a zero-dependency feature.
- **Per-glyph advances in THIS package.** Explicitly rejected by law 2. It
  would duplicate bmfont's kerning LUT and give two packages two chances to
  disagree about where a glyph goes -- which is exactly what TL-25 is, on one
  single number, and TL-25 took reading the peer to find.
- **Unicode beyond ASCII 0-255.** Follows the peer. Non-ASCII ids contribute
  zero advance and reset the kerning context today, deliberately and
  documented; changing that is a 2.0 conversation in lite-bmfont first.

---

## 6. How to run it

In order. `status: planned -> shipped` after each `/release`. Author the brief
in the package, then `Use the planner subagent on BRIEF.md`, then coder,
reviewer, qa, then `/release`. Reviewer REJECTED goes back to coder, not
forward.

The budget frontmatter is identical in every brief and it never moves. This
package has exactly one identity -- a single linear pass that allocates nothing
and a four-slot format two packages can trust -- and TL-20 proves the first
half is true today. Every session's DONE WHEN is the same three commands:

```
node --test                              -> green
node --expose-gc test/torture.mjs        -> prints exactly "ok", exit 0
TEXTLAYOUT_TORTURE_BREAK=1 \
  node --expose-gc test/torture.mjs      -> exits non-zero
```

No gate output is a FAIL.

### If you only do a subset

1. **TL0 first, unconditionally.** Nothing else in this document can be
   verified without it. The package currently cannot run its own suite under
   the runner the suite law mandates (TL-16), and it has no gate at all
   (TL-19). Every later session's DONE WHEN is one command that does not exist
   yet. It is also the only session that costs nothing in risk: no behaviour
   changes.
2. **TL1 is the one that fixes silent data loss.** TL-01 is the highest
   severity finding here and the ratio is good: a caller who under-sizes a
   buffer today gets output that is byte-for-byte identical to a correct
   answer, and the fix is a flag value plus a second entry point. The old
   roadmap already named it Session 1 and was right.
3. **TL2 is the largest reduction in surprise per line changed.** Ten silent
   failures, one door, and the door is provably outside the loop. If you do
   TL1 without TL2, `countLines` inherits every one of them.
4. **TL3 pays for itself the moment you look at it.** It was scoped as a
   documentation session and reading the peer turned up TL-25, a live
   mis-alignment that the README's own example is constructed to hide. The
   cross-package tier is where the contract stops being a sentence.
5. **TL4 last, always.** Three sessions move the public surface; documenting
   it before they land means documenting it twice.
6. **TL5 not at all, yet.** It is blocked on a package this roadmap does not
   own. Leaving it visible and blocked is the point.

### The habit this roadmap is built around

Twenty-five of the twenty-seven findings in section 2 came from running the
code, and TL-26 came from the gate this roadmap specified rather than from a
hand probe -- which is the whole point of building it. The two that did not say so in the table, and both are the mildest things
in the document. TL-25 started as a reading of the *peer* rather than of this
package -- the same instinct pointed one repository sideways -- and was then
confirmed by execution, which is the order these things should go in.

The finding that should stay in front of the reviewer subagent is TL-20, and
it is unusual because it is good news. The zero-allocation claim is TRUE:
20,000 ops, major 0, minor 0, maxMs 0.000, arrayBuffers growth 0. A roadmap
that had not measured it would almost certainly have opened with a session to
"prove and improve the hot path", and that session would have been pure
invention -- churn on the one part of this package that already works, with a
real chance of making it worse. The measurement is what made the correct plan
visible: the hot body needs a *gate*, not a *fix*, and every byte of the work
belongs at the door instead.

TL-21 is the same lesson with the sign flipped. The soft-break rescan LOOKS
quadratic in the source -- `i = nextStart - 1` rewinds the loop counter, which
is exactly the shape a reviewer flags. Measured, it is 1.14 reads per character.
A session built on the reading would have restructured a correct linear pass to
solve a problem that does not exist.

So the question a reviewer asks of a proposed session is not "is this a real
improvement" -- it is "what number says so, and who ran it". And the question
asked of a test is not "does this test the feature" -- it is "would this test
fail if the feature were broken". TL-01 is the reason: a 3-line buffer and a
3-line text produce identical bytes, so any test that only checked the happy
buffer would have passed, green, over a hole, for as long as anyone cared to
look at it.

MIT (c) Zahary Shinikchiev

# TL6 -- lite-text-layout v1.4.0 -- decode the peer's 1/16 store (TL-28)
===============================================================================

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.4.0
status: shipped          # 2026-08-23 (v1.4.0). TL-28 closed by FEATURE DETECTION
                         # (typeof font.advanceOf === 'function' -> 0.0625 else 1),
                         # NOT the version-gating the brief floated: FORMAT_VERSION
                         # is a bmfont MODULE export, unreachable on the font
                         # instance, so a handshake was impossible. Fold matches
                         # bmfont _measureRange (s16 = scale*0.0625) to the ULP.
                         # bmfont devDep ^1.6.0 -> ^2.0.1; real 2.x fixtures; A1-A6
                         # proven by applied sandbox mutation. Sibling finding: a
                         # checked 2.x drawWrapped now THROWS on FLAG_OVERFLOW
                         # (F-49), pinned in T8 s4, amended in decisions/0001.
                         # Live brief: briefs/TL6.md.
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-bmfont"]
findings: [TL-28]
depends_on: []
---
```

THE LIVE BRIEF IS `briefs/TL6.md`. Read it before starting; the summary below
exists so this roadmap stays self-describing, not as a substitute for it.

PURPOSE
  bmfont 2.0.0 moved the advance and kerning stores to 1/16 fixed point. This
  package still reads them raw, so against any bmfont >= 2.0.0 font every width
  is EXACTLY 16x too large and wrap collapses silently -- a 306-char paragraph
  at boxWidth 560 becomes 97 lines instead of 7. Measured 2026-08-22 against
  bmfont 2.0.2: a 10-glyph string at xadvance 10 gives bmfont.measure 100 and
  this package 1600. Six read sites: TextLayout.js:341, :377/:380, :442/:443,
  :515, :661/:662, :697.

WHY IT WAS INVISIBLE
  This repo pins bmfont ^1.6.0, so bmfixture.mjs builds a REAL BitmapFont in the
  pre-2.0 whole-pixel format and the cross-package tier passes. The peer's own
  boundary guard (LiteBmfont/test/packaging.test.js:441) pins THIS repo's
  installed bmfont below 2.0.0 and is green and honest. Neither repo is wrong
  internally; the defect exists only in the gap, where both packages are live
  on npm and both READMEs advertise the pairing. Found from the bmfont side by
  USING the pairing to build a compound demo. Filed there as F-56.

FIX SHAPE
  Feature-detect ONCE at entry, outside the loop:
  `const advScale = (typeof font.advanceOf === 'function') ? 0.0625 : 1;`
  and multiply all six reads by it. FORMAT_VERSION is NOT usable -- it is a
  module export of bmfont, not an instance property, so a font.FORMAT_VERSION
  check reads undefined forever. Verified: bmfont 1.6.0 has zero occurrences of
  advanceOf / kernOf / GLYPH_ADVANCE_SCALE; 2.x has all three.

FIRST TASK IS THE RED TEST
  Bump the devDep to ^2.0.1 and install. T8 and the T6 lane-4 pipeline lane are
  PREDICTED to redden immediately (predicted by the filer, not verified -- the
  filer did not modify this repo's node_modules). If they do NOT redden, STOP:
  the cross-package tier is not reading the peer's format and TL-28's blast
  radius is larger than filed.
