---
package: "@zakkster/lite-text-layout"
version_target: 1.3.0
status: ready
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-bmfont"]
findings: [TL-25]
depends_on: [TL3, "lite-bmfont 1.4.0 (measureLine) + 1.6.0 (F-45)"]
blocks: []
---

# TL5 -- lite-text-layout v1.3.0 -- allocation-free rendering, end to end

## UNBLOCKED (was BLOCKED through 1.2.2)

Both halves of the peer dependency have shipped and are verified:

  - **Public range measure** -- `measureLine(text, start, end, scale)`, bmfont
    1.4.0. Replaces the test-only `measure(text.slice(s, e), scale)`.
  - **The scale reconciliation (TL-25 / bmfont F-45)** -- bmfont 1.6.0.
    `drawWrapped` now compares `lineWidth` DIRECTLY to `boxWidth`
    (BitmapFont.js:1136-1137, `(boxWidth - lineWidth) / 2`), adopting THIS
    package's rendered-scale contract; bmfont's own t2 F-45 matrix pins it
    pixel-exact at scale 0.5/1/2. bmfont's Law now reads `lineWidth@render-scale`.

TL5's original `depends_on: ["lite-bmfont Session 2"]` is satisfied. No API is
being planned against that does not exist -- both faces are published and were
run before this brief was written.

## THE TRIGGER (this session is FORCED, not merely enabled)

The installed peer in `node_modules` is still **1.2.3**; torture is green today
only because it measures the OLD peer. The first task -- bump the devDep floor
and reinstall -- is the fail-closed trigger TL3 built, not housekeeping:

  - T8 section 3 registers the TL-25 detector as `knownFailing('TL-25', ...)`
    with a self-promotion trap: "when the peer drops `* scale`, both become false
    and `knownFailing` die()s demanding promotion." Against 1.6.0 the detector
    now finds the peer AGREES at 0.5 and 2, so the predicate returns false and
    torture goes RED until the entry is promoted to a live assertion.
  - The paired `T9 control-6` ("double-scaled width", today `todo=1`, labelled
    "lands in TL3") comes due: a promoted assertion needs its control that proves
    it can fail.

So the devDep bump reddens the gate on purpose. Do it first, watch it go red,
then close it. A green you did not watch go red is not evidence.

## PURPOSE

The whole point of reporting `[startIdx, endIdx)` into the ORIGINAL string is
that a renderer never has to `slice()`. TL3 proved the WIDTHS agree using a
test-only slice -- the honest half ("a test may slice, a frame may not"). TL5
removes the slice from the MEASURED path and proves the pipeline
`computeWrap -> measureLine -> drawWrapped` renders a full wrapped paragraph at
**0 bytes/frame**, end to end, against the shipped peer.

## HOT PATH

**Still ZERO code in TextLayout.js.** TL5 touches tests, the torture harness,
`package.json` (devDep floor), and docs -- nothing else. At `/release` the ONLY
edit to TextLayout.js is the VERSION const (`1.2.2` -> `1.3.0`); the logic is
byte-frozen. The pipeline gate measures the peer's hot path as much as this
one; if it fails, the finding belongs to the peer and is filed there (it did
once -- that was F-45).

## TASKS

  1. **Bump the peer floor and reinstall (the trigger).**
     `@zakkster/lite-bmfont` `^1.2.3` -> `^1.6.0` in `package.json`
     devDependencies; `npm install`. Run torture and CONFIRM it now reddens on
     the TL-25 self-promotion before changing anything else.
  2. **Remove the slice from the width agreement (T8 sections 1 and 2).**
     Swap `BF.measure(text.slice(startIdx, endIdx), scale)` for
     `BF.measureLine(text, startIdx, endIdx, scale)` -- note the arg order
     `(text, start, end, scale)`. For valid in-range integer indices it equals
     `measure(slice)` to the ulp; the corpus is ASCII-scoped and CR-free, so no
     range hits `measureLine`'s NaN/clamp legs (F-35/F-38). Keep the
     FLAG_OVERFLOW `die()` guard so the agreement stays non-vacuous.
  3. **Promote TL-25 to a live assertion (T8 section 3).** Replace
     `knownFailing('TL-25', ...)` with a `check(...)` asserting the recorded
     first-dx equals `Math.round(ALIGN_BW - lineWidth)` at scale 0.5, 1 AND 2
     (the peer no longer double-scales). Drop `known-failing=1` from the summary
     line. The precondition check at scale 1 folds into the full assertion.
  4. **Activate T9 control-6 (double-scaled width).** A control that feeds the
     promoted section-3 assertion a SYNTHETIC double-scaled placement
     (`round(ALIGN_BW - lineWidth * scale)`, the pre-1.6.0 math) and proves the
     assertion REJECTS it -- exiting non-zero. It cannot mutate the installed
     peer, so it drives the detector with the old formula locally. Drop `todo=1`.
  5. **Add the T6 pipeline lane (zero-alloc, end to end).** After the existing
     lanes (strictly serial, never nested): `computeWrap` into the reused
     `Float32Array`, then
     `BF.drawWrapped(recCtx, text, out, n, boxWidth, boxHeight, x, y, scale, align, vAlign)`
     over a full wrapped paragraph. `recCtx` is a non-allocating recorder
     (`drawImage(){ this.draws++ }`). Two witnesses back-to-back: `runOpsGate`
     (maxMajor 0 / maxPauseMs 4 / maxArrayBuffersGrowth 0, stabilize 'deep') and
     `runAllocGate` (`measureAllocs`, maxBytesPerCall 0). SINK the work to defeat
     DCE; `TEXTLAYOUT_TORTURE_BREAK=1` injects a retained alloc into the lane and
     BOTH gates must then reject.
  6. **Add the pixel-identity lane (the reworded assertion -- see below).**
     `drawWrapped` over a one-line range buffer per corpus line vs the slicing
     oracle `BF.draw(recCtx, text.slice(s, e), x, y, scale, align)`: byte-identical
     recorded dx column, over the seeded corpus, scale {0.5,1,2} x align {0,1,2}.
     The oracle may slice; the measured render (drawWrapped) does not. This is a
     correctness lane -> it lives in T8 (allocates freely), NOT the T6 gate.
  7. **CHANGELOG + docs.** State the allocation-free PAIR floor: `computeWrap` +
     bmfont `drawWrapped` >= 1.6.0 is 0 bytes/frame end to end, so a consumer can
     reason about which pairings are allocation-free. Add a runnable end-to-end
     example (computeWrap -> drawWrapped) to README/llms.txt with the measured
     0-B/frame number, stamped with version + machine. Update the T8 header
     comment in torture.mjs -- it still calls T8 "empty, TL3" and the tier is not.

## THE ONE REWORD (baked in per this session's finding)

TL5's original assertion named `draw(text, ..., s, e)` -- a range-aware
single-line `draw`. That is bmfont's **M6**, which is `status: planned` and did
NOT ship (its 1.6.0 slot was consumed by the F-45 fix). It is NOT required:
bmfont keeps `drawWrapped` as THE range renderer for wrapped text (M6 NON-GOAL:
"No `drawWrapped` signature change -- it already takes ranges through the
buffer"), and bmfont's own F-45 lane already proves `drawWrapped` pixel-identical
to `draw(slice)`. So assertion 2 is honored via `drawWrapped` vs a `draw(slice)`
oracle. A literal range-`draw` would additionally wait on M6 and buys TL5
nothing.

## ASSERTIONS (each watched RED before, GREEN after)

  1. The full wrapped paragraph (`computeWrap` + `drawWrapped`) reports 0
     bytes/frame under BOTH the rate gate and the retention gate. BREAK injects a
     retained alloc -> both reject -> non-zero exit.
  2. `drawWrapped` over a per-line range buffer is byte-identical (recorded dx)
     to `BF.draw(text.slice(s, e), ...)` for every corpus line, scale {0.5,1,2},
     align {0,1,2}.
  3. The TL-25 detector PASSES at scale 0.5, 1 and 2 with no `knownFailing`
     remaining; T9 control-6 reintroduces the double-scale and the promoted
     assertion catches it (exits non-zero).
  4. Width agreement (T8 s1/s2) holds through `measureLine` with NO slice in the
     measured path; a too-small OUT still `die()`s (agreement not vacuous).
  5. torture prints exactly `ok`, with `known-failing=0 todo=0`; every control
     (BREAK, control-6, the TL-27 watchdog) still exits non-zero.

## NON-GOALS

  - No per-glyph API (law 2). No shim, no reimplementation of the peer.
  - No runtime dependency: bmfont stays a TEST-ONLY devDependency, both
    directions.
  - No edit to TextLayout.js logic -- VERSION const only, at release.
  - No dependency on bmfont M6 (range-aware `draw` / `layoutGlyphs`); not shipped,
    not needed.
  - No FORMAT_VERSION handshake -- that is bmfont M9 (2.0.0) and a later TL.

## DONE WHEN

A full wrapped paragraph lays out and renders at 0 bytes/frame, gated in CI, with
NO test-only slice anywhere in the MEASURED path (oracles may still slice); TL-25
is promoted to a live green with T9 control-6 active; torture is `ok` with
`known-failing=0 todo=0`; and the CHANGELOG states the bmfont `^1.6.0`
allocation-free floor.
