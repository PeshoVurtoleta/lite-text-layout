---
package: "@zakkster/lite-text-layout"
version_target: 1.2.2
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-bmfont"]
findings: [TL-17, TL-18, TL-22]
stamps: [TL-20, TL-21]
depends_on: [TL3]
blocks: [TL5]
---

# TL4 -- lite-text-layout v1.2.2 -- the front page is not on the blueprint

## PURPOSE

CLAUDE.md names `LiteSepforge/README.md` as the blueprint every README is
modelled on. This one is not on it (TL-22), and its changelog is a stale copy of
a file that now exists (TL-18). This is the last shippable session in the
lite-text-layout roadmap -- TL5 is blocked on bmfont's range API -- so it is
where the public surface stops moving and the documentation is made to match the
code that three prior sessions changed underneath it.

Three sessions moved the surface: TL1 added `FLAG_OVERFLOW` and `countLines`,
TL2 added `TextLayoutError` and the input door, TL3 pinned the range contract
and filed the scale finding. The README was patched along the way but never
rebuilt, so it documents the right behaviour in the wrong shape.

## CURRENT STATE -- VERIFIED, because the roadmap's assessment predates TL0-TL3

Do not trust the roadmap's section-0 numbers ("126 non-ASCII lines", "three
version numbers disagree"). TL0-TL3 changed the ground. Measured this session:

  - **ASCII: already clean.** `LC_ALL=C grep -cP '[^\x00-\x7F]'` returns 0 for
    `README.md`, `llms.txt`, `TextLayout.js`, `TextLayout.d.ts`. TL-17's
    heading-emoji and non-ASCII punctuation were removed across TL0-TL3. TL4
    does NOT fix 126 lines; it RE-VERIFIES 0 after the rewrite. If the rewrite
    reintroduces a smart quote or an em dash, that is a new regression, not a
    surviving finding.
  - **Version export + CHANGELOG: exist.** `VERSION` is exported (1.2.1),
    `CHANGELOG.md` is the source of truth. The `VERSION`-missing half of TL-18
    is closed.
  - **The LIVE remnant of TL-18 is DUPLICATION, and it has already rotted.**
    `README.md:289-297` carries `### 1.2.0 / 1.1.0 / 1.0.0` -- missing 1.0.2 AND
    1.2.1. `llms.txt:297-311` carries `### 1.2.0 / 1.1.0 / 1.0.2 / 1.0.0` --
    missing 1.2.1. Two hand-maintained copies of CHANGELOG.md, each stale in a
    different way. This is the exact failure a single source of truth prevents.
  - **The README is off-spine (TL-22).** Current headings: What is / Install /
    Quick Start / Why a separate package? / Layout buffer format / Range
    contract / Wrapping rules / Truncation / API / Benchmark / TypeScript /
    LLM-Friendly Documentation / Changelog / License. Against the blueprint it
    is missing: the one-line blockquote tagline, badges, the positioning H2, the
    TOC, "Why this exists", "What you get", the `<details>` core-surface deep
    dive, a constants table in the required shape, "Composability" with a full
    end-to-end pipeline, the `<details>` Zero-GC design notes with an allocation
    table, "Design decisions worth knowing", "Testing", "What this is not", and
    "Ecosystem".

## THE LOAD-BEARING CONSTRAINT -- do not break TL3's drift guard

`test/TextLayout.drift.test.js` pins a `RANGE-CONTRACT v1 ... END RANGE-CONTRACT`
sentinel block byte-identical across FOUR surfaces. Two of them are rewritten
this session:

  - `README.md:124-129` (inside the range-contract section)
  - `llms.txt:182-187`

The block's four sentences, and the sentinels, MUST survive the rewrite
BYTE-IDENTICAL. A README rebuild that rewords, reflows, or relocates the
range-contract sentences fails the drift guard instantly -- which is the guard
doing its job. Move the block wherever the new spine puts it, but copy it
verbatim, sentinels included, and let `npm test` confirm it still extracts to
the same four sentences. The canonical text is pinned in the drift test's
`CANONICAL` constant; that is the authority.

## THE BLUEPRINT SPINE (from LiteSepforge/README.md, in order)

Rebuild `README.md` to this spine, adapting each domain-specific section to
word-wrapping:

  1. `# @zakkster/lite-text-layout`
  2. `> ` one-line blockquote tagline (one sentence, what it is).
  3. badges (npm version, license, zero-deps, bundle size -- static shields, no
     external fetch at read time; match the blueprint's badge style).
  4. `## The word wrapper the bitmap-font ecosystem was missing` -- the
     positioning H2, with inline `npm i` and a runnable quick-start.
  5. `## Table of contents`
  6. `## Why this exists`
  7. `## What you get`
  8. A `<details>` core-surface deep-dive on `computeWrap` (blueprint's "AM vs
     FM vs separate" analog: the one function that does the work, opened up).
  9. `## API reference` -- `computeWrap`, `countLines`, `TextLayoutError`, and a
     constants table (FLAG_NORMAL 0, FLAG_TRUNCATED 1, FLAG_OVERFLOW 2, VERSION).
 10. The output-buffer/range contract (blueprint's "Pixel format contract"
     analog). THE RANGE-CONTRACT SENTINEL BLOCK LIVES HERE -- verbatim.
 11. `## Composability with the ecosystem` -- the full end-to-end pipeline:
     atlas -> `new BitmapFont` -> `countLines` -> `computeWrap` -> `drawWrapped`.
 12. A `<details>` `## Zero-GC design notes` -- the allocation table and the
     TL-20 / TL-21 numbers, each stamped with the version and machine that
     produced them.
 13. `## Benchmarks`
 14. `## Design decisions worth knowing`
 15. `## Testing`
 16. `## What this is not`
 17. `## Ecosystem`
 18. `## License`

## WHY IT COMES LAST

TL1, TL2 and TL3 all moved the public surface: a new flag value, a new function,
a set of doors that throw, a pinned range contract and a filed scale finding.
Documenting before they land means documenting twice. They have landed. The
surface is frozen (TL5 is blocked and adds nothing here), so the docs can be
written once against a surface that will not move under them.

## PRE-FLIGHT (verify, do not trust this document on faith)

1. `node -p "require('./package.json').version"` is `1.2.1`; `npm view
   @zakkster/lite-text-layout version` is `1.2.1`. TL3 is shipped.
2. `node --expose-gc test/torture.mjs` prints `ok`, exit 0, `known-failing=1
   todo=1`; `npm test` is 68/0. This is the baseline TL4 must not regress.
3. `grep -rn "RANGE-CONTRACT" README.md llms.txt` shows the sentinel block in
   both. Copy the four sentences out BEFORE you start rewriting, so you can
   paste them back verbatim.
4. Read `LiteSepforge/README.md` end to end. It is the shape, not the words.
5. Confirm bmfont is a devDependency (TL3 added it) -- the Composability
   pipeline and its runnable-snippet test need `new BitmapFont` at test time.
   Still zero RUNTIME dependencies.

## TASKS

### Phase A -- rebuild README.md on the blueprint spine

Rebuild the whole file to the 18-section spine above. PRESERVE the correctness
TL1-TL3 fought for -- do not paraphrase the door, the flags, the CRLF rule, or
the range contract into something subtly weaker. Concretely:

  - Keep the range-contract sentinel block byte-identical (the drift guard is
    the check).
  - The constants table states FLAG_* as a VALUE SPACE (compare by equality,
    never truthiness -- Law 6), matching the code and llms.txt.
  - "Design decisions worth knowing" carries exactly four: the ownership
    boundary with lite-bmfont (this package lays out, bmfont draws); FLAG_OVERFLOW
    (buffer too small, a caller bug) as distinct from FLAG_TRUNCATED (text too
    big for the box); indentation is preserved deliberately (TL-14, leading
    whitespace is content, skipped only after a soft break); `lineWidth` is at
    the rendered scale and includes the ellipsis allowance on a truncated line
    (TL-12), and the cross-package scale note (TL-25, filed against bmfont).
  - "What this is not": no justification, no bidi/RTL, no hyphenation, no
    per-glyph advances (law 2). Link the Deferred section of ROADMAP.md.

### Phase B -- kill the changelog duplication (TL-18)

Single source of truth. Replace the duplicated `### x.y.z` blocks in BOTH
`README.md` and `llms.txt` with a one-line pointer to `CHANGELOG.md`. Neither
file carries version-by-version history after this. Rationale in the commit and
in a one-line note: two hand-maintained copies both went stale (README missing
1.0.2 and 1.2.1; llms.txt missing 1.2.1), which is the finding, not an accident.

### Phase C -- the docs-drift guard (new test, BARRIER: prove it bites)

Add `test/TextLayout.docsdrift.test.js` (node:test + node:fs only). It asserts,
in BOTH directions:

  - Every runtime export appears in the README API reference AND in llms.txt.
    The runtime surface is: the six module exports `FLAG_NORMAL`,
    `FLAG_TRUNCATED`, `FLAG_OVERFLOW`, `TextLayout`, `TextLayoutError`,
    `VERSION`, PLUS the two methods on the `TextLayout` namespace object,
    `computeWrap` and `countLines`. Read them from the module at runtime
    (`import` + `Object.keys` + `Object.keys(TextLayout)`), never a hardcoded
    list -- a hardcoded list is a third copy that drifts.
  - Every API-name the README reference and llms.txt document exists at runtime.
    Parse the documented names out of the API sections and assert each resolves.

Prove it bites two ways, watched, then revert: (a) remove one export's mention
from the README -> the export->docs direction fails naming that export; (b) add
a fictional `TextLayout.reflow` to the README API reference -> the
docs->runtime direction fails naming `reflow`. A guard you did not watch go red
is not a guard (the TL3 lesson).

### Phase D -- runnable snippets (BARRIER: they must actually execute)

Add `test/TextLayout.snippets.test.js` (node:test). Extract the quick-start and
the Composability pipeline from the README and RUN them, so a copied example
cannot silently rot.

  - THE HEADLESS CONSTRAINT: `drawWrapped` needs a canvas 2D context
    (`ctx.drawImage`), which does not exist under `node --test`. This package's
    OWN surface -- `computeWrap` / `countLines` over a `BitmapFont` -- runs
    headless and is what the test executes and asserts (line count, flags,
    widths). The `drawWrapped` line is bmfont's surface, not this package's;
    run it against a minimal recording `ctx` stub (an object whose `drawImage`
    pushes to an array) so the pipeline executes end to end without a DOM, and
    assert the stub received the expected number of blits. State this boundary
    in a comment: the snippet test proves THIS package's calls run and that the
    pipeline WIRES UP, not that a real canvas renders pixels (that is bmfont's
    test).
  - The extraction must be mechanical (fenced ```js blocks tagged for
    extraction, or a stable marker), so editing the README prose cannot
    desynchronise the test from the shown code.

### Phase E -- stamp, sweep, verify

  - Stamp the TL-20 and TL-21 numbers with the version and machine that produced
    them. RE-MEASURE them this session rather than copying S0's numbers; a
    benchmark with no provenance is a benchmark that lies after the next laptop.
    TL-20: 20,000 ops of `computeWrap` over the 360-char paragraph into a reused
    `Float32Array(256)` -> verdict pass, major 0, minor 0, source gc. TL-21: the
    soft-break rescan cost in glyph-table reads per character (was 1.14 at 550
    lines, 1.33 at 6,000 chars) -- re-measure and stamp.
  - ASCII sweep: `LC_ALL=C grep -cP '[^\x00-\x7F]'` returns 0 for every file in
    `files[]` (README.md, llms.txt, TextLayout.js, TextLayout.d.ts, CHANGELOG.md,
    package.json, LICENSE.txt). Use `->`, `<=`, `x`, "degrees", `...`.
  - Stray tool-call-tag sweep on every rewritten file before trusting it.
  - Every relative link in README and llms.txt resolves to a file in the repo.

## HOT PATH

Zero code. `git diff TextLayout.js` is EMPTY this session (unlike TL3, which
touched the docstring -- TL4 does not). Run the full gate anyway: a docs session
that moves no code still adds tests, and a new test that allocates in a measured
window, or an extraction harness that imports the module wrong, can move a
number. Confirm the T6 lanes read major 0 / minor 0 / source gc / arrayBuffers 0
exactly as TL3 left them, and `shasum -a 256 TextLayout.js` is unchanged from
TL3's `955f42d9...`.

## ASSERTIONS

  1. The README carries every section of the blueprint spine, in the
     blueprint's order, verified section by section against
     `LiteSepforge/README.md`.
  2. `LC_ALL=C grep -cP '[^\x00-\x7F]'` returns 0 for every file in `files[]`.
  3. No stray tool-call tags in any rewritten file.
  4. Every relative link in README and llms.txt resolves to a repo file.
  5. TL3's drift guard still passes -- the range-contract block survived the
     rewrite byte-identical (mutate one sentence -> it fails; revert).
  6. The docs-drift guard passes both directions and fails when a name is
     removed from either side (both mutations watched).
  7. The quick-start and Composability snippets execute: the extracted
     computeWrap/countLines calls run and assert their output; the pipeline
     wires through a recording ctx stub.
  8. README and llms.txt carry NO version-by-version changelog -- both point to
     CHANGELOG.md. `grep -n "^### 1\." README.md llms.txt` returns nothing.
  9. Benchmark and allocation numbers each carry a version and machine stamp.
 10. `node --test` green at the new count; `node --expose-gc test/torture.mjs`
     -> `ok`, exit 0, `known-failing=1 todo=1`; `TEXTLAYOUT_TORTURE_BREAK=1`
     exits non-zero.
 11. `TextLayout.js` sha unchanged from TL3 (`955f42d9...`); `git diff
     TextLayout.js` empty.
 12. `npm pack --dry-run` still 7 files (new tests do not ship); llms.txt and
     CHANGELOG.md present.

## NON-GOALS

No behaviour change of any kind. The diff contains no logic -- only Markdown,
llms.txt, and new node:test files. No new export, no signature change. No TL5
work (allocation-free end-to-end rendering is blocked on bmfont's range API and
adds nothing documentable here yet). Do not re-open the range-contract wording
(it is pinned; changing it is a drift-guard failure by construction).

## RISKS AND THEIR CHECKS

  - **The rewrite silently breaks the range-contract block.** Check: `npm test`
    runs the TL3 drift guard; it fails the instant a sentence or sentinel
    changes. Copy the four sentences out before starting (PRE-FLIGHT 3).
  - **The Composability snippet cannot run headless.** Check: Phase D scopes the
    executed region to this package's calls and stubs `ctx` for the drawWrapped
    line. If the snippet as written cannot run even with a ctx stub, the snippet
    is wrong (it shows an API that does not compose) -- fix the snippet, not the
    test.
  - **The docs-drift guard passes vacuously** (e.g. it greps for a name that
    also appears in prose, so removal elsewhere still "passes"). Check: the
    two-direction mutations in Phase C must be watched red; extract names from a
    delimited API-reference region, not the whole file.
  - **A benchmark number goes stale the next session.** Check: assertion 9 --
    every number carries a version+machine stamp, so a reader knows what
    produced it and a future session knows to re-measure.
  - **The changelog pointer loses information a sibling needed.** Check: llms.txt
    keeps the full API surface (its job); only the version-history duplication
    is removed. A sibling reads llms.txt for signatures, not for a changelog.

## DONE WHEN

README, llms.txt, `TextLayout.d.ts` and the code agree; the README is on the
blueprint spine section for section; both drift guards (range-contract and
docs-name) are in CI and proven to bite; the runnable snippets execute; every
shipped file is ASCII; README and llms.txt point to CHANGELOG.md instead of
duplicating it; `TextLayout.js` is byte-unchanged; the gate is green.
