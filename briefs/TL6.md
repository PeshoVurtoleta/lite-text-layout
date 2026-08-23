# TL6 -- lite-text-layout v1.4.0 -- decode the peer's 1/16 store (TL-28)

```markdown
---
package: "@zakkster/lite-text-layout"
version_target: 1.4.0        # MINOR. No public signature moves. Behaviour
                             # changes ONLY against a bmfont >= 2.0.0 font,
                             # where today's behaviour is silently wrong -- so
                             # this is a fix, not a break. A 1.x font must come
                             # out BYTE-IDENTICAL, and that is A3.
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-bmfont"]
findings: [TL-28]
depends_on: []               # NOT blocked. bmfont 2.0.1 is published; the fix
                             # is entirely in this package.
---
```

# lite-text-layout -- the advance store moved and nobody told the wrapper

## 0. What is wrong, in one paragraph

`@zakkster/lite-bmfont` 2.0.0 moved `glyphs[id * 7 + 6]` and the 64K kerning LUT
to **1/16 fixed point**, recovered with `stored * GLYPH_ADVANCE_SCALE` where
`GLYPH_ADVANCE_SCALE === 0.0625`. This package still reads both stores raw. So
against any bmfont >= 2.0.0 font every width it computes is **exactly 16x too
large**, wrap collapses to roughly three characters per line, and nothing
throws. Filed here as **TL-28** and in the peer as **F-56**.

## 1. Proven at filing time (2026-08-22, against lite-bmfont 2.0.2)

Measured, not reasoned:

| | |
|---|---|
| font: 10 glyphs, `xadvance` 10 | |
| `bmfont.measure('ABCDEFGHIJ', 1)` | **100** |
| raw `glyphs[65 * 7 + 6]` | **160** |
| this package's `lineWidth` | **1600** |
| ratio | **exactly 16** |
| 306-char paragraph, `boxWidth` 560 | **97 lines** (correct: 7) |
| a whole-pixel Int16 view, as a control | restores agreement exactly, 110 vs 110 |

The six read sites, all in `TextLayout.js`:

| line | what it reads |
|---|---|
| `:341` | `dotAdvance` -- the ellipsis width |
| `:377` / `:380` | the CR path advance + kerning |
| `:443` / `:442` | main accumulation: advance + kerning |
| `:662` / `:661` | the `countLines` twin of the same |
| `:515` / `:697` | the `cursorX` re-seed after a break |

Miss one and the defect survives in a branch nobody drives -- `:341` and the CR
path are the two most likely to be forgotten.

## 2. Why both test suites are green today

Neither repo is internally wrong, and this is the part worth understanding
before writing any code.

- This package pins `"@zakkster/lite-bmfont": "^1.6.0"`. The installed copy is
  **1.6.0**, so `test/torture/bmfixture.mjs` builds a REAL `BitmapFont` in the
  **pre-2.0 whole-pixel format**, and the whole cross-package tier (T8, plus the
  T6 lane-4 pipeline lane) measures against it and passes.
- The peer added a deliberate boundary guard (`LiteBmfont/test/packaging.test.js:441`)
  asserting THIS repo's installed bmfont stays below 2.0.0, reddening on purpose
  when it is bumped. It is green and it is honest: it correctly reports that the
  format has not crossed the boundary yet.

The break lives only in the GAP, where `@zakkster/lite-bmfont@2.0.1` and
`@zakkster/lite-text-layout@1.3.0` are both live on npm and both packages'
docs advertise the pairing. A guard on one repo's tests is not a guard on the
integration. It was found by USING the pairing, which is the only thing that
catches this class.

## 3. The fix shape -- feature detection, decided ONCE at entry

**`FORMAT_VERSION` is NOT reachable.** It is a module export of bmfont, not an
instance property -- verified: a `BitmapFont` instance carries
`atlas, lineHeight, base, glyphs, kerning, _charScratch, _mapped, checked` and
no version. This package receives a duck-typed `{glyphs, kerning}`, so a
`font.FORMAT_VERSION` check would read `undefined` forever and silently select
the wrong branch. Do not write it.

**Feature-detect the 2.x accessors instead.** Verified against both majors:
bmfont 1.6.0 contains **zero** occurrences of `advanceOf`, `kernOf` and
`GLYPH_ADVANCE_SCALE`; 2.x has all three on the prototype.

```js
// ONE branch, at entry, outside the loop -- matching this package's existing
// "validated once at entry, never from inside the loop" discipline.
const advScale = (typeof font.advanceOf === 'function') ? 0.0625 : 1;
```

then multiply every one of the six reads by `advScale`. Hot-loop cost is one
extra multiply against a local, and zero branches.

Rejected alternatives, recorded so nobody re-proposes them:

- **Call `font.advanceOf(id)` / `font.kernOf(a, b)` per glyph.** Correct, but it
  puts a method call in the hot loop of a package whose identity is a single
  linear pass, for no accuracy gain over the constant.
- **Always multiply by 0.0625.** Breaks every 1.x font, which is most of them.
- **Sniff the magnitude** (e.g. "advances look 16x too big"). A heuristic on
  unverified state. This suite's law is that a gate exemption is an unverified
  state; a format guess is the same defect wearing a different hat.

**Fail closed on the unknown case.** If a future bmfont exports a third format,
feature-detecting `advanceOf` will silently pick the 2.x path. Decide now
whether to accept that or to require the caller to pass the scale explicitly,
and write the decision down in `decisions/`. Do not leave it implicit.

## 4. TASKS

- **T-1 (do this first -- it is the red test).** Bump the bmfont devDep to
  `^2.0.1` and `npm install`. **PREDICTED, NOT VERIFIED BY THE FILER:** T8 and
  the T6 lane-4 pipeline lane should go RED immediately, because
  `bmfixture.mjs` builds a real `BitmapFont` and its advances become 16x. If
  they DO NOT redden, stop -- that means the cross-package tier is not actually
  reading the peer's format and TL-28's blast radius is larger than filed.
  Report which lanes fired before changing any source.
- **T-2.** Add the `advScale` entry detection and apply it at all six sites in
  section 1. Both entry points (`computeWrap` and `countLines`) share the
  validator; keep the detection in the same shared place so they cannot drift.
- **T-3.** `bmfixture.mjs` must build fixtures from a REAL bmfont 2.x font, not
  a hand-written whole-pixel stub. A stub in the old format is precisely what
  hid this for a whole major version.
- **T-4.** Keep a 1.x lane. The regression that matters most is a 1.x font
  coming out different after this change. See A3.
- **T-5.** Update `llms.txt`, `README.md` and the package description: state
  which bmfont majors are supported and that widths are decoded for >= 2.0.0.
  The current text says the output "is exactly the layout buffer that
  `@zakkster/lite-bmfont`'s `BitmapFont.drawWrapped` consumes" with no version
  qualifier, and that sentence is what made the breakage invisible.
- **T-6.** Bump the peer devDep floor and say in the CHANGELOG which pairs are
  correct, so a consumer can reason about it.
- **T-7.** Tell the peer. `LiteBmfont/test/packaging.test.js:441` currently
  asserts this repo's installed bmfont is `< 2.0.0` and will redden the moment
  T-1 lands. That is the guard working as designed -- its own comment says to
  replace the line with a real `peer.FORMAT_VERSION === FORMAT_VERSION` drift
  check at that point. Coordinate, do not just unpin it.

## 5. ASSERTIONS

Every assertion names the mutation that reddens it, and that mutation is
APPLIED in a sandbox copy and WATCHED go red. A cited-but-never-run mutation is
not an assertion.

- **A1** Against a REAL bmfont 2.x font, `computeWrap`'s `lineWidth` equals
  `font.measure(sameText, scale)` exactly, for a newline-free string.
  *Mutation:* drop `advScale` from `:443` -> the width goes 16x, red.
- **A2** The ellipsis path is covered. *Mutation:* drop `advScale` from `:341`
  only -> a truncated line's ellipsis geometry moves, red. If A1 already
  catches this, A2 is preempted and must be re-scoped to the ellipsis width
  alone -- inert-shape (2).
- **A3** A bmfont **1.x** font produces BYTE-IDENTICAL output before and after
  this change. *Mutation:* force `advScale = 0.0625` unconditionally -> the 1.x
  lane goes red. This is the assertion that proves the fix is a fix and not a
  second breakage pointed the other way.
- **A4** The CR path is driven. *Mutation:* drop `advScale` from `:377`/`:380`
  -> red. If nothing reddens, no test drives CR text and the lane is missing.
- **A5** `countLines` and `computeWrap` agree on the same input at the same
  scale against a 2.x font -- they are separate code paths (`:443` vs `:662`)
  and a fix applied to one only is the obvious partial failure.
- **A6** Zero-allocation is preserved: the T6 lanes still gate `maxMajor 0`,
  `maxPauseMs 4`, `0 B/op`. One extra local multiply must not move it.

Check every assertion against the five inert shapes: (1) the mutation cannot
redden; (2) a cheaper assertion preempts it; (3) a static import crashes the
file so nothing runs; (4) a synchronous hang blocks the event loop; (5) on a
multi-lane gate the mutation's SHAPE decides which lane fires.

## 6. DONE WHEN

1. `npm run verify` green (`npm test` 0 fail, `npm run torture` prints `ok`).
2. The bmfont devDep is `^2.0.1` and the fixture is built from a real 2.x font.
3. A1-A6 all proven by an APPLIED mutation, A3 included.
4. A 1.x font's output is byte-identical to v1.3.0's.
5. `llms.txt` / `README.md` / `package.json` state the supported bmfont majors.
6. TL-28 closed in `ROADMAP.md` with a closure marker that describes the repair
   ACCURATELY -- name feature detection, not "version gating", if that is what
   shipped.
7. The peer is told, so `LiteBmfont/test/packaging.test.js:441` becomes a real
   `FORMAT_VERSION` drift check instead of being unpinned to stay green.

## 7. Standing constraints

- Do NOT `git commit`, `git push`, `npm publish`, or run `/release`. The user
  releases and commits personally. `git add` of targeted paths is fine.
- ALL mutation testing in a SANDBOX COPY. Never mutate the live tree.
- Leave no scratch files in the live tree.
- ASCII-only source (U+00D7 and U+00B5 excepted).
- Zero runtime deps. bmfont stays a TEST-ONLY devDependency in both directions,
  which is the rule that keeps this pair from becoming a cycle.
