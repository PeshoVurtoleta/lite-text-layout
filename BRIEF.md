---
package: "@zakkster/lite-text-layout"
version_target: 1.2.0
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [TL-03, TL-04, TL-05, TL-06, TL-07, TL-08, TL-09, TL-10, TL-12, TL-13, TL-14, TL-15, TL-23, TL-24, TL-26]
depends_on: [TL1]
blocks: [TL3]
---

# TL2 -- lite-text-layout v1.2.0 -- NaN is not infinity, and null is not zero

## PURPOSE

Every guard in this file is written `x > 0`, and every comparison against NaN is
false. So `boxWidth = NaN` means "no horizontal limit", `scale = NaN` means "no
wrapping at all", a 700-entry glyph table means "no wrapping at all AND every
width is NaN", and `lineHeight <= 0` with `boxHeight > 0` means "truncation is
off" while the caller believes they asked for it. None of these throws. All of
them render. TL0 pinned thirty-five of them as executable `knownFailing`
entries; TL2 closes the ledger to zero.

They are one bug in fifteen costumes: the function trusts its arguments and
discovers the problem in the middle of a loop, where a poisoned local has
already defeated every downstream comparison. One door at the top closes all of
them, and writing fifteen separate guards means writing the same door fifteen
times in the wrong place. The door is ONE shared internal function called from
both entry points, because `countLines` is a near-verbatim copy of
`computeWrap`'s pass and two copies of a validator drift within one session.

This is the largest session in the package. Read THE ORDER before touching
anything; three of the steps are barriers and the rest will not survive being
done out of sequence.

## PRE-FLIGHT

Still no `.git` in this tree. Recorded copy plus `diff`, exactly as TL0 and TL1
did. `timeout(1)` does not exist on this machine -- wrap long runs as
`perl -e 'alarm 300; exec @ARGV' node --expose-gc test/torture.mjs`.

```
SCRATCH=/private/tmp/claude-502/-Users-zakkster-Work-Portfolio-LiteLibrariesSuite-LiteTextLayout/8f441064-ff8f-43c2-839d-7b11a9dce312/scratchpad
```

P1. `cp TextLayout.js $SCRATCH/TextLayout.js.pre` and
    `shasum -a 256 TextLayout.js > $SCRATCH/TextLayout.js.sha.pre`. Overwrite the
    TL1-era copy -- the pre-side of this session is the shipped 1.1.0 file.
    `wc -l TextLayout.js` is `383`. This copy is the only witness the HOT PATH
    section has.
P2. `npm test 2>&1 | tee $SCRATCH/test.pre.txt`. Expect `pass 40`, `fail 0`,
    10 suites. If it is not 40, STOP and report.
P3. `npm run torture 2>$SCRATCH/torture.pre.err 1>$SCRATCH/torture.pre.out`.
    `$SCRATCH/torture.pre.out` must be exactly `ok\n`, exit 0.
P4. `grep -o 'KNOWN-FAILING -- [^ (]*\|TODO -- [^:]*' $SCRATCH/torture.pre.err | sed 's/.*-- //' | sort -u > $SCRATCH/ids.pre.txt`
    and `grep 'known-failing=' $SCRATCH/torture.pre.err` -> `known-failing=35 todo=5`.
P5. **Capture the labels, not just the ids.**
    `grep 'KNOWN-FAILING' $SCRATCH/torture.pre.err | sort > $SCRATCH/labels.pre.txt`
    -- 35 lines. This file is the ledger. LEDGER RECONCILIATION is checked
    against it line by line, and "quietly dropped an entry" is the single
    failure mode this session is most exposed to.
P6. `grep 'T5 cases=' $SCRATCH/torture.pre.err` -> `cases=50000 divergences=40 (tl26=40 unexpected=0)`.
P7. T6 lanes 1 and 2 into `$SCRATCH/tl20.pre.json`: `verdict: 'pass'`,
    `source: 'gc'`, major 0, minor 0, `maxMs` 0.000, `arrayBuffers` growth 0,
    `bytesPerCall` 0, `settled` true. Also record the wall time of the 20,000-op
    lane-1 window; the door is a per-call cost and the CHANGELOG must state its
    measured delta.
P8. `grep -c 'FLAG_TRUNCATED' test/torture/t5-fuzz.mjs` -> `0`. That zero is the
    inherited TL1 QA finding, and Phase B is what makes it non-zero.
P9. **Record the atlas advances the width pins depend on**, or every width
    assertion below is measuring the font and not the rule:
    `node --input-type=module -e "const{FONT}=await import('./test/torture/harness.mjs');console.log(FONT.glyphs[65*7+6],FONT.glyphs[32*7+6],FONT.glyphs[13*7+6],FONT.kerning[(65<<8)|13])"`
    Expected `12 6 0 0`. Every literal width in ASSERTIONS is derived from those
    four numbers ('A' = 12, ' ' = 6, CR = 0, no CR kerning). If any differs,
    recompute the literals and say so in the session notes -- do not soften the
    assertion into an inequality.
P10. `grep -n '1\.1\.0' TextLayout.js TextLayout.d.ts llms.txt README.md package.json test/TextLayout.test.js`
    -- every hit is a pin Phase H moves to `1.2.0`.

---

## THE ORDER

Fourteen findings collapsing into one door means most of the work is
interleavable and three points are not. Barriers are absolute: do not start the
next group until the named number is reproduced.

```
A   decision file 0002-input-door.md, all 27 rows            (no code)
B   T5 flag tripwire, added while behaviour is UNCHANGED     -- BARRIER 1
C   the shared door + TextLayoutError + the TL-07 early exit
D   promote the 29 door entries and 6 documented entries     -- BARRIER 2
E   TL-26 phantom-line fix + TL-13 CRLF, one edit, one branch
F   promote TL-26 and TL-13 in the same commit as E          -- BARRIER 3
G   T1/T2/T0/T6 lane 3/T7/T9 widening
H   d.ts, llms.txt, README, docstring, tests, version, CHANGELOG
```

**BARRIER 1 -- the tripwire before the change.** B adds an instrument for two
claims that TL1's QA verified by hand and left uninstrumented. Adding it AFTER
the whitespace edits would prove only that the new code agrees with itself.
After B: `known-failing=35 todo=5`, `divergences=40`, and the new tripwire line
reports `flagslots=161249 badvalue=0 bothflags=0`. All three unchanged from
pre-flight except the new line. B may not touch `TextLayout.js`.

**BARRIER 2 -- the door is complete and behaviour is otherwise frozen.** After
D: `known-failing=1 todo=4` (only TL-26 remains), `divergences=40 (tl26=40
unexpected=0)`, tripwire still `badvalue=0 bothflags=0`. If the divergence count
moved during C or D, the door changed the wrapping algorithm and C is wrong.

**BARRIER 3 -- TL-26 and its promotion are one commit.** Fixing TL-26 takes
`divergences` from 40 to 0, and `knownFailing('TL-26', ...)` calls `die()` the
instant its predicate goes false ("no longer reproduces -- promote it"). E
without F is a red suite by construction. After F: `known-failing=0 todo=2`,
`divergences=0 (tl26=0 unexpected=0)`.

C and D are one unit per finding group and may be interleaved freely within
themselves (door check for `scale`, then promote the four `scale` rows, then the
next group) -- that is in fact the recommended rhythm, because it keeps the red
window one group wide. G and H are free-order after BARRIER 3, except that T9's
controls must be written after the mechanisms they mutate exist.

---

## THE DOOR CONTRACT

One internal function, not exported, declared before the `TextLayout` object
literal, called as the first statement of BOTH entry points:

```
validateInput(text, font, boxWidth, boxHeight, lineHeight, scale) -> void (throws)
```

`outBuffer` is NOT its parameter. `countLines` has no buffer, and a validator
that takes an argument one caller cannot supply grows an `undefined` special
case on day one. The `outBuffer` check lives in `computeWrap` alone, as one
statement immediately after the shared call.

**Error type.** `export class TextLayoutError extends Error` with
`this.name = 'TextLayoutError'`. Exported, documented in all four surfaces. The
message names the argument, what it received, and what is required -- the point
of TL-09 is that `Cannot read properties of undefined (reading '324')` tells the
caller nothing. Build the message with a template literal at throw time. **Do
not pre-build a shared error instance**: a shared error has a shared stack and
lies about where it came from. Error objects allocate; the throwing path is
never measured and never hot, and no T6 lane may call it.

**`instanceof Float32Array`, not duck-typing.** Fail closed on every unverified
state. A cross-realm `Float32Array` fails `instanceof` and therefore throws;
that is the correct answer for this library and it goes in the docstring as a
named caveat rather than being papered over with `ArrayBuffer.isView` plus a
constructor-name string compare.

**Order of checks inside the door** -- `text`, `font`, `font.glyphs`,
`font.kerning`, `boxWidth`, `boxHeight`, `lineHeight`, `scale`. Fixed, and
written down, because the tests assert which message comes back for a tuple that
is wrong in two places.

### The policy table (every row lands in decisions/0002-input-door.md)

| Finding | Rows | Policy | Behaviour after TL2 |
|---|---|---|---|
| TL-09 | 7 | A throw | `text` not a string; `font` null/undefined/missing either table |
| TL-08 | 3 | A throw | `font.glyphs.length < 1792` or `font.kerning.length < 65536`, message names the table, the received length and the required length |
| TL-03 | 2 | A throw | `scale` non-finite |
| TL-04 | 2 | A throw | `scale <= 0` |
| TL-05 | 4 | A throw | `boxWidth` non-finite or `< 0`; `0` still means no limit |
| TL-06 | 3 | A throw | `lineHeight` non-finite always; `lineHeight <= 0` throws only when `boxHeight > 0` |
| TL-10 | 3 | A throw | `outBuffer` not a `Float32Array` (Int32Array, Float64Array, plain Array) |
| TL-07 | 2 | B define | `boxHeight > 0 && lineHeight * scale > boxHeight` -> return `0`, write nothing |
| TL-24 | 1 | B define | a single glyph wider than `boxWidth` is emitted as an over-wide line, unflagged, documented |
| TL-13 | 2 | B define | a CR immediately preceding an LF is excluded from the emitted range |
| TL-13 | 1 | C document | a lone CR keeps its atlas advance (0 in this font) and stays inside the range |
| TL-14 | 3 | C document | leading whitespace is preserved -- the code is right, the docstring is wrong |
| TL-15 | 1 | C document | indices are exact to 2^24; a text longer than 16,777,216 chars is out of domain |
| TL-12 | 0 | C document | the ellipsis allowance, stated in all four surfaces, not just d.ts |

**TL-14 is the non-obvious call and it is deliberate.** Skipping leading
whitespace at the start of the text would silently destroy indentation, and
`'   '` -> one line of width 18 is a defensible indent line. Narrow the
docstring's "runs of leading whitespace on the next line are skipped (no
whitespace-only lines)" to "after a soft break" in all four surfaces. The three
`knownFailing` rows become three named passing pins whose test names say
DELIBERATE, so nobody "fixes" them in TL3.

**TL-15 is DOCUMENT, not throw.** `startIdx`/`endIdx` are Float32 and exact only
to 2^24. A `text.length` check at the door is one read, but a throw turns a
legal 16 MB string -- which lays out correctly for every index below the ceiling
-- into a hard failure. Pin the two round-trip facts by name:
`Math.fround(16777217) === 16777216` and `Math.fround(16777219) === 16777220`.
If the decision file argues for a throw instead, that is acceptable; leaving it
unowned for a third session is not.

**TL-23 is hygiene, not a bug.** Reset `lastSpaceWidth` alongside every
`lastSpace = -1`, or hoist both into one reset. Three sites in `computeWrap`.
The T5 fuzz is the only thing that proves they stay in sync; assertion 15 is the
mutation that proves the fuzz would notice.

**The aliasing todo closes as DOCUMENT.** `outBuffer` aliasing `font.glyphs` is
possible only through a shared `ArrayBuffer`, and a `.buffer` identity check
would reject a caller who packs disjoint views into one arena -- correct code.
Policy: documented as caller error with undefined result, no runtime check. The
falsifiable half is pinnable and must be pinned: a `Float32Array` and an
`Int16Array` that are disjoint views of one `ArrayBuffer` do NOT throw.

---

## TL-26 -- THE EXCEPTION, CARVED ON PURPOSE

The stated non-goal of this session is "no change to the wrapping algorithm
itself -- the doors decide what enters the loop, not what the loop does".
TL-26 is a behaviour bug inside the loop. The exception is granted, once, with
its reason recorded in the decision file:

> TL-26 is the last inhabitant of the `knownFailing` ledger, it lives in the
> newline branch that TL-13 must edit anyway, and the alternative is two
> sessions editing the same eight lines of the only hot loop in the package.
> One edit to one branch is cheaper and safer than two.

It does not inherit into TL3. TL3's non-goals gain "no wrapping-loop edits; TL2
spent that budget."

**The bug, exactly.** `computeWrap('AAA \nBBB', FONT, 40, 0, 16, out)` returns
`3`: the soft break emits `[0,3,36,0]`, the space-eater stops at the `\n` and
sets `lineStart = 4`, and the newline branch then emits `[4,4,0,0]` -- a
zero-width phantom line -- before `[5,8,36,0]`. Forty of the 50,000 fuzz cases
hit it.

**The fix, and it must not over-suppress.** In the `id === 10` branch only, read
`text.charCodeAt(i - 1)` ONCE into a local, compute the CR-adjusted end index
from it, and suppress the emission when the resulting range is empty AND the
character before `lineStart` is a space:

```
end === lineStart && lineStart > 0 && text.charCodeAt(lineStart - 1) === 32
```

Suppression means: no write, no `lineCount++`, `lineStart = i + 1`, the same
state resets the branch already does, `continue`. It must be tested BEFORE the
truncation sub-branch, or a phantom line can trigger a truncation return with a
zero-length range.

The `text.charCodeAt(lineStart - 1)` form (rather than the cheaper
`prev === 32`) is required because `'AAA \r\nBBB'` reaches the newline with
`prev === 13`, and the cheap form leaves the phantom in place for CRLF text --
the exact intersection of the two findings this branch is being edited for.

**A deliberate blank line must survive.** `'AAA\n\nBBB'` has
`text[lineStart - 1] === 10`, not 32, so it still emits `[4,4,0,0]` and still
returns 3. That pin is not optional; it is the whole difference between a fix
and a regression.

**The residual.** A hard break that lands on a CR could in principle satisfy the
predicate. The arbiter is the fuzz corpus, not argument: `divergences=0
unexpected=0` over 50,000 cases, plus a hand-written row in `t1-degenerate.mjs`.
If a residual case appears, the oracle is the spec.

**TL-13, same branch, same read.** The CR-adjusted end index is
`(prev === 13 && i > lineStart) ? i - 1 : i`, used for the endIdx slot in both
the truncated-fallback emit and the normal emit. The width slot stays `cursorX`
unchanged. Both `computeWrap` and `countLines` need the change; `countLines` has
no endIdx, so it needs only the TL-26 suppression, and the two must be edited in
the same pass or the T0 agreement law fires immediately (which is the correct
outcome, and assertion 15 proves it would).

**Measure it.** The roadmap's escape hatch stands: this adds one `charCodeAt`
per LINE, not per character. On the 360-char TL-20 paragraph that is a handful
of reads per call. If T6 lane 1 moves outside noise, the CRLF half reverts to
policy C (document, normalise upstream) and the decision file records why. The
TL-26 half does not revert -- it is a correctness fix.

---

## TASKS

### Phase A -- the decision record, before any code

**A1. `decisions/0002-input-door.md`.** One row per finding with its policy
letter and its post-TL2 behaviour (the table above, expanded to prose). Plus:
the TL-26 exception with its reason; the TL-14 counter-argument written out, not
gestured at (a caller who passes user-entered text and gets an indent line they
did not ask for); the TL-15 throw-versus-document argument with both sides; the
aliasing policy with the arena counter-example; the cross-realm `instanceof`
caveat; the `TextLayoutError` shape; and the LEDGER RECONCILIATION table, all 27
rows. `decisions/` is a planning artifact and does NOT enter `files[]`.
Check: `test -f decisions/0002-input-door.md && LC_ALL=C grep -c '[^ -~\t]' decisions/0002-input-door.md` prints `0`.

### Phase B -- the tripwire (BARRIER 1, no source change)

**B1. `t5-fuzz.mjs` -- the flag tripwire.** Import `FLAG_NORMAL`,
`FLAG_TRUNCATED`, `FLAG_OVERFLOW` (P8: the file imports none of them today).
Per case, after the existing oracle comparison, walk slots `3, 7, 11, ...` of
the written region and count two independent violation classes: a flags value
outside `{0, 1, 2}`, and one output carrying both a `FLAG_TRUNCATED` line and a
`FLAG_OVERFLOW` line. Extend the T5 stderr line with
`flagslots=<n> badvalue=<n> bothflags=<n>`. No allocation per case -- three
module-scope counters and two module-scope booleans reset per case, no arrays,
no `subarray`.
File: `test/torture/t5-fuzz.mjs:run`. Finding: inherited from TL1 QA.
Check: the line reads `flagslots=161249 badvalue=0 bothflags=0` and the rest of
the T5 line is byte-identical to P6. 161249 is TL1's QA number; a different
count means the walk is scanning the wrong region.

**B2. `t9-controls.mjs` -- the tripwire's own control, both directions.** Extract
B1's scan into `harness.mjs:scanFlags(buf, n)` returning a packed violation
count, so the control cannot test a weaker predicate than the fuzz does. Feed it
a hand-built `Float32Array(12)` whose slot 7 is `3` (must report badvalue >= 1),
and one whose slots 3 and 11 are `FLAG_TRUNCATED` and `FLAG_OVERFLOW` (must
report bothflags >= 1); `die` if either reports zero. Then feed it a clean
buffer and require zero.
File: `test/torture/t9-controls.mjs:run`, `test/torture/harness.mjs:scanFlags`.
Check: `node --expose-gc test/torture.mjs` exits 0; neuter `scanFlags` to
`return 0` and it exits 1. Revert.

### Phase C -- the door (source)

**C1. `TextLayoutError`.** Exported class, `name` set, one docstring paragraph.
File: `TextLayout.js:TextLayoutError`.
Check: `node --input-type=module -e "const m=await import('./TextLayout.js');const e=new m.TextLayoutError('x');process.exit(e instanceof Error&&e.name==='TextLayoutError'?0:1)"` exits 0.

**C2. `validateInput`.** The shared door, per THE DOOR CONTRACT, in the fixed
check order. Module-scope function, not on the frozen namespace.
File: `TextLayout.js:validateInput`. Findings: TL-03..TL-06, TL-08, TL-09.

**C3. The two call sites.** First statement of `computeWrap` and of
`countLines`. `computeWrap` then adds the `outBuffer instanceof Float32Array`
check (TL-10) as its own statement.
File: `TextLayout.js:computeWrap`, `TextLayout.js:countLines`.

**C4. The TL-07 early exit.** `if (boxHeight > 0 && lineHeight * scale > boxHeight) return 0;`
after the door in BOTH entry points. It is a `return`, not a throw, so it cannot
live inside `validateInput` without giving the validator a return value and a
branch at both call sites. Duplicated deliberately; G3 is what catches drift.
File: `TextLayout.js:computeWrap`, `TextLayout.js:countLines`. Finding: TL-07.

**C5. TL-23.** Reset `lastSpaceWidth` at all three `lastSpace = -1` sites in
`computeWrap`. Not a live bug; three places that must stay in sync.
File: `TextLayout.js:computeWrap`.

### Phase D -- promote the 35 (BARRIER 2 for the door half)

Each `knownFailing` whose predicate C2-C5 falsifies is a bomb: the harness
`die()`s on a fixed bug. Promote group by group, immediately after the door
check that fixes the group. Every promoted row becomes a named `check()` with
the ORIGINAL reproduction as its body -- not a rewritten, easier one.

**AR-02 applies hardest here.** "A test that names a hazard and then does not
touch the code path where the hazard lives is worse than no test." Fifteen
findings collapsing into one door is exactly the shape that produces a vacuous
predicate: a test asserting that `boxWidth = NaN` throws, which passes because
the same tuple also has a null font. **Rule: every door test starts from a
known-good tuple that the same test first asserts does NOT throw, then varies
EXACTLY ONE argument.** A door test without its negative half is not a test.

**D1.** `t1-degenerate.mjs` -- TL-03 (2), TL-04 (2), TL-05 (4), TL-06 (3),
TL-07 (2). Cross every parameter with every degenerate value and pin the
post-door answer for each: throw with a message substring, or a defined result.
Add `lineHeight = 0, boxHeight = 0` -> does NOT throw, returns the unlimited
layout. That row is the one that proves the `lineHeight` door is conditional and
not blanket.
**D2.** `t1-degenerate.mjs` -- TL-09 (7), TL-08 (3). The TL-08 message names
`font.glyphs`, the received `700` and the required `1792`. State the mitigating
fact in the error text and in the decision file: a real `BitmapFont` always
allocates the full table (`../LiteBmfont/BitmapFont.js:19`,
`new Int16Array(256 * 7)`), so this door fires for hand-rolled fonts and
half-built atlases.
**D3.** `t2-capacity.mjs` -- TL-10 (3), the buffer-type rows, now that they have
a policy.
**D4.** `t1-degenerate.mjs` -- TL-14 (3) and TL-24 (1) become passing pins named
for the fact that the behaviour is DELIBERATE.
**D5.** `t0-laws.mjs` -- TL-15 (1): the two `Math.fround` round-trip facts as a
named law.
Check after D: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep 'known-failing='`
-> `known-failing=1 todo=4`, and the T5 line still reads `divergences=40`.

### Phase E/F -- TL-26 and TL-13 (BARRIER 3, one commit)

**E1.** The newline-branch edit in `computeWrap` per TL-26 -- THE EXCEPTION.
**E2.** The matching suppression in `countLines`.
**E3.** `t5-fuzz.mjs` -- delete `knownFailing('TL-26', ...)` and replace it with
`check(divergences === 0, ...)`; the classifier keeps its `tl26=` counter so the
stderr line stays comparable.
**E4.** If the fuzz corpus generates `\r`, `oracle.mjs` gains the CRLF rule in
this same commit and the divergence count is re-read; if it does not, say so in
the session notes rather than assuming.
**E5.** `t1-degenerate.mjs` -- TL-13's three rows promoted: CRLF, AAA-CRLF-BBB,
lone CR.
Check: `known-failing=0 todo=3`, T5 line `divergences=0 (tl26=0 unexpected=0)`.

### Phase G -- widen the instruments

**G1. `t6-alloc.mjs` lane 3.** Delete `todo('T6-lane3', ...)`. Lane 3 is
doors-on-valid-input: the TL-20 paragraph with every argument exercised
(`scale = 2`, a truncating `boxHeight = 64`, an explicit seventh argument) so the
door's full comparison chain runs. Strictly after lanes 1 and 2, never nested --
only one measurement in flight at a time or the profiler throws. `SINK`
accumulate plus `check(SINK > 0, ...)`; `measureAllocs(hot3, { iterations: 2000 })`
-- `iterations` is REQUIRED or it throws RangeError. No lane may call a throwing
path.
Check: `grep -c 'T6-lane3'` in the stderr is 0; `bytesPerCall === 0`.

**G2. `t9-controls.mjs` -- four new controls, each two-direction.** A control
that only proves the gate passes when the code is right proves nothing. For each:
break the mechanism, observe non-zero exit; restore, observe zero; then neuter
the control itself and observe that the broken code passes -- that is the failure
the control exists to prevent. Take the next free indices; do NOT consume the
index reserved by `todo('control-6', ...)`, which is TL3's, and record the
number-to-name mapping in the file header. (The ROADMAP's TL2 line "T9 control 6
exits non-zero" is a stale cross-reference; it is satisfied by the door control
under whatever number it receives.)
  - **door control:** delete the `scale` finiteness check -> exit 1 naming the
    scale row.
  - **shared-door control:** remove the `validateInput` call from `countLines`
    only -> exit 1. This is the instrument that proves the door is actually
    shared and not merely described as shared.
  - **phantom control:** revert the TL-26 suppression -> exit 1 with
    `divergences=40 unexpected=40`.
  - **CRLF control:** revert the CR exclusion -> exit 1 on the CRLF pin.

**G3. `t0-laws.mjs` -- two new laws.** (a) **Scale invariance**, the single
assertion that catches TL-03 through TL-06 at once: for `s` in `{0.5, 2, 4}`
(powers of two ONLY -- 0.1 makes this a float-equality lottery and a flaky gate
is worse than no gate), `computeWrap(text, FONT, bw * s, bh * s, lh, out, s)`
yields identical line counts and identical start/end indices to the `s = 1` run,
and each width equals `s *` the `s = 1` width exactly. (b) Extend
`BOX_HEIGHTS` with `8` so the agreement law actually exercises C4's zero-line
policy -- without that row the policy ships untested by the law that exists to
catch its drift.

**G4. `t7-soak.mjs` -- the throwing path does not retain.** Each of the 4096
cycles additionally makes one call that throws, catches it, `tracker.track`s the
error and `tracker.untrack`s it. T7 is not a measured window so the per-cycle
error allocation is allowed; say so in a comment so it is never copied into T6.
Check: `cycles=4096 trackerSize=0 heapGrowthKB=<n>` with `<n> < 512`. 4096
retained errors with their stacks would not fit under that bound, which is
exactly why this is the right place to ask the question.

**G5. `t2-capacity.mjs`** gains the aliasing pin: disjoint views of one
`ArrayBuffer` do not throw.

### Phase H -- the public surface and the release

**H1. `test/TextLayout.test.js`** -- one new describe group, exactly 14 `it(`
cases, named `'input door, CRLF and the deliberate behaviours'`, appended last:
(1) `TextLayoutError` exported, `instanceof Error`, name correct; (2) `text`
12345 / null / undefined / `['A']`; (3) `font` `{}` / null / undefined;
(4) short glyphs and short kerning; (5) `scale` NaN / Infinity / 0 / -1 throw and
`scale = 2` works; (6) `boxWidth` -1 / -100 / NaN / -Infinity throw and `0` means
no limit; (7) `boxHeight` NaN and negative throw, `0` means no truncation;
(8) `lineHeight` NaN always throws, 0 and -16 throw only when `boxHeight > 0`;
(9) `outBuffer` Int32Array / Float64Array / plain Array / undefined;
(10) `countLines` shares the door -- same five throws, same messages, and no
`outBuffer` check; (11) `boxHeight` under one line returns 0 and leaves the
buffer bit-identical; (12) CRLF lays out identically to LF and a lone CR is one
line; (13) the phantom line is gone AND the deliberate blank line survives;
(14) leading spaces preserved, over-wide glyph emitted, the two 2^24 facts.
Total after: `pass 54`, `fail 0`, 11 suites.

**H2. `TextLayout.d.ts`** -- `TextLayoutError`, the `@throws` tags, the 2^24
ceiling, the TL-12 ellipsis allowance, the corrected TL-14 sentence, the CRLF
rule, the zero-line `boxHeight` rule, the cross-realm caveat.
**H3. `llms.txt`** -- same eight facts, version `1.2.0`.
**H4. `README.md`** -- same eight facts, surgical edit only; the LiteSepforge
spine rebuild is TL4's.
**H5. The source docstring** -- same eight facts. Narrow "runs of leading
whitespace on the next line are skipped" to "after a soft break".
**H6. Version sync to `1.2.0`** in `package.json`, `TextLayout.js:VERSION`,
`llms.txt`.
**H7. `CHANGELOG.md`, `## 1.2.0`** -- Added: `TextLayoutError`, the input door.
Changed: the fifteen policies, each with its letter. Fixed: TL-26, TL-13.
Measured: the door's per-call delta against P7 and the T6 lane-3 `bytesPerCall
0`, stamped with `1.2.0` and the node version. Known issues shrinks by exactly
fourteen findings. Semver: MINOR (new export, new throws on input that was
previously accepted and silently wrong), pointing at
`decisions/0002-input-door.md`. The counter-argument -- "a throw where there was
none is breaking for a caller relying on the silent path" -- is written out and
answered: the silent path produced NaN widths and no wrapping.

---

## HOT PATH

`computeWrap` is one linear pass; TL-20 proves it allocates nothing and TL-21
proves it reads 1.14 glyph entries per character. Both survive this session or
the session failed.

- **Every check runs ONCE, at function entry, before the loop.** Not one new
  branch enters the per-character body. `font.glyphs.length` and
  `font.kerning.length` are read once at the door, never per character; the loop
  keeps indexing the tables directly.
- **The only permitted loop change is inside the `id === 10` branch**, which runs
  once per line. One `charCodeAt` read into a local, reused by both the TL-26
  suppression and the TL-13 end index.
- Bytes in a hot body, not instructions: a branch that fires on one call in a
  thousand still occupies the loop's instruction cache every iteration.
- No pre-built shared error. No `try`/`catch` anywhere in either entry point.

**The witness.** A `sed` line range does not work: `countLines` copies
`computeWrap`'s loop header verbatim, so a range spans both loops. TL1 used
`awk` with `exit` to grab the first loop; TL2 needs both, separately.

```sh
nthloop () { awk -v n="$2" '/^        for \(let i = 0; i < len; i\+\+\) \{$/{c++} c==n{print} c==n&&/^        \}$/{if(c==n)exit}' "$1"; }
strip10 () { sed '/-- 1. Explicit newline/,/^            }$/d'; }

# (a) both loops, newline branch removed -> EMPTY, both times
diff <(nthloop $SCRATCH/TextLayout.js.pre 1 | strip10) <(nthloop TextLayout.js 1 | strip10)
diff <(nthloop $SCRATCH/TextLayout.js.pre 2 | strip10) <(nthloop TextLayout.js 2 | strip10)
# (b) the newline branch alone -> NON-EMPTY, both times (else nothing was fixed)
diff <(nthloop $SCRATCH/TextLayout.js.pre 1) <(nthloop TextLayout.js 1) | grep -c '^[<>]'
```

(a) producing output means a door check leaked into the loop. (b) producing zero
means the `strip10` range is eating the change and (a) is vacuous. Both
directions are required; either alone is a witness that cannot fail.

The witness was exercised against the shipped 1.1.0 file while this brief was
written: the two loop headers are at `TextLayout.js:119` and `:310`, loop 1
extracts to 123 lines and loop 2 to 65, the two are NOT identical, and `strip10`
removes 26 lines from loop 1. If those numbers do not reproduce at P1, the regex
has drifted and the witness is void -- fix it before Phase C, not after.

Second witness: T6 lane 1 reports `bytesPerCall === 0`, `major === 0`,
`minor === 0`, `arrayBuffers` growth 0 against `$SCRATCH/tl20.pre.json`. The
timing may move -- the door is real per-call work -- so lane 1's wall time is
recorded and compared, not asserted equal: a delta above 5% on the 20,000-op
window is a STOP-and-report, not a shrug.

---

## ASSERTIONS

Each is a command with an exact expected result. Widths use the P9 advances
('A' = 12, ' ' = 6, CR = 0). Every layout literal below was EXECUTED against the
shipped 1.1.0 file while this brief was written; the "today" values are
measured, not remembered.

1. `npm test` -> `pass 54`, `fail 0`, `suites 11`, exit 0.
2. `node --expose-gc test/torture.mjs 2>/dev/null | od -c | head -1` -> `o k \n`, exit 0.
3. `TEXTLAYOUT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` -> exit 1,
   stdout empty. `node test/torture.mjs` (no `--expose-gc`) -> exit 1.
4. **The ledger:** `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep 'known-failing='`
   -> `torture: known-failing=0 todo=2`. From 35 and 5. The two survivors are
   `TL-25` and `control-6`, both TL3's.
5. `diff $SCRATCH/ids.pre.txt $SCRATCH/ids.post.txt` removes exactly `TL-03`,
   `TL-04`, `TL-05`, `TL-06`, `TL-07`, `TL-08`, `TL-09`, `TL-10`, `TL-12`,
   `TL-13`, `TL-14`, `TL-15`, `TL-24`, `TL-26`, `T6-lane3` and the aliasing todo,
   and **adds nothing**. A new `knownFailing` entry added by this session is a
   REJECTED unless the decision file names its owning session.
6. **The scope tripwire, three readings:** after B `divergences=40`; after D
   `divergences=40`; after F `T5 cases=50000 divergences=0 (tl26=0 unexpected=0)`
   and `badvalue=0 bothflags=0` at every one of the three.
7. **The door, message-exact.** From the known-good tuple
   `('AAA BBB', FONT, 100, 0, 16, out, 1)` which the same test asserts returns 1
   without throwing, varying one argument at a time:
   `scale = NaN` -> `TextLayoutError` whose message contains `scale` and `finite`;
   `scale = 0` and `scale = -1` -> message contains `scale` and `> 0`;
   `boxWidth = -100` -> contains `boxWidth` and `negative`;
   `boxWidth = NaN` -> contains `boxWidth` and `finite`;
   `font.glyphs = new Int16Array(700)` -> contains `font.glyphs`, `700`, `1792`;
   `font = {}` / `null`, `text = 12345` / `null` / `['A']` -> `TextLayoutError`,
   and the message does NOT match `/Cannot read properties/`.
8. **The door is conditional where it says it is.**
   `computeWrap('AAA', FONT, 0, 0, 0, out)` returns 1 and does NOT throw
   (`lineHeight = 0` with no box height is unused);
   `computeWrap('AAA', FONT, 0, 32, 0, out)` throws naming `lineHeight`;
   `computeWrap('AAA BBB', FONT, 0, 0, 16, out)` returns 1 with `[0,7,78,0]`
   (`boxWidth = 0` still means no limit; measured, unchanged).
9. **Buffer types:** `Int32Array(16)`, `Float64Array(16)`, `new Array(16)` and
   `undefined` each throw naming `outBuffer` and `Float32Array`; `countLines`
   with the same five leading arguments does not throw.
10. **TL-07:** `computeWrap('AAA', FONT, 0, 8, 16, out)` -> `0` (today it returns
    `1` with `[0,3,36,0]`), and a POISON-prefilled buffer is bit-identical
    afterwards. `countLines('AAA', FONT, 0, 8, 16)` -> `0` (today `1`).
11. **TL-13:** `computeWrap('AAA\r\nBBB', FONT, 0, 0, 16, out)` -> `2` with slots
    `[0,3,36,0, 5,8,36,0]`. Today it is `[0,4,36,0, 5,8,36,0]` -- endIdx `4`
    puts the CR INSIDE the range, which is the bug. The LF-only control
    `'AAA\nBBB'` is `[0,3,36,0, 4,7,36,0]` today and must not move.
    `computeWrap('AAA\rBBB', FONT, 0, 0, 16, out)` -> `1` with `[0,7,72,0]`
    (today, and unchanged: lone CR stays in range, zero advance). The test first
    asserts `FONT.glyphs[13*7+6] === 0`, or the width pin is measuring the atlas.
12. **TL-26 both directions, both measured:**
    `computeWrap('AAA \nBBB', FONT, 40, 0, 16, out)` -> `2` with
    `[0,3,36,0, 5,8,36,0]`; today it is `3` with `[0,3,36,0, 4,4,0,0, 5,8,36,0]`.
    `countLines('AAA \nBBB', FONT, 40, 0, 16)` -> `2`; today `3`.
    `computeWrap('AAA\n\nBBB', FONT, 0, 0, 16, out)` -> `3` with
    `[0,3,36,0, 4,4,0,0, 5,8,36,0]` -- UNCHANGED from today. The deliberate blank
    line survives because `text.charCodeAt(lineStart - 1)` is `10`, not `32`.
    That is the discriminator the whole fix rests on, and both sides of it were
    executed before this brief was written, not reasoned about.
13. **TL-14 and TL-24, deliberate, all measured and all UNCHANGED:**
    `computeWrap('   ', FONT, 0, 0, 16, out)` -> `1` with `[0,3,18,0]`;
    `'   AAA'` -> `1` with `[0,6,54,0]`;
    `computeWrap('A', FONT, 4, 0, 16, out)` -> `1` with `[0,1,12,0]` -- a
    12px line in a 4px box, emitted and unflagged.
14. **TL-15:** `Math.fround(16777217) === 16777216` and
    `Math.fround(16777219) === 16777220` are pinned by name, and `2^24` /
    `16777216` appears in `TextLayout.js`, `TextLayout.d.ts`, `llms.txt` and
    `README.md` -- `grep -lc '16777216'` matches all four.
15. **The drift mutations, one per shared mechanism.** (a) remove the
    `validateInput` call from `countLines` -> exit 1; (b) delete one
    `lastSpaceWidth` reset -> exit 1 naming T5 or the T0 agreement law;
    (c) revert the TL-26 suppression in `countLines` only -> exit 1 naming the
    agreement law. Revert each; `shasum -a 256 TextLayout.js` returns to its
    post-session value after every one.
16. **Scale invariance** holds across the whole T0 corpus and all 50,000 T5
    cases for `s` in `{0.5, 2, 4}`: 0 violations.
17. **GC budget:** all three T6 lanes report `verdict: 'pass'`, `source: 'gc'`,
    `major === 0`, `minor === 0`, `maxMs < 4`, `arrayBuffers` growth 0 at
    `ops: 20000, warmup: 1000, stabilize: 'deep'`, and
    `measureAllocs(fn, { iterations: 2000 })` -> `bytesPerCall === 0`,
    `settled === true`, with `SINK > 0` on lanes 2 and 3. Lane 1's wall time is
    within 5% of P7.
18. **Retention:** T7 runs 4096 cycles, each including one caught
    `TextLayoutError`; `tracker.size() === 0` after the last cycle;
    `heapUsed` growth sampled at cycle boundaries after `globalThis.gc()` is
    under 512 KB (pre-flight measured 36 KB); `out.buffer.byteLength` identical
    before and after every measured T6 window.
19. **Controls fire, both directions**, for each of the four new controls and
    for the `scanFlags` control: break the mechanism -> exit 1; restore -> exit
    0; neuter the control with the mechanism still broken -> exit 0, which is
    the failure the control exists to prevent. Revert and confirm each file is
    byte-identical.
20. **Hot path:** witness (a) produces no output for both loops; witness (b)
    produces a non-zero count for both loops.
21. **ASCII gate:**
    `for f in TextLayout.js TextLayout.d.ts llms.txt README.md CHANGELOG.md test/TextLayout.test.js package.json LICENSE.txt decisions/0002-input-door.md; do LC_ALL=C grep -c '[^ -~\t]' "$f"; done`
    prints `0` nine times. The attribution check is
    `grep -l 'Karadjov' TextLayout.js TextLayout.d.ts llms.txt README.md CHANGELOG.md LICENSE.txt package.json`
    -> no match, exit 1. **Scoped to the shipped files on purpose.** A recursive
    `grep -rc 'Karadjov' .` matches this brief, which names the word in order to
    forbid it, and then fails on a clean tree. TL0 shipped exactly that bug in
    its assertion 16 and the coder was right to refuse to edit a planning doc to
    make a grep pass. Same for the ASCII sweep: it lists files, it does not
    recurse. `LICENSE.txt` must read `Zahary Shinikchiev`.
22. **Packaging:** `npm pack --dry-run 2>&1 | grep -c 'test/\|decisions/\|briefs/'`
    is 0; `CHANGELOG.md` listed once;
    `node -p "require('./package.json').version"` prints `1.2.0` and
    `VERSION === '1.2.0'`.
23. `perl -e 'alarm 300; exec @ARGV' node --expose-gc test/torture.mjs`
    completes; wall time under 30 s (TL1 measured 1.76 s). If the new corpus
    work pushes it past 30 s, say so in the CHANGELOG -- do not silently shrink T5.

---

## LEDGER RECONCILIATION

The arithmetic TL2 must satisfy, checked against `$SCRATCH/labels.pre.txt`:

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

Separately, the decision file carries a 27-row table covering `TL-01` through
`TL-27`, each ID in exactly one of four buckets -- closed in TL0/TL1, closed
here by code, closed here by documentation plus a pin, deferred with a named
owning session. No ID in two buckets, no gap in the range. TL1's QA caught a
15-versus-20 mismatch at exactly this step; the table is what makes the mismatch
impossible to hide. **If a task in this brief cannot account for one of the 35
labels, say so IN the session notes and stop -- do not drop it.**

---

## NON-GOALS

No cross-package work and no bmfont devDependency (TL3). No T8 contents; TL-25
stays a todo. No README spine rebuild (TL4). **No change to the wrapping
algorithm beyond the single carved exception in the `id === 10` branch** -- the
doors decide what enters the loop, not what the loop does. No new flag value. No
sentinel returns; the door throws or the function returns a defined result. No
`outBuffer === null` branch. No per-glyph anything, ever. No defensive
per-iteration progress guard in `countLines` (TL-27's comment asks the question;
the answer is no, and the comment updates to say TL2 answered it). No
performance work on the linear pass. No `try`/`catch` in either entry point.

---

## RISKS AND THEIR CHECKS

**R1 -- the knownFailing bombs, thirty-five of them.** Between each door check
and its promotion the suite is red by design. Mitigation: THE ORDER's group-by-
group rhythm keeps the red window one group wide, and assertions 4 and 5 prove
entries were promoted rather than deleted.

**R2 -- a vacuous door test.** The dominant failure shape for this session
(AR-02). Mitigation: the known-good-tuple rule in Phase D, and every door
assertion in 7 and 8 carries its negative half.

**R3 -- TL-26 over-suppresses.** The predicate could eat a deliberate blank
line. Mitigation: assertion 12's second half, the `t1-degenerate` row, and 50,000
fuzz cases against an oracle that was written before the fix existed.

**R4 -- the CRLF rule costs measurable time.** Mitigation: T6 lane 1 against P7
with a stated 5% ceiling and a pre-agreed fallback (CRLF reverts to policy C;
TL-26 does not).

**R5 -- the door throws inside an existing corpus.** T0/T2/T5 may feed values the
door now rejects. Mitigation: BARRIER 2 requires the full gate green with
`divergences=40` before TL-26 is touched, so a corpus collision surfaces while
only one variable has moved.

**R6 -- `countLines` and `computeWrap` drift** across a fifteen-finding edit.
Mitigation: one shared validator, the duplicated TL-07 exit covered by the
agreement law with `boxHeight = 8` added (G3b), and the shared-door control
(G2) which is the only instrument that proves the sharing is real.

**R7 -- the error class retains.** 4096 stacks would be visible. Mitigation: G4
and assertion 18.

---

## DONE WHEN

```
npm test                                                 -> 54 pass, 0 fail, 11 suites
node --expose-gc test/torture.mjs                        -> prints exactly "ok", exit 0
TEXTLAYOUT_TORTURE_BREAK=1 \
  node --expose-gc test/torture.mjs                      -> exits non-zero
node --expose-gc test/torture.mjs 2>&1 >/dev/null \
  | grep 'known-failing='                                -> known-failing=0 todo=2
node --expose-gc test/torture.mjs 2>&1 >/dev/null \
  | grep 'T5 cases='                                     -> cases=50000 divergences=0 (tl26=0 unexpected=0)
                                                            flagslots=<n> badvalue=0 bothflags=0
node --expose-gc test/torture.mjs 2>&1 >/dev/null \
  | grep 'T7 cycles='                                    -> cycles=4096 trackerSize=0 heapGrowthKB<512
```

and, at the file level: every degenerate input either throws a `TextLayoutError`
naming the argument and the requirement, or has a pinned documented result; one
shared validator serves both entry points and a control proves the sharing;
the per-character loop body is diff-identical apart from the `id === 10` branch,
proven by both halves of the two-loop `awk` witness; the phantom line is gone and
the deliberate blank line is not; CRLF lays out identically to LF; the 2^24
ceiling, the ellipsis allowance, the leading-whitespace correction and the
cross-realm caveat appear in all four documentation surfaces; 0 bytes/op on all
three T6 lanes, measured, not assumed; `decisions/0002-input-door.md` carries all
fifteen policies, the TL-26 exception with its reason, and the 27-row
reconciliation; `VERSION`, `package.json` and `llms.txt` all read `1.2.0`.
