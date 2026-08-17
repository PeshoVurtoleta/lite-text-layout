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

# TL1 -- lite-text-layout v1.1.0 -- an undersized buffer must say so

## PURPOSE

`computeWrap` caps the line count at `floor(outBuffer.length / 4)` and, in the
words of its own docstring, "extra content is silently dropped." That is
fail-OPEN: the caller gets a buffer byte-for-byte identical to a correct short
layout, renders a truncated paragraph that looks deliberate, and has no way to
find out. TL0 pinned that indistinguishability as an executable `knownFailing`
entry. TL1 removes it.

Three findings close here and nothing else does. TL-01: overflow becomes
observable via `FLAG_OVERFLOW = 2` on the last written line. TL-02: `countLines`
gives the caller a way to size the buffer so overflow never happens. TL-11:
`Object.freeze(TextLayout)`. Every other finding stays exactly as TL0 recorded
it -- TL1 is not a general clean-up session and the T5 divergence count is the
tripwire that proves it.

Two words that are not the same problem. `FLAG_TRUNCATED` means "the TEXT did
not fit the BOX" -- a designed outcome, ellipsis included. `FLAG_OVERFLOW` means
"the BUFFER did not fit the TEXT" -- a caller bug being reported. Do not merge
them.

## PRE-FLIGHT (this is the before-side of half the assertions)

Still no `.git` in this tree. Recorded copy plus `diff`, exactly as TL0 did.

```
SCRATCH=/private/tmp/claude-502/-Users-zakkster-Work-Portfolio-LiteLibrariesSuite-LiteTextLayout/8f441064-ff8f-43c2-839d-7b11a9dce312/scratchpad
```

P1. `cp TextLayout.js $SCRATCH/TextLayout.js.pre` and
    `shasum -a 256 TextLayout.js > $SCRATCH/TextLayout.js.sha.pre`. This copy is
    the only witness the HOT PATH section has. **Overwrite the TL0-era copy --
    the pre-side of this session is the shipped 1.0.2 file, sha
    `555b2969c9fe44855e0941858603f20035c0f5ded68247fb34bedcd742798688`.**
P2. `npm test 2>&1 | tee $SCRATCH/test.pre.txt`. Expect `pass 31`, `fail 0`,
    9 suites. If it is not 31, STOP and report.
P3. `npm run torture 2>$SCRATCH/torture.pre.err 1>$SCRATCH/torture.pre.out`.
    Expect `$SCRATCH/torture.pre.out` to be exactly `ok\n` and exit 0.
P4. Freeze the bookkeeping baseline, because silently dropping an entry is the
    TL0 QA failure mode this session is most exposed to:
    `grep -o 'KNOWN-FAILING -- [^ (]*\|TODO -- [^:]*' $SCRATCH/torture.pre.err | sed 's/.*-- //' | sort -u > $SCRATCH/ids.pre.txt`
    and `grep 'known-failing=' $SCRATCH/torture.pre.err`. Expect
    `known-failing=37 todo=9`.
P5. Record the T5 line: `grep 'T5 cases=' $SCRATCH/torture.pre.err`. Expect
    `cases=50000`, `divergences=40`, all classified TL-26, `unexpected=0`. That
    40 is the "TL1 did not wander into TL2's code" tripwire. Whatever the
    recorded number is, it is the number required after.
P6. Copy the T6 lane-1 numbers from `$SCRATCH/tl20.pre.json` into this session's
    notes: `verdict: 'pass'`, `source: 'gc'`, major 0, minor 0, `maxMs` 0.000,
    `arrayBuffers` growth 0, `bytesPerCall` 0, `settled` true.
P7. `grep -n '1\.0\.2' test/TextLayout.test.js TextLayout.d.ts llms.txt README.md package.json`
    -- every hit is a version pin that Phase E must move to `1.1.0`.

---

## THE OVERFLOW CONTRACT (settle this before touching the file)

**Definition, and it is the only one used anywhere in this session:**

> `FLAG_OVERFLOW` is set on the last written line if and only if the same call
> made against an unbounded buffer would have produced MORE lines. Equivalently:
> iff `countLines(text, font, boxWidth, boxHeight, lineHeight, scale) > floor(outBuffer.length / 4)`.

Everything below follows from that, and every law in ASSERTIONS tests exactly
that sentence.

### The three places the buffer-full condition is observable

Line numbers are the shipped 1.0.2 file, verified: line 69 is
`if (maxLines === 0) return 0;`, line 93 is `if (lineCount >= maxLines) break;`,
line 217 is `if (lineCount < maxLines && lineStart < len) {`.

**(A) Zero capacity -- line 69, `if (maxLines === 0) return 0;`.** No line was
written, so there is no flags slot to put anything in. **Contract: return 0,
unchanged, and write nothing.** The caller detects it as
`n === 0 && typeof text === 'string' && text.length > 0`, which is documented in
the docstring, the d.ts and llms.txt. Do NOT throw (that is TL2's door), do NOT
return `-1` (no sentinel -- non-goal), do NOT write into a buffer of length 1..3
(there is no whole stride and a partial write is worse than silence). This early
return keeps its exact position and text.

**(B) The loop break -- line 93, `if (lineCount >= maxLines) break;`.** This
line does not move and does not gain a statement. Note the invariant that makes
the cold path work: at the top of every iteration `lineStart <= i < len`
(after a soft break `i = nextStart - 1` and `lineStart = nextStart`; after a
hard break `lineStart = i` and the `continue` advances; after a newline
`lineStart = i + 1` and the `continue` advances). So whenever this break fires,
`lineStart < len` and `lineCount === maxLines`.

**(C) The suppressed remainder flush -- line 217,
`if (lineCount < maxLines && lineStart < len)`.** The flush is skipped for
capacity reasons exactly when `lineCount >= maxLines && lineStart < len`.
`lineCount` never exceeds `maxLines` (every in-loop increment is downstream of
the break, the flush increment is guarded), so that is `lineCount === maxLines`.

**(B) and (C) are the same post-loop condition.** That is the whole trick: one
test, evaluated once per call, after the loop, on the cold side. The tail
becomes

```js
if (lineStart < len) {
    if (lineCount < maxLines) {
        outBuffer[ptr++] = lineStart;
        outBuffer[ptr++] = len;
        outBuffer[ptr++] = cursorX;
        outBuffer[ptr++] = FLAG_NORMAL;
        lineCount++;
    } else {
        outBuffer[ptr - 1] = FLAG_OVERFLOW;
    }
}
return lineCount;
```

`ptr === 4 * lineCount` on every path that reaches the tail (each write site
writes exactly four slots; the two truncation sites write four and `return`
immediately, so they never reach here), so `ptr - 1 === 4 * maxLines - 1` is the
flags slot of the last written line, and `maxLines >= 1` here because zero
capacity returned at (A). No new local, no new prologue byte, no per-character
branch, and the loop body is untouched. **No `overflowed` boolean.** A flag
variable would cost a prologue store and a store at the break site for a
condition that is already recoverable from `lineStart`, `lineCount` and
`maxLines`.

### The truncation interaction: unreachable, and provably so

The two in-loop truncation `return`s each write four slots and
`return lineCount + 1`. At both sites the top-of-loop break has already
guaranteed `lineCount <= maxLines - 1`, so `ptr + 4 <= 4 * maxLines`:
**a truncation return can never overrun the buffer.** And an unbounded run takes
identical branches (nothing in the loop reads `maxLines` except the break), so
it also returns `lineCount + 1 <= maxLines`. By the definition above there is no
overflow on a truncating call.

Therefore `FLAG_TRUNCATED` and `FLAG_OVERFLOW` **cannot both appear in one
call's output**. Write the precedence rule down anyway -- FLAG_OVERFLOW wins,
because truncation is a designed outcome and overflow is a caller bug that must
be heard -- and then assert the combination is unreachable rather than
implementing a resolution for it. Note the one case that looks like a conflict
and is not: if the break fires on an iteration where an unbounded run would have
truncated, the unbounded run yields `maxLines + 1` lines, the definition says
overflow, the code writes `FLAG_OVERFLOW`, and the caller loses the ellipsis on
a layout that was wrong anyway. Consistent.

### The prefix law (what the caller keeps)

A partial layout is preserved and it is a true prefix: for capacity `m` lines,
the output equals the first `m` lines of the unbounded run, byte-identical
except slot `4m - 1`, which is `FLAG_OVERFLOW` when `countLines > m` and equal
otherwise. This is why the flag beats a sentinel return -- the work is still
usable.

## THE `countLines` CONTRACT

```
countLines(text, font, boxWidth, boxHeight, lineHeight, scale = 1.0) -> number
```

Same parameters, same order as `computeWrap`, minus `outBuffer`. The
`boxHeight`-less signature from the old roadmap is rejected: without it the
function cannot agree with `computeWrap` on any truncating call, and agreement
is the entire product.

A SECOND function, not an `outBuffer === null` branch inside `computeWrap` --
a null check per emitted line would be cheap but it makes the hot call site
polymorphic on a parameter that is `null` for a whole class of callers. And NOT
`computeWrap` against a scratch buffer: a scratch buffer has a capacity and
therefore reintroduces TL-01 inside the function that exists to prevent it.

The duplication is real and it is bounded, because most of `computeWrap` is
output machinery. Delete, do not port: `outBuffer`, `maxLines`, `ptr`, every
`outBuffer[ptr++]`, the top-of-loop break, `lastSpaceWidth`, `dotPtr`,
`dotAdvance`, `ellipsisWidth`, `lastSafeEllipsisIdx`, `lastSafeEllipsisWidth`
and both `safe` expressions. **Verify before deleting the ellipsis machinery:
`lastSafeEllipsisIdx` and `lastSafeEllipsisWidth` are written in the advance
block and in the hard-break reseed, and read only inside the two `safe`
ternaries -- they never influence a wrapping or truncation decision.** If that
is not true after the coder re-reads it, keep them and say so. The two
truncation branches collapse to `return lineCount + 1;`. Everything that decides
where a line ends is ported verbatim: the newline branch, the advance and
kerning, the `lastSpace` candidate, the wrap test, the space-eater, the
hard-break reseed, and the remainder flush becomes
`if (lineStart < len) lineCount++;`. Result is roughly 38 lines.

Drift between the two implementations is caught by exactly one instrument, and
it is required to be a real instrument, not a decorative one: the T0 agreement
law, over the 512-case corpus crossed with a boxHeight sweep, plus all 50,000 T5
cases with a per-case boxHeight. It compares `countLines(...)` against
`computeWrap(..., OUT_BIG)` where `OUT_BIG` is `Float32Array(4 * 1024)`, and it
additionally requires that no line of the `computeWrap` result carries
`FLAG_OVERFLOW` -- an agreement law that compares two capped numbers is vacuous.
The mutation proof that the law is not vacuous is T9 control 3.

---

## TASKS

### Phase A -- the decision record, before any code

**A1. `decisions/0001-flag-overflow.md`.** File: `decisions/0001-flag-overflow.md`.
Records: the MINOR verdict with its three-point argument (value 2 is reachable
only on a call that is already wrong today; `BitmapFont.drawWrapped` reads the
field by equality at `../LiteBmfont/BitmapFont.js:361`, `if (flags === 1)`, so a
2 falls through to no ellipsis, which is exactly right; the residual risk is a
consumer whose `if/else` treats "not 0" as truncated and draws an ellipsis on an
overflow line, which is cosmetic and confined to the already-broken case). Then
**the counter-argument, written out, not gestured at**: the documented value
space grew, an exhaustive `switch` over `{0, 1}` now has an unhandled arm, and
someone will call that breaking. Then the resolution and the law it produces:
**law 6 -- flags are a value space; compare by equality, never by truthiness.**
Then the zero-capacity contract from (A) above and the FLAG_OVERFLOW-wins
precedence rule with its unreachability proof.
`decisions/` is a planning artifact and does NOT enter `files[]`.
Check: `test -f decisions/0001-flag-overflow.md && LC_ALL=C grep -c '[^ -~\t]' decisions/0001-flag-overflow.md` prints `0`.

### Phase B -- the source change (TL-01, TL-02, TL-11)

**B1. `export const FLAG_OVERFLOW = 2;`** immediately after `FLAG_TRUNCATED`,
with a docstring stating the distinction from `FLAG_TRUNCATED` in one sentence
and pointing at the decision record. File: `TextLayout.js:FLAG_OVERFLOW`.
Finding: TL-01.
Check: `node -e "import('./TextLayout.js').then(m=>process.exit(m.FLAG_OVERFLOW===2&&m.FLAG_TRUNCATED===1&&m.FLAG_NORMAL===0?0:1))"` exits 0.

**B2. The tail restructure.** Replace the flush block at lines 217-223 with the
`if (lineStart < len) { ... } else { outBuffer[ptr - 1] = FLAG_OVERFLOW; }` form
given in THE OVERFLOW CONTRACT, verbatim. **Nothing between line 64 and line 214
changes.** File: `TextLayout.js:computeWrap`. Finding: TL-01.
Check: a 3-line text into `Float32Array(4)` returns 1 with slot 3 equal to
`FLAG_OVERFLOW`.

**B3. `countLines`.** Added to the `TextLayout` namespace object, **after**
`computeWrap`, per THE `countLines` CONTRACT. Full JSDoc: same parameter list,
the return value, and one line saying that `new Float32Array(countLines(...) * 4)`
is the buffer size that can never overflow. File: `TextLayout.js:countLines`.
Finding: TL-02.
Check: `node -e "import('./TextLayout.js').then(m=>process.exit(m.TextLayout.countLines.length===5?0:1))"` exits 0 (five declared parameters; `scale` has a default and is not counted).

**B4. `Object.freeze(TextLayout);`** as a single statement immediately after the
namespace object literal. This is settled and pre-measured -- 50,000
`computeWrap` calls, 87.5 ms unfrozen against 87.9 ms frozen, a 0.4% delta that
is noise, with T6 reporting `verdict: pass` under the freeze. Do not re-measure
it as a blocker; do run T6 after, against P6. File: `TextLayout.js`.
Finding: TL-11.
Check: `node -e "import('./TextLayout.js').then(m=>process.exit(Object.isFrozen(m.TextLayout)?0:1))"` exits 0.

**B5. The docstring.** Delete "extra content is silently dropped." Replace with
the overflow contract: the flag, the last-written-line rule, the zero-capacity
`return 0` and how a caller detects it, the mutual exclusivity with
`FLAG_TRUNCATED`, the prefix guarantee, and a pointer to `countLines`. Update
the file-header `Flags:` line to list all three values.
File: `TextLayout.js` (comments only).
Check: `grep -c 'silently dropped' TextLayout.js` is 0; `grep -c 'FLAG_OVERFLOW' TextLayout.js` is >= 4.

### Phase C -- retire the entries this session fixes

Every one of these six is a bomb: `knownFailing` calls `die()` when its
predicate goes false, so B1-B4 break the suite until this phase lands.
Doing them in one pass, listed exhaustively, is the point. Each of the six is a
single occurrence in the current run, verified, so the arithmetic in assertion 4
is exact.

**C1. `t2-capacity.mjs` -- promote TL-01.** Delete the
`knownFailing('TL-01 ...')` block and replace it with named passing checks,
**both directions**:
(a) the 10-line text into `Float32Array(12)` returns 3 and slot 11 is
`FLAG_OVERFLOW`; (b) `'AAA BBB CCC'` into the same size returns 3 and slot 11 is
`FLAG_NORMAL` -- an always-on flag is noise, not a fix; (c) the two buffers now
differ, and differ **only** in slot 11; (d) the exact-fit row additionally
asserts no slot in `0..11` equals `FLAG_OVERFLOW`; (e) the `4n+3` row returns 2
with `partial[7] === FLAG_OVERFLOW`; (f) the oversized row keeps its untouched
tail and gains "no line carries FLAG_OVERFLOW"; (g) capacities 0, 1, 2, 3 return
0 **and leave a POISON-prefilled buffer bit-identical**; (h) the prefix law
exhaustively: for the 10-line text at `boxWidth 40` and capacities `m = 1..12`,
the `4m`-buffer output equals the first `m` lines of the `Float32Array(80)`
output except slot `4m - 1`, which is `FLAG_OVERFLOW` for `m < 10` and
`FLAG_NORMAL` for `m >= 10`; (i) mutual exclusivity: a truncating call
(`boxHeight = 32, lineHeight = 16`) into a 2-line buffer returns 2, the last
line is `FLAG_TRUNCATED`, and no slot is `FLAG_OVERFLOW`.
File: `test/torture/t2-capacity.mjs:run`. Finding: TL-01.
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'TL-01'` is 0 and the run exits 0.

**C2. `t0-laws.mjs` -- law 9 becomes the agreement law.** Delete the
`check(typeof TextLayout.countLines === 'undefined', ...)` guard and the
`todo('TL-02', ...)`. Law 9 now runs inside the existing per-case loop, over
`BOX_HEIGHTS = [0, 16, 32, 48, 1e9]` with `LH = 16`: for each `bh`,
`countLines(text, FONT, boxWidth, bh, LH, scale)` equals
`computeWrap(text, FONT, boxWidth, bh, LH, OUT_BIG, scale)`, and no line of that
`computeWrap` result carries `FLAG_OVERFLOW` (otherwise the comparison is
vacuous -- `die` with "OUT_BIG too small, the agreement law is not measuring
anything"). `OUT_BIG` is `Float32Array(4 * 1024)` allocated at module load.
Law 10, new: **the sizing round trip.** `const need = countLines(...)`, then
`computeWrap` into an exact-size `Float32Array(4 * need)` returns `need` and
carries no `FLAG_OVERFLOW`. T0 is not a measured tier, so the per-case
allocation is allowed here; say so in a comment so it is not copied into T6.
Update the file-header law list from nine laws to ten.
File: `test/torture/t0-laws.mjs:run`. Finding: TL-02.
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'TL-02'` is 0.

**C3. `t9-controls.mjs` -- promote TL-11.** Replace
`knownFailing('TL-11', () => Object.isFrozen(TextLayout) === false)` with
`check(Object.isFrozen(TextLayout), ...)` plus: assignment to
`TextLayout.computeWrap2` throws `TypeError` in strict mode (the tier is an ESM
module, so it is already strict -- assert the throw, do not assert a silent
no-op), and `delete TextLayout.computeWrap` throws. Keep the throwaway-object
half of control 5 that proves the detector itself works.
File: `test/torture/t9-controls.mjs:run`. Finding: TL-11.
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'TL-11'` is 0.

**C4. `t9-controls.mjs` -- control 3, for real.** Delete
`todo('control-3', ...)`. Build `countLinesStub = (t, f, bw, bh, lh, s) =>
TextLayout.computeWrap(t, f, bw, bh, lh, STUB4, s)` with `STUB4` a
`Float32Array(4)` allocated once, run the **same comparator function** the T0
agreement law uses (extract it into `harness.mjs` as `agreeCount(fnCount, cs)`
so control 3 cannot accidentally test a different, weaker comparison) over a
32-case corpus that includes a case wrapping to more than one line, and `die` if
the comparator reports zero mismatches. That is the mutation proof that the
agreement law is not vacuous on exactly the input TL-02 exists for.
File: `test/torture/t9-controls.mjs:run`, `test/torture/harness.mjs:agreeCount`.
Check: temporarily raise `STUB4` to `Float32Array(4096)`; a plain
`node --expose-gc test/torture.mjs` exits 1 with the control-3 message. Revert.

**C5. `t9-controls.mjs` -- control 4, for real.** Delete
`todo('control-4', ...)`. Write the overflow detector as a function of the
buffer contents alone -- "the last written line of a capped run carries
FLAG_OVERFLOW" -- and prove it fires by feeding it a hand-built
`Float32Array(12)` whose slot 11 is `FLAG_NORMAL` while the corresponding
`countLines` is 10. `die` if the detector accepts that buffer.
File: `test/torture/t9-controls.mjs:run`.
Check: neuter the detector to `return true`; the run exits 1. Revert.

**C6. `t6-alloc.mjs` -- lane 2, for real.** Delete `todo('T6-lane2', ...)`.
Add lane 2, strictly after lane 1 and never nested:

```js
let SINK = 0;                                          // module scope
const hot2 = () => { SINK += TextLayout.countLines(TL20_TEXT, FONT, 200, 0, 16);
                     if (BREAK) leak.push(new Float64Array(64)); };
const { report: r2 } = runOpsGate(hot2, { ops: 20000, warmup: 1000 });
const { report: a2 } = runAllocGate(hot2, { iterations: 2000 });
check(SINK > 0, () => 'T6 lane2: SINK is 0 -- the call was optimised away');
```

The `SINK` accumulate is a number store, not an allocation; it exists so a
dead-code-eliminated call cannot pass as a zero-alloc call. Lane 1 keeps its
exact TL-20 shape and its numbers are compared to `$SCRATCH/tl20.pre.json`.
Keep `todo('T6-lane3', ...)` -- that is TL2's.
File: `test/torture/t6-alloc.mjs:run`. Findings: TL-02, TL-20.
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'T6-lane2'` is 0.

### Phase D -- widen the corpus laws (no new findings, no new fixes)

**D1. `t5-fuzz.mjs` -- agreement and sizing over all 50,000 cases.** Per case,
after the existing oracle comparison and outside it: draw
`bh = BOX_HEIGHTS[prng() % 5]`, assert `countLines === computeWrap(..., OUT_BIG, ...)`,
then draw `m = 1 + (prng() % (need + 1))`, run into a fixed-capacity buffer and
assert the prefix law plus the FLAG_OVERFLOW iff. **`OUT_BIG.subarray` allocates
a view object per case -- use a pre-built array of 8 fixed-capacity buffers
indexed by `m` clamped to 8 instead.** T5 is not a measured window, but the
harness rule about per-iteration allocation still holds and a 50,000-view churn
is exactly the shape T6 exists to forbid. **The oracle is not touched and its
domain stays `boxHeight = 0`.**
File: `test/torture/t5-fuzz.mjs:run`.
Check: the T5 stderr line still reads `cases=50000 divergences=40 ... unexpected=0`.

**D2. `t7-soak.mjs` -- countLines in the cycle.** Each of the 4096 cycles also
calls `countLines` on the pooled text and asserts it equals the pooled expected
line count. Nothing else changes: one reused `Float32Array(256)`, `tracker.track`
then `tracker.untrack`, `tracker.size() === 0` after the last cycle, heap sampled
only at cycle boundaries after `globalThis.gc()`, growth under 512 KB.
File: `test/torture/t7-soak.mjs:run`.
Check: the T7 stderr line still reads `cycles=4096 trackerSize=0 heapGrowthKB=<n>` with `<n> < 512`.

**D3. `t8-cross.mjs` stays registered and empty.** `FLAG_OVERFLOW` conformance
against `drawWrapped` is TL3's, because the bmfont devDependency arrives there.
Extend the header line to say that `FLAG_OVERFLOW = 2` is inert under
`if (flags === 1)` at `BitmapFont.js:361` and that TL3 asserts it. Keep
`todo('TL-25', ...)`.
File: `test/torture/t8-cross.mjs`.
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'T8'` is >= 1.

### Phase E -- the public surface and the release

**E1. `test/TextLayout.test.js` -- one new describe group, exactly 9 `it(` cases**,
named `'overflow reporting and countLines'`, appended last:
(1) `FLAG_OVERFLOW === 2` and the three flag constants are pairwise distinct;
(2) a 1-line buffer given 10 lines of text returns 1 with `flags === FLAG_OVERFLOW`
on line 0; (3) TL-01 both directions, distinguishable, short text unflagged;
(4) an exact-fit buffer carries no `FLAG_OVERFLOW`; (5) capacities 0..3 return 0
and leave the buffer untouched; (6) `countLines` agrees on a wrapping case;
(7) `countLines` agrees on a truncating case (`boxHeight = 32`); (8) the sizing
round trip never overflows; (9) `Object.isFrozen(TextLayout)` is true and
assignment throws. Total after: `pass 40`, `fail 0`, 10 suites. If any existing
case pins `VERSION === '1.0.2'` (P7), move it to `'1.1.0'` -- do not add a tenth
case for it.
Check: `npm test` -> `pass 40`, `fail 0`.

**E2. `TextLayout.d.ts`.** `export declare const FLAG_OVERFLOW: 2;` (literal
type, matching however `FLAG_NORMAL` and `FLAG_TRUNCATED` are declared), the
`countLines` signature on the namespace type, and the `LineFlag` union widened
to `0 | 1 | 2`. Add law 6 as a doc comment.
Check: `grep -c 'FLAG_OVERFLOW\|countLines' TextLayout.d.ts` is >= 3.

**E3. `llms.txt`.** Version line to `1.1.0`; `countLines` in the API list with
its full signature; `FLAG_OVERFLOW` in the constants; the zero-capacity
detection rule; law 6; and the deletion of any "silently dropped" wording.
Check: `grep -c 'countLines' llms.txt` is >= 1 and `grep -c 'silently dropped' llms.txt` is 0.

**E4. `README.md`.** Constants table gains `FLAG_OVERFLOW | 2 | the BUFFER did
not fit the TEXT`, the API section gains `countLines`, and law 6 is added. The
full LiteSepforge-spine rebuild is TL4's -- this is a surgical edit.
Check: `grep -c 'FLAG_OVERFLOW' README.md` is >= 2.

**E5. Version sync to 1.1.0** in `package.json:version`, `TextLayout.js:VERSION`
and `llms.txt`.
Check: `node -e "import('./TextLayout.js').then(m=>process.exit(m.VERSION==='1.1.0'?0:1))"` exits 0 and `node -p "require('./package.json').version"` prints `1.1.0`.

**E6. `CHANGELOG.md`, `## 1.1.0`.** Added: `FLAG_OVERFLOW`, `countLines`, the
frozen namespace. Changed: the overflow contract, with the zero-capacity rule
and the mutual-exclusivity rule stated in full. Fixed: TL-01, TL-02, TL-11,
each moved OUT of the Known issues list -- the list shrinks by exactly three and
that is checkable. Measured: the freeze delta (50,000 calls, 87.5 ms unfrozen vs
87.9 ms frozen, 0.4%, noise) and the T6 lane-2 `bytesPerCall 0`, each stamped
with `1.1.0` and the node version. Semver note: MINOR, pointing at
`decisions/0001-flag-overflow.md`.
Check: `grep -c 'TL-01\|TL-02\|TL-11' CHANGELOG.md` is >= 3 and the Known issues
section no longer lists them as open.

### Phase F -- close out

**F1.** Re-run every command in ASSERTIONS in order into `$SCRATCH/tl1.post.txt`.
Regenerate `$SCRATCH/ids.post.txt` by the P4 recipe and `diff` it against
`ids.pre.txt`.
Check: the diff removes exactly `TL-01`, `TL-02`, `TL-11`, `T6-lane2`,
`control-3`, `control-4` and adds nothing.

---

## HOT PATH

`computeWrap` is one linear pass, TL-20 proves it allocates nothing, and TL-21
proves it reads 1.14 glyph entries per character. Both properties survive this
session or the session failed.

- **The loop body -- lines 92 through 214 -- does not change by one byte.** Not
  the break, not the newline branch, not the advance, not the ellipsis tracking,
  not the wrap test, not the space-eater, not the hard-break reseed. The
  overflow flag is written once, after the loop, at a `ptr` the function already
  knows, under a condition assembled from locals that already exist. Bytes in a
  hot body, not instructions: a branch that fires on one call in a thousand
  still occupies the loop's instruction cache every iteration, so it lives
  outside the loop.
- **`countLines` is a separate function** so `computeWrap`'s call sites stay
  monomorphic and its body stays identical to the shape TL-20 measured.
- **`Object.freeze` is a one-time module-load cost.** Pre-measured at 0.4%,
  which is noise; still confirmed by T6 against `$SCRATCH/tl20.pre.json`.

Two witnesses, because a plausible-looking diff and a stable number can each be
wrong alone:

1. Extract the FIRST loop only from each file and diff them:

```sh
firstloop () { awk '/^        for \(let i = 0; i < len; i\+\+\) \{$/{f=1} f{print} f&&/^        \}$/{exit}' "$1"; }
diff <(firstloop $SCRATCH/TextLayout.js.pre) <(firstloop TextLayout.js)
```

   produces **no output**. A plain `sed` range does NOT work here: `countLines`
   copies `computeWrap`'s loop header verbatim, so a range match spans both
   loops and reports the whole new function as a diff. `awk` with an `exit`
   stops at the first loop, which is `computeWrap`'s.
2. T6 lane 1 reproduces `$SCRATCH/tl20.pre.json` exactly.

---

## ASSERTIONS

Each is a command with an exact expected result.

1. `npm test` -> `pass 40`, `fail 0`, `suites 10`, exit 0, and no line matching
   `torture:` in the output.
2. `node --expose-gc test/torture.mjs 2>/dev/null | od -c | head -1` -> `o k \n`,
   exit 0.
3. `TEXTLAYOUT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` -> exit 1,
   stdout empty. `node test/torture.mjs` (no `--expose-gc`) -> exit 1, stdout
   empty.
4. **Bookkeeping, before and after:**
   `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep 'known-failing='`
   -> `torture: known-failing=35 todo=5` (from 37 and 9; TL-01 and TL-11 leave
   the known-failing set, TL-02, T6-lane2, control-3 and control-4 leave the
   todo set, nothing else moves). Each of the six is a single occurrence today,
   verified, so this arithmetic is exact.
5. `diff $SCRATCH/ids.pre.txt $SCRATCH/ids.post.txt` shows exactly six removals
   -- `TL-01`, `TL-02`, `TL-11`, `T6-lane2`, `control-3`, `control-4` -- and
   zero additions.
6. **The scope tripwire:**
   `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep 'T5 cases='`
   reports `cases=50000`, `divergences=40`, `unexpected=0`, byte-identical to
   P5. A different number means TL1 changed whitespace or newline behaviour that
   belongs to TL2.
7. **The overflow law, executable:** a 1-line buffer given the 10-line text
   returns 1 with `outBuffer[3] === 2`; `'AAA BBB CCC'` into `Float32Array(12)`
   returns 3 with `outBuffer[11] === 0`; the two 12-slot buffers from the TL-01
   reproduction differ in exactly one slot, index 11.
8. **The iff, over the corpus:** across all 50,000 T5 cases, `FLAG_OVERFLOW`
   appears on the last written line if and only if
   `countLines(...) > floor(outBuffer.length / 4)`, 0 violations; and no single
   output ever contains both a `FLAG_TRUNCATED` line and a `FLAG_OVERFLOW` line,
   0 violations; and every flags slot is in `{0, 1, 2}`, 0 violations.
9. **Agreement:** `countLines` equals `computeWrap` into `Float32Array(4096)`
   for all 512 T0 cases crossed with `boxHeight` in `{0, 16, 32, 48, 1e9}`
   (2,560 comparisons), for all 50,000 T5 cases, and for all 40 `node:test`
   cases. 0 mismatches.
10. **Sizing round trip:** `new Float32Array(countLines(...) * 4)` produces no
    `FLAG_OVERFLOW` on any of the 50,000 fuzz cases.
11. **GC budget:** T6 lane 1 reports `verdict: 'pass'`, `source: 'gc'`,
    `major === 0`, `minor === 0`, `maxMs < 4` (measured 0.000),
    `arrayBuffers` growth 0 at `ops: 20000, warmup: 1000, stabilize: 'deep'`,
    byte-identical to `$SCRATCH/tl20.pre.json`. T6 lane 2 reports the same, plus
    `measureAllocs(hot2, { iterations: 2000 })` -> `bytesPerCall === 0`,
    `settled === true`, `checkAllocs(..., { maxBytesPerCall: 0 })` ->
    `verdict: 'pass'`, `violations: []`, and `SINK > 0`.
12. **Retention:** T7 runs 4096 cycles with `countLines` in each cycle;
    `tracker.size() === 0` after the last cycle; `heapUsed` growth sampled at
    cycle boundaries after `globalThis.gc()` is under 512 KB;
    `out.buffer.byteLength` identical before and after every measured window
    in T6.
13. **Freeze:** `Object.isFrozen(TextLayout)` is `true`;
    `node --input-type=module -e "const{TextLayout:T}=await import('./TextLayout.js');try{T.x=1;process.exit(1)}catch(e){process.exit(e instanceof TypeError?0:1)}"`
    exits 0.
14. **Controls fire.** For each of controls 3, 4 and 5, run the two-direction
    test: break the guarded mechanism with the control armed (the run must exit
    1), then additionally neuter the control (the run must exit 0, and that is
    the failure the control exists to prevent). Prove control 3 by widening
    `STUB4`, control 4 by returning `true` from the detector, control 5 by
    removing the `Object.freeze` line. Revert each and confirm the file is
    byte-identical afterwards.
15. **The drift mutation:** delete the `lastSpace = -1;` reset from
    `countLines`'s soft-break branch. `node --expose-gc test/torture.mjs` exits 1
    naming the T0 agreement law. Revert and re-run to `ok`.
16. **Hot path witness 1:** the `sed`/`diff` command in HOT PATH produces no
    output.
17. **Hot path witness 2:** `diff $SCRATCH/TextLayout.js.pre TextLayout.js`
    shows changed hunks only in comments, the `FLAG_OVERFLOW` export, the
    `VERSION` line, the post-loop tail block, the `countLines` method and the
    `Object.freeze` line -- nothing else.
18. **ASCII gate:**
    `for f in TextLayout.js TextLayout.d.ts llms.txt README.md CHANGELOG.md test/TextLayout.test.js package.json LICENSE.txt decisions/0001-flag-overflow.md; do LC_ALL=C grep -c '[^ -~\t]' "$f"; done`
    prints `0` nine times.
19. **Packaging:** `npm pack --dry-run 2>&1 | grep -c 'test/'` is 0 and
    `npm pack --dry-run 2>&1 | grep -c 'decisions/'` is 0; `CHANGELOG.md` is
    listed once.
20. `time node --expose-gc test/torture.mjs` completes under 120 s (TL0
    measured 1.45 s; the new corpus work must not push it past 30 s -- if it
    does, say so in the CHANGELOG, do not silently shrink T5).

---

## NON-GOALS

No input validation, no thrown library error, no door of any kind -- that is
TL2, and `countLines` inherits TL2's doors when they land rather than growing
its own now. No sentinel return. No change to `FLAG_TRUNCATED`'s meaning or
value. No `outBuffer === null` branch. No per-glyph anything, ever. No fix for
**TL-26 (the phantom trailing line)** even though it lives in the newline and
whitespace code this session reads -- it is TL2's, and assertion 6 exists to
catch a stray fix. No TL-03..TL-10, TL-13, TL-14, TL-15, TL-24 rows change
status. No `outBuffer` type policy (TL-10 stays `knownFailing`), no aliasing
policy (the TL2 todo stays). No bmfont devDependency and no T8 contents (TL3).
No README spine rebuild (TL4). No performance work on the linear pass.

---

## RISKS AND THEIR CHECKS

**R1 -- the knownFailing bombs.** B1-B4 make TL-01's and TL-11's predicates
false, and `knownFailing` `die()`s on a fixed bug. Between Phase B and Phase C
the suite is red **by design**. Mitigation: Phase C is exhaustive and enumerated
(C1-C6), and assertions 4 and 5 prove nothing was dropped instead of promoted.
Do not "fix" a red suite by deleting an entry without replacing it with a
passing assertion.

**R2 -- a vacuous agreement law.** If `OUT_BIG` is ever too small, `countLines`
and a capped `computeWrap` agree on the cap and the law passes while proving
nothing. Mitigation: the law itself rejects a result carrying `FLAG_OVERFLOW`,
and T9 control 3 (C4) reuses the identical comparator against a deliberately
capped stub and requires a mismatch.

**R3 -- `ptr - 1` on an empty buffer.** Writing `outBuffer[ptr - 1]` when
`ptr === 0` would write index -1, which on a `Float32Array` is a silent no-op
and on the `Array(16)` of TL-10 creates a `"-1"` property. Mitigation: the
`maxLines === 0` early return at line 69 makes that path unreachable, and C1(g)
asserts capacities 0..3 leave a POISON-prefilled buffer bit-identical, which
catches an index -1 write on the Array case too.

**R4 -- the ellipsis machinery turns out to affect control flow.** If
`lastSafeEllipsisIdx` does influence a branch, deleting it from `countLines`
breaks agreement on truncating input only. Mitigation: the boxHeight sweep in
the T0 law and the per-case `bh` in T5 make truncating input the majority of
agreement comparisons, not an afterthought. If it fires, port the machinery back
into `countLines` and record why in the CHANGELOG.

**R5 -- lane 2 measured nothing.** V8 can eliminate a call whose result is
discarded. Mitigation: the `SINK` accumulator and its `SINK > 0` assertion in C6.

**R6 -- the semver argument gets relitigated mid-session.** Mitigation: Phase A
lands before any code and carries the counter-argument, so the answer and its
opposition are both on disk before the first edit.

---

## DONE WHEN

```
npm test                                                 -> 40 pass, 0 fail, 10 suites
node --expose-gc test/torture.mjs                        -> prints exactly "ok", exit 0
TEXTLAYOUT_TORTURE_BREAK=1 \
  node --expose-gc test/torture.mjs                      -> exits non-zero
node --expose-gc test/torture.mjs 2>&1 >/dev/null \
  | grep 'known-failing='                                -> known-failing=35 todo=5
node --expose-gc test/torture.mjs 2>&1 >/dev/null \
  | grep 'T5 cases='                                     -> cases=50000 divergences=40 unexpected=0
```

and, at the file level: an undersized buffer reports itself on the flags slot of
its last written line and its partial layout is a true prefix; a zero-capacity
buffer returns 0 and writes nothing, with the detection rule documented in three
places; `countLines` exists with the full parameter list minus `outBuffer` and
agrees with `computeWrap` on all 512 T0 cases across five box heights, all
50,000 T5 cases and all 40 node:test cases; `Object.isFrozen(TextLayout)` is
true and assignment throws; T6 lane 1 reproduces `$SCRATCH/tl20.pre.json` and
lane 2 reports 0 bytes/op; T7 ends at `tracker.size() === 0` after 4096 cycles;
`decisions/0001-flag-overflow.md` carries the MINOR verdict, its
counter-argument, the zero-capacity contract and the precedence rule;
`TL-01`, `TL-02` and `TL-11` are promoted to passing assertions and struck from
the CHANGELOG's Known issues; `VERSION`, `package.json` and `llms.txt` all read
`1.1.0`; the `computeWrap` loop body is byte-identical to its pre-flight copy.
