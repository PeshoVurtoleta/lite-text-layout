---
package: "@zakkster/lite-text-layout"
version_target: 1.2.1
status: shipped
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-bmfont"]
findings: [TL-12, TL-14, TL-25, TL-28]
inherited_from_TL2: [CRLF-oracle-gap, crlfInRange-comment, RULES-maxMinor-source, adopt-boundary-tests]
depends_on: [TL2]
blocks: [TL4, TL5]
---

# TL3 -- lite-text-layout v1.2.1 -- the range contract, made executable

## PURPOSE

The output format is already right. `[startIdx, endIdx]` are indices into the
ORIGINAL string, `endIdx` exclusive, deliberately, so a consumer never has to
`slice()`. `lineWidth` is at the RENDERED scale and includes the ellipsis
allowance on a truncated line. None of that changes here.

What is missing is any EXECUTABLE agreement that the two packages sharing this
buffer read it the same way. TL3 makes the contract falsifiable across the
package boundary and closes the one hole in the instrument that let TL2's only
blocker through. In the gap between the two packages three separate vacuities
are sitting, and each is the same shape: a claim that is true today only
because no test exercises the input that would break it.

  - **TL-25** -- `computeWrap` and `drawWrapped` disagree about what `lineWidth`
    means. `computeWrap` already multiplies every advance by `scale`;
    `drawWrapped` then aligns with `boxWidth - lineWidth * scale`
    (`BitmapFont.js:479-480`) under a comment asserting "`lineWidth` is at
    scale=1 per contract" (`:476`). Verified live against the CURRENTLY
    INSTALLED peer this session:

    ```
    computeWrap('AAAA BBBB', F, 0,0,16, out, s):  lineWidth 51 / 102 / 204   at s = 0.5 / 1 / 2
    drawWrapped then uses lineWidth * s:                     25.5 / 102 / 408
    ```

    Two packages, one number, two beliefs -- exactly the failure the FORMAT
    contract exists to prevent. The README's own Full Example passes `1` to
    both, which is precisely why nobody has seen it.

  - **TL-28 (NEW, found this session)** -- the two packages disagree about
    KERNING ACROSS A NON-ASCII GAP. `computeWrap` RESETS the kerning context on
    any id >= 256 (documented: "chars with id >= 256 contribute zero advance
    and reset the kerning context"). bmfont's `_measureRange`/`draw`/
    `drawWrapped` do NOT reset -- an out-of-range id is skipped and `prevId` is
    left intact, so kerning bridges the gap. Verified:

    ```
    text 'A\u20ACB', kern(A,B) = -5:
      computeWrap lineWidth      -> 24    (A + B, no kern; context reset by the U+20AC EURO)
      font.measure(slice, 1)     -> 19    (A + B - 5; kern bridges the U+20AC EURO)
    ```

    The width-agreement assertion this session ships (`lineWidth ===
    font.measure(text.slice(s,e), scale)`) is therefore FALSE on any line with
    a non-ASCII char adjacent to a kerning pair -- and VACUOUSLY true on the
    TL2 corpus, whose `GLYPH_IDS` are ASCII letters only (`harness.mjs:96-99`).
    This is the F-24 vacuity shape on the layout/measure seam. It must be
    DECIDED, in writing, before the assertion is trusted -- see the exception
    section below.

  - **CRLF differential coverage is zero.** This is TL2's inherited blocker and
    it is why the ordering below puts it first. TL2 shipped `crlfInRange`, a
    CORRECT detector, and pointed it at the non-truncating newline arm only;
    the truncating arm carried the CR inside the emitted range on every
    truncating CRLF layout and the T5 gate stayed green -- because
    `makeCorpus` emits no `\r` at all (measured in TL2's QA: 42,635,887
    characters, zero CRs) and `oracle.mjs` has no CR handling. The 42-point
    hand-built grid in `t1-degenerate.mjs` is the ENTIRE CRLF contract, and a
    hand-built grid catches only what its author imagined. A grid is what
    missed the blocker.

This is a two-package contract in the same spirit as the lite-bvh / lite-aabb
FORMAT agreement: no dependency edge, a shared definition, and a test that
proves it. `@zakkster/lite-bmfont` enters as a **test-only devDependency**.
Zero runtime dependencies, both directions, forever.

## WHY THESE TOGETHER

They are one theme: **a contract stated in prose is a contract nobody runs.**
TL-12 and TL-14 are sentences that live in four files and could drift apart
tomorrow. TL-25 and TL-28 are cross-package beliefs that no test compares. The
CRLF gap is an oracle that cannot see the character the contract is about. Every
one of them is closed the same way -- by an instrument that fails when the
claim is false -- and building those instruments one at a time means building
the same devDependency and the same corpus five times.

The CRLF fix comes FIRST and alone, because until the oracle can see a CR, the
50,000-case differential tier is blind to the exact class of bug TL2 shipped
and caught by hand. Everything else in this session leans on a corpus that
exercises the character.

## PRE-FLIGHT (verify state; do not trust this document's numbers on faith)

1. `git log --oneline -1` is the 1.2.0 release commit; `node -p
   "require('./package.json').version"` is `1.2.0`; `npm view
   @zakkster/lite-text-layout version` is `1.2.0`. TL2 is shipped and this
   branch is clean.

2. **The roadmap's TL3 block says the peer is v1.2.0. It is not -- the
   installed peer is v1.2.3.** Do not plan against the roadmap's stale version
   line; read the peer. What matters is unchanged: `_measureRange` is still
   private and underscore-prefixed (`BitmapFont.js:157`); `measure` /
   `hasGlyph` / `draw` / `drawWrapped` are the only public width-and-render
   surface; a range-aware public `measure` and `layoutGlyphs` are still bmfont
   Sessions M5/M6 and are NOT shipped. The `slice()` in the width assertion is
   test-only and stays test-only until bmfont ships the range API (TL5).

3. **Confirm TL-25 still reproduces** against the installed peer before writing
   a line of the detector: the `51 / 102 / 204` vs `25.5 / 102 / 408` split
   above was measured this session against 1.2.3, and `drawWrapped`'s
   `lineWidth * scale` is still at `BitmapFont.js:479-480`. If the peer has
   already dropped the `* scale`, TL-25 is fixed upstream and this session
   files nothing -- re-derive, do not assume.

4. **Confirm TL-28** with the `A\u20ACB` probe above. If it does not
   reproduce, the peer changed its non-ASCII policy and the exception section
   is moot -- re-derive.

5. `node --expose-gc test/torture.mjs` prints `ok`, exit 0, `known-failing=0
   todo=2`. The two survivors are TL-25 and control-6, both owned by THIS
   session. TL3 turns `todo=2` into `known-failing=1 todo=1` (the TL-25
   detector becomes a named, counted, non-exiting known-failing entry; the
   scale-invariance control-6 becomes live), and then into `known-failing=0`
   in the same commit as the peer fix -- NOT in this session.

## THE DECISION -- record decisions/0003-scale-contract.md BEFORE any code

One of the two packages is wrong about `lineWidth`, and they must be told apart
in writing before either is touched.

  **A. `lineWidth` is at the RENDERED scale** (what this package does).
  `drawWrapped` drops its `* scale` on the two alignment terms. Cheapest;
  matches the code that produced every layout buffer ever shipped by this
  package; the fix is one term in the peer and zero here.

  **B. `lineWidth` is at scale 1** (what bmfont's comment claims). This package
  stops scaling the stored width -- but it still must scale internally for the
  wrap comparisons, so it would divide back out: a division per line for the
  benefit of a comment. Bad trade.

**Recommendation: A.** It is what the data already says, it needs no change in
this package, and it makes the peer's own comment true instead of aspirational.
This package's whole job in TL3 is to make the claim EXECUTABLE and to file the
one-term peer change with a failing test attached. Record the promotion
mechanism explicitly: TL-25 closes in bmfont, not here; TL3 ships the detector
that will flip green when it does.

## THE ORDER

Barriers are hard stops. A later phase does not begin until the barrier's
two-direction control has fired: break the mechanism -> non-zero, restore ->
zero. "Green" is not evidence until you have watched it go red on purpose.

### Phase A -- teach the instrument to see a CR (BARRIER 1, the inherited blocker)

This lands FIRST and ALONE, before the decision record, before bmfont, before
one word of range prose. It is the hole that hid the last blocker.

  1. **Oracle.** `oracleWrap` (`oracle.mjs:144`) flushes a paragraph at every
     `\n`, ending it at `j` (exclusive). Add ONE condition: when
     `text.charCodeAt(j) === 10 && text.charCodeAt(j - 1) === 13 && j - 1 >=
     pStart`, the paragraph ends at `j - 1`, not `j` -- so the CR is excluded
     from the emitted range, exactly as the subject excludes it. Nothing else
     in the oracle changes; a lone `\r` (no following `\n`) stays inside the
     range in both, which is the contract.

  2. **Corpus.** `makeCorpus` (`harness.mjs:155`) joins with `'\n'`. Replace a
     fraction -- roughly 1 in 3 of the emitted newlines -- with `'\r\n'`, keyed
     off `prng`, so a meaningful share of the 50,000 T5 cases now carry a CR
     immediately before an LF, at both `boxHeight === 0` (non-truncating arm)
     and `boxHeight > 0` (truncating arm). The truncating arm is the one that
     shipped broken; it MUST be exercised.

  3. **The two-direction proof, and it must be watched go red:**
     - **Corpus without the oracle fix** -> T5 `divergences > 0`. This is the
       corpus now exercising CR against an oracle that still carries it: proof
       the character reaches the differential comparator at all. (If this stays
       0, the corpus is not actually emitting CRLF -- stop and fix the corpus,
       the rest of the tier is decorative until it bites.)
     - **Both fixes in** -> T5 `divergences === 0`. CRLF now lays out
       identically to LF under a real zero-advance atlas, across both arms, and
       the oracle agrees.
     - **Re-break the SUBJECT** (delete the CR exclusion on the truncating arm,
       `TextLayout.js:399` region) with both instruments correct -> `divergences
       > 0` at a truncating CRLF case. This is the control that proves the new
       coverage would have caught last session's blocker. Land it as T9
       control 13 and leave it wired.

  4. **Do NOT touch the `id === 10` branch of `TextLayout.js` for any reason
     other than the control in (3).** The source is frozen at sha
     `2d198b7a...`; this phase changes the TEST harness, not the subject. If a
     genuine subject bug surfaces, it is a new finding with its own barrier,
     not a quiet edit.

### Phase B -- the decision record (BARRIER 2)

Write `decisions/0003-scale-contract.md` per THE DECISION above: the fork, the
measured `51/102/204` vs `25.5/102/408` evidence, recommendation A, and the
explicit statement that TL-25 closes in the peer. No detector is written until
this file exists -- a red gate with no adjudication behind it is a bug report
with no bug filed.

### Phase C -- the range sentences, in four places, guarded (TL-12, TL-14)

Write the range semantics ONCE, in the SAME words, in the source docstring,
`TextLayout.d.ts`, `llms.txt`, and `README.md`:

  - `startIdx` inclusive, `endIdx` exclusive, both indices into the ORIGINAL
    string.
  - The breaking space is excluded from both sides.
  - Leading whitespace is skipped only AFTER a soft break (TL-14's corrected
    sentence -- it is CONTENT at text start and after an explicit `\n`).
  - `lineWidth` is at the RENDERED scale and INCLUDES the ellipsis allowance on
    a FLAG_TRUNCATED line (TL-12).

Enforce sameness with a **drift-guard test**, not review: extract the canonical
sentence block from each of the four surfaces and assert byte-identity. A
human comparing four files by eye is how three version numbers disagreed in
TL0.

### Phase D -- torture T8, the cross-package tier

`t8-cross.mjs` is registered but empty (TL2 left it as a stub). Fill it, with
bmfont added as a **test-only devDependency** (`devDependencies`, never
`dependencies`; `npm pack` still ships 7 files, verify).

  1. **Width agreement, SCOPED.** For every line of a wrapped corpus,
     `lineWidth === font.measure(text.slice(startIdx, endIdx), scale)` within
     one f32 ulp, for `scale` in `{0.5, 1, 2}`. **The corpus for this
     assertion is ASCII-only by decision (TL-28)** -- state that in the tier
     header as a scoping decision, not an accident, and cite
     `decisions/0004`. See the exception section: a non-ASCII line is where the
     two packages legitimately disagree and it does not belong in a
     they-must-agree assertion.

  2. **The truncated-line exception, explicit.** On a FLAG_TRUNCATED line the
     difference between `lineWidth` and the measured content is exactly
     `3 * xadvance('.') * scale` (TL-12). Assert the literal, not an inequality.

  3. **TL-25 detector, failing by design.** Assert `computeWrap(..., scale)`
     and `drawWrapped(..., scale)` agree on the meaning of `lineWidth` for
     `scale` in `{0.5, 1, 2}`. This FAILS today at `0.5` and `2`. Register it
     behind an explicit `knownFailing('TL-25', ...)` entry that the harness
     PRINTS and COUNTS but does not use to exit non-zero. `known-failing=1`.
     Remove it from the list in the same commit as the peer fix -- not here. A
     silently-red gate is a gate nobody reads; a gate red with one named entry
     is a filed bug.

  4. **Format conformance.** Stride is 4; slot order is
     `[startIdx, endIdx, lineWidth, flags]`, asserted against the four reads in
     `drawWrapped`; `drawWrapped` compares `flags === 1` by equality
     (verify the current line -- it moved to `BitmapFont.js` near the ellipsis
     block), which is what makes `FLAG_OVERFLOW = 2` inert there and additive
     rather than breaking.

  5. **NOT YET, stated in the tier header, not silently omitted:** a
     `FORMAT_VERSION` handshake asserted from both repos is bmfont's M9
     (v2.0.0) and is not shipped; range-aware public `measure` and
     `layoutGlyphs` are M5/M6. The 0-bytes-per-frame end-to-end claim is TL5
     and is BLOCKED. Do not plan against an API that does not exist.

### Phase E -- widen the instruments (the three remaining TL2 inheritances)

  1. **`crlfInRange` comment.** `harness.mjs:369-379` reads `charCodeAt(j + 1)`
     at `j === e - 1`, one past the range end. This is CORRECT and
     LOAD-BEARING: `charCodeAt` past the end is NaN, `NaN !== 10`, so the
     last-character case cannot false-positive, and the bug it hunts is exactly
     a CR at the range end with its LF just outside. Add the comment. An
     apparent off-by-one with no explanation is one tidy-up away from turning
     the whole CRLF sweep into a no-op.

  2. **`RULES` gains `maxMinor` and pins `source`.** `harness.mjs:51` gates
     `maxMajor`, `maxPauseMs`, `maxArrayBuffersGrowth` but not `minor` or
     `source`. TL2 asserted `minor === 0` and `source === 'gc'` by hand on all
     three lanes; the gate would not notice if either moved. Add `maxMinor: 0`
     and pin `source: 'gc'`. Prove it can fail: a lane that triggers a scavenge
     must redden the gate.

  3. **Adopt `briefs/TL3-boundary-tests.mjs` into `test/`.** TL2's QA wrote 12
     boundary cases covering contract corners asserted in prose but not
     executable; they pass against 1.2.0 and were kept out of the shipped tree
     to protect TL2's verified freeze. `node:test` only, no imports outside the
     package. Moving them in raises `npm test` from 54 to 66. Verify all 66
     pass before proceeding.

### Phase F -- file the peer change, then release

  - File a brief against `@zakkster/lite-bmfont` for the one-term `drawWrapped`
    alignment fix (drop `* scale` on the two alignment terms under decision A),
    with the TL-25 detector body attached as the failing test. It is a minor
    bump there, with a decision record on the bmfont side.
  - Re-run the full gate. `/release 1.2.1`.

## TL-28 -- THE EXCEPTION, CARVED ON PURPOSE (decisions/0004-nonascii-kerning-seam.md)

Like TL-26 in TL2, this is a place where the honest contract is "these two
packages do NOT agree here, and that is defined behaviour, not a bug." Write it
down rather than papering it with a corpus that hides it.

The fork:

  A. **SCOPE the width-agreement assertion to ASCII ranges** (recommended).
     `computeWrap` resets the kerning context on id >= 256; bmfont's measure
     bridges it. Both are internally consistent and documented in their own
     package. They produce the same number on any ASCII line, which is every
     line a bitmap-font tool is for. State the scope in the T8 tier header and
     in the decision record, keep `GLYPH_IDS` ASCII, and note that a non-ASCII
     line is out of the agreement's domain -- not that the packages are wrong.

  B. **Reconcile the two packages on non-ASCII kerning-reset.** This means
     deciding which package changes its documented behaviour -- a semantic
     change to a shipped, tested contract on ONE side, smuggled into a
     documentation session on the OTHER. Wrong venue. If reconciliation is
     wanted it is a bmfont finding (the F-24 family already lives there) with
     its own decision record and its own release, not a TL3 side effect.

  Recommendation: **A now, file B as a bmfont finding.** Record TL-28 in the
  ledger as `scoped, not fixed` with the measured `24` vs `19` evidence, so the
  next reader knows the width assertion's ASCII scope is a decision, not a
  corpus that never happened to emit a EURO.

## HOT PATH

**No code in `TextLayout.js` changes under recommendation A.** The diff is
documentation, a test-only devDependency, a torture tier, an oracle condition,
a corpus change, and the RULES additions. Re-run T6 anyway: a session that
claims to change no source and then moves the `known-failing` count has, at
minimum, changed the harness the source is measured by. The 0-bytes-per-op
lanes must read exactly as TL2 left them -- `major 0, minor 0, source gc,
arrayBuffers 0`. If any lane moved, something in the test path is allocating
where TL2's did not.

The one exception is T9 control 13 (Phase A step 3), which deletes the CR
exclusion to prove the control bites and then restores it. Confirm the restored
sha matches `2d198b7a...` byte-for-byte before release.

## ASSERTIONS

  1. **CRLF LF-identity, differential.** Over the CRLF-bearing 50,000-case T5
     corpus, `divergences === 0` with both the corpus and oracle CR conditions
     in place, at both `boxHeight === 0` and `boxHeight > 0`. Deleting the
     oracle condition -> `divergences > 0`. Deleting the subject's truncating-
     arm CR exclusion -> `divergences > 0` at a truncating CRLF case (T9
     control 13).

  2. **Width agreement (ASCII-scoped).** For every line of a 200-case ASCII
     corpus, `lineWidth === font.measure(text.slice(startIdx, endIdx), scale)`
     within one f32 ulp, for `scale` in `{0.5, 1, 2}`.

  3. **Truncated-line width exception.** On a FLAG_TRUNCATED line,
     `lineWidth - measure(content) === 3 * xadvance('.') * scale`, exactly.

  4. **TL-25 detector.** Fails at `scale` 0.5 and 2, passes at 1, with the same
     test body, against the installed peer; registered as the one named
     `known-failing` entry.

  5. **TL-28 scope.** A single non-ASCII probe (`'A\u20ACB'`, kern(A,B) = -5)
     asserts `computeWrap -> 24` and `font.measure(slice) -> 19`, documenting
     the divergence as defined behaviour, NOT as a they-agree case.

  6. **Format.** Stride 4; slot order asserted against `drawWrapped`'s four
     reads; `drawWrapped` compares `flags === 1` by equality, so FLAG_OVERFLOW
     is inert there.

  7. **Drift guard.** The canonical range sentence block is byte-identical
     across `TextLayout.js`, `TextLayout.d.ts`, `llms.txt`, `README.md`.

  8. **Instruments.** `RULES` rejects a scavenge (maxMinor) and a non-'gc'
     source; `npm test` is 66 green; `crlfInRange` carries the past-the-end
     comment.

  9. **Gate.** `node --expose-gc test/torture.mjs` -> `ok`, exit 0,
     `known-failing=1 todo=1`, T8 registered with its one named entry;
     `TEXTLAYOUT_TORTURE_BREAK=1` exits non-zero; every T9 control (1..13)
     exits non-zero when isolated.

## LEDGER AFTER TL3

  - **TL-12, TL-14** -> closed (range sentences executable + drift-guarded).
  - **TL-25** -> `known-failing`, named, detector shipped; closes in the peer.
  - **TL-28** -> `scoped, not fixed`; filed as a bmfont finding.
  - `known-failing=1 todo=1` at session end. `todo=1` is control-6 graduating
    into live control-13 territory -- confirm the count, do not assume it.

## NON-GOALS

  - No runtime dependency, either direction, ever. bmfont is `devDependencies`
    only.
  - No per-glyph API (law 2). No public `start`/`end` on measure -- that is
    bmfont's surface, not this one's.
  - No 0-bytes-per-frame end-to-end claim -- TL5, blocked on bmfont's range
    API.
  - No `FORMAT_VERSION` handshake -- blocked on bmfont M9 (v2.0.0).
  - No edit to `TextLayout.js` behaviour under decision A. If A is overturned in
    the decision record, this brief's HOT PATH section is void and the session
    re-scopes.

## RISKS AND THEIR CHECKS

  - **The corpus emits CRLF but nothing exercises the truncating arm.** Check:
    Phase A step 3's first direction must show `divergences > 0` at a case with
    `boxHeight > 0`. If every divergence is at `boxHeight === 0`, the corpus is
    not reaching the arm that shipped broken -- widen the CRLF injection into
    the truncating regime and re-confirm.

  - **The peer changed under us (1.2.0 -> 1.2.3).** Check: PRE-FLIGHT 3 and 4
    re-derive TL-25 and TL-28 against the installed peer before either detector
    is written. If either is already fixed upstream, drop the detector and note
    it in the decision record.

  - **The width assertion passes vacuously.** It is ASCII-only by decision, so
    it will never see the TL-28 case -- which is correct, but means the
    assertion proves agreement only within its scope. Guard against MISTAKING
    it for a general width proof: the tier header must state the scope, and
    TL-28's probe (assertion 5) must live in the same file so the boundary is
    visible to the next reader.

  - **`instanceof` / realm surprises in T8.** A bmfont `BitmapFont` instance is
    a valid `font` for `computeWrap` (duck-typed on `glyphs`/`kerning`), but
    `outBuffer` is `instanceof Float32Array` and the test must build the buffer
    in the same realm. No cross-realm views in the tier.

## DONE WHEN

  - The range semantics are identical in four surfaces and drift-guarded.
  - CRLF has real differential coverage: the oracle sees a CR, the corpus emits
    `\r\n` across both arms, and the control that reproduces TL2's blocker is
    wired and red-on-break.
  - The width agreement is gated in CI (ASCII-scoped, with TL-28 documented as
    the boundary).
  - TL-25 is filed against the peer with a named, counted, non-exiting failing
    detector and a decision record; it is NOT closed here.
  - `npm test` is 66 green; `node --expose-gc test/torture.mjs` prints `ok`,
    exit 0, `known-failing=1 todo=1`; `TEXTLAYOUT_TORTURE_BREAK=1` exits
    non-zero.
  - `TextLayout.js` sha is unchanged from TL2's `2d198b7a...` (control 13's
    break restored byte-for-byte).
