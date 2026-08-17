---
package: "@zakkster/lite-text-layout"
version_target: 1.0.2
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak"]
findings: [TL-16, TL-17, TL-18, TL-19, TL-20, TL-21]
blocks: [TL1, TL2, TL3, TL4, TL5]
---

# TL0 -- lite-text-layout v1.0.2 -- enforce node:test, stand up the gate that can fail

## PURPOSE

The package cannot be tested under the suite's own runner, has no gate of any
kind, and its publish step downloads a bundler from the network. Every later
session's DONE WHEN is one torture command; this session builds it. TL1 through
TL5 are all behaviour changes on a hot body that is currently unguarded, so
none of them may land until `node --expose-gc test/torture.mjs` exists and can
fail.

It also records the good news as a baseline. TL-20 measured 0 bytes/op and
TL-21 measured 1.14 glyph reads per character. Both numbers go in the CHANGELOG
so that no future session invents work the evidence refutes. TL0 changes no
behaviour: no fix, no door, no flag, no freeze. Every one of the twenty-six
findings in ROADMAP section 2 is recorded as a known issue and left alone.
(TL-26 was found by this session's own torture suite and added mid-session.)

## PRE-FLIGHT (do this first; it is the before-side of every assertion)

There is **no `.git` in this working tree**. Any "the diff proves it" step is
replaced by a recorded copy plus `diff`/`shasum`. Write all pre-flight output
into a scratch directory, referred to below as `$SCRATCH`.

P1. `cp TextLayout.js $SCRATCH/TextLayout.js.pre` and
    `shasum -a 256 TextLayout.js > $SCRATCH/TextLayout.js.sha.pre`.
    This is the only baseline available for the HOT PATH section.
P2. `npx vitest run 2>&1 | tee $SCRATCH/vitest.pre.txt`. Expect **31 passed, 1
    file**. If it is not 31, STOP and report; the port target is whatever this
    prints, and it must be 31.
P3. Record per-file non-ASCII line counts into `$SCRATCH/ascii.pre.txt`:
    `for f in TextLayout.js TextLayout.d.ts llms.txt README.md TextLayout.test.js package.json LICENSE.txt; do printf '%s %s\n' "$f" "$(LC_ALL=C grep -c '[^ -~\t]' "$f")"; done`
    Expected from TL-17: `TextLayout.js 18`, `TextLayout.d.ts 7`, `llms.txt 17`,
    `README.md 42`, `TextLayout.test.js 42`, `package.json` >= 1 (the U+2014 in
    `description`). Any file whose count differs from TL-17 gets a one-line note
    in the CHANGELOG; the sweep still drives it to 0.
P4. Record the TL-20 baseline by hand into `$SCRATCH/tl20.pre.json`, using the
    exact shape in THE HARNESS SPEC / T6 below. Expect `verdict: 'pass'`,
    `source: 'gc'`, major 0, minor 0, `maxMs` 0.000, `bytesPerCall === 0`,
    `settled === true`. This requires the peers; if they are not installed yet,
    do P4 immediately after Task A4 instead and say so in the CHANGELOG.
P5. `node --test TextLayout.test.js` -- confirm it FAILS on the vitest import.
    That failure is the executable form of TL-16 and is quoted in the CHANGELOG.

---

## TASKS

### Phase A -- make the tree runnable under the suite runner (TL-16, TL-19)

**A1. Create `test/` and move the test file.**
`TextLayout.test.js` -> `test/TextLayout.test.js`. Fix the import specifier to
`../TextLayout.js`. File: `test/TextLayout.test.js`. Finding: TL-16.
Check: `test -f test/TextLayout.test.js && ! test -f TextLayout.test.js`.

**A2. Port the 31 cases to `node:test`.**
Replace the header with `import { describe, it } from 'node:test';` and
`import assert from 'node:assert/strict';`. Keep all **9 describe groups** and
all **31 `it(` cases**, in the same order, with the same names (after the ASCII
sweep in Phase E renames the em dashes inside those names). Assertion mapping,
applied mechanically:

| vitest | node:assert/strict |
| --- | --- |
| `expect(a).toBe(b)` | `assert.equal(a, b)` |
| `expect(a).toEqual(arrOfObjs)` | `assert.deepEqual(a, arrOfObjs)` |
| `expect(a).toMatchObject({k:v})` | one `assert.equal(a.k, v)` per key |
| `expect(a).toBeGreaterThan(b)` | `assert.ok(a > b, 'a > b')` |
| `expect(a).toBeGreaterThanOrEqual(b)` | `assert.ok(a >= b, 'a >= b')` |
| `expect(a).toBeLessThanOrEqual(b)` | `assert.ok(a <= b, 'a <= b')` |
| `expect([0,1]).toContain(v)` | `assert.ok(v === 0 \|\| v === 1, 'flags in {0,1}')` |

Keep the `async` on the bmfont-shape case (it was `TextLayout.test.js:373`,
`'produces a layout shape that BitmapFont.drawWrapped can consume'`).
`node:test` awaits a returned promise; the body has no `await`, so it settles on
the same tick and is reported as a normal pass. Do not convert it to sync and do
not add `await`. File: `test/TextLayout.test.js`. Finding: TL-16.
Check: `node --test test/TextLayout.test.js` -> `# pass 31`, `# fail 0`.

**A3. Rewrite `scripts` and add `engines`.**
File: `package.json:scripts`, `package.json:engines`. Findings: TL-16, TL-19.

```
"test":           "node --test test/TextLayout.test.js",
"torture":        "node --expose-gc test/torture.mjs",
"verify":         "npm run test && npm run torture",
"prepublishOnly": "npm run verify"
```

`bundle-check` and its `npx esbuild` call are **deleted** (TL-19: a publish gate
must not need the network). The test script names the file **explicitly** -- see
RISK R2, which is verified by execution, not assumed; a bare `node --test`
discovers and executes every `.mjs` under `test/`, including the torture entry
point. Add `"engines": { "node": ">=18" }`.
Check: `node -e "const p=require('./package.json');if(p.scripts['bundle-check'])process.exit(1);if(p.engines.node!=='>=18')process.exit(1)"` exits 0.

**A4. Swap the devDependencies.**
Remove `vitest`. Add `"@zakkster/lite-gc-profiler": "^1.15.0"` and
`"@zakkster/lite-leak": "^1.8.1"` (published versions, verified against the
registry; scope is `@zakkster`, one `s` -- `@zakksters` 404s). These resolve
from `registry.npmjs.org`; do **not** write `file:` links. No
`@zakkster/lite-bmfont` in TL0 -- it arrives with T8 in TL3. `npm install`.
Finding: TL-19.
Check: `grep -rn "vitest" package.json test/ TextLayout.js TextLayout.d.ts llms.txt README.md` -> no matches;
`node -e "import('@zakkster/lite-gc-profiler').then(m=>console.log(typeof m.measureOps))"` -> `function`.

### Phase B -- the harness and the entry point (TL-19)

**B1. `test/torture/harness.mjs`.** Full export list and semantics in
THE HARNESS SPEC below. Modelled on `LiteBvh/test/torture/harness.mjs`.
Check: `node -e "import('./test/torture/harness.mjs').then(m=>console.log(Object.keys(m).sort().join(',')))"` lists every name in the spec.

**B2. `test/torture.mjs`.** Entry point, modelled on `LiteBvh/test/torture.mjs`:
`--expose-gc` guard, `TIERS` array run strictly sequentially inside one
try/catch that prints the tier name and the replay seed, the BREAK end-check,
then `process.stdout.write('ok\n')` and `process.exit(0)`.
Check: `node test/torture.mjs` (no `--expose-gc`) exits 1 and prints nothing to stdout.

**B3. Register all eight tiers as stubs, then fill them in Phase C.**
`t0-laws.mjs`, `t1-degenerate.mjs`, `t2-capacity.mjs`, `t5-fuzz.mjs`,
`t6-alloc.mjs`, `t7-soak.mjs`, `t8-cross.mjs`, `t9-controls.mjs`, each
`export function run() {}`.
Check: `node --expose-gc test/torture.mjs` prints exactly `ok` and exits 0.

### Phase C -- the tiers (TL-20, TL-21, plus recording every other finding)

**C1. `test/torture/oracle.mjs`** -- see THE ORACLE. Infrastructure, no finding.
Its check is the T5 self-test in C6, not a standalone one.

**C2. `t6-alloc.mjs` FIRST** -- the gate that everything else leans on.
Wire the exact TL-20 shape plus the `measureAllocs` second witness plus the
structural `out.buffer.byteLength` assertion plus the BREAK injection.
Findings: TL-20, TL-19.
Check: `node --expose-gc test/torture.mjs` -> `ok`;
`TEXTLAYOUT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` -> exit 1.

**C3. `t9-controls.mjs`** -- controls 1, 2 and 5; controls 3, 4 and 6 registered
as `todo` naming their session. Finding: TL-11 (control 5's known-failing half).
Check: temporarily changing the T6 hot body to `leak.push(new Float64Array(64))`
makes a plain `node --expose-gc test/torture.mjs` exit 1 (revert after).

**C4. `t0-laws.mjs`** -- the nine laws listed in THE HARNESS SPEC / T0, over the
shared 512-case corpus. Findings: TL-02 (todo), TL-21 (read-count law).
Check: inverting the sign of the width comparison in the T0 width-agreement law
makes the run exit 1 (revert after).

**C5. `t1-degenerate.mjs`** and **`t2-capacity.mjs`** -- pin today's answers,
including the ugly ones, with every finding-linked row wrapped in
`knownFailing`. Findings: TL-01, TL-03..TL-10, TL-13, TL-14, TL-15, TL-24.
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'KNOWN-FAILING'`
is >= 12 and the run still exits 0.

**C6. `t5-fuzz.mjs`** -- 50,000 seeded cases against the oracle.
Check: the T9 control-2 corrupted oracle is flagged divergent; a clean run
reports 0 divergences to stderr.

**C7. `t7-soak.mjs`** -- 4096 cycles, `createLeakTracker`, heap sampling.
Check: stderr line reports `cycles=4096 trackerSize=0 heapGrowthKB=<n>` with
`<n> < 512`.

**C8. `t8-cross.mjs`** -- registered, empty, with a header stating that
lite-bmfont conformance is TL3 and that `layoutGlyphs` / range-aware `measure`
are not shipped in bmfont v1.2.0. `run()` writes one stderr line and returns.
Finding: TL-25 (deferred).
Check: `node --expose-gc test/torture.mjs 2>&1 >/dev/null | grep -c 'T8: empty -- TL3'` is 1.

### Phase D -- version sync and the CHANGELOG (TL-18)

**D1. `export const VERSION = '1.0.2';`** as a module-level named export in
`TextLayout.js`, placed **above** the `TextLayout` namespace object, not on it
(TL1 freezes the namespace; keep that a one-line change there). Add it to
`TextLayout.d.ts` and to `llms.txt`. File: `TextLayout.js:VERSION`. Finding: TL-18.
Check: `node -e "import('./TextLayout.js').then(m=>process.exit(m.VERSION==='1.0.2'?0:1))"` exits 0.

**D2. `package.json:version` -> `1.0.2`; `llms.txt` line 8 -> `Version: 1.0.2`.**
Check: `grep -h '1\.0\.2' package.json llms.txt TextLayout.js | wc -l` >= 3.

**D3. `CHANGELOG.md`.** Keep a Changelog format. `## 1.0.2` section covering:
node:test port, `test/` move, torture suite, `engines`, the deleted
`bundle-check`, the ASCII sweep, the `VERSION` export. Then a **Known issues**
section with **all twenty-five findings**, each as `TL-nn (Sn) -- one sentence
-- reproduction`, copied from ROADMAP section 2. Then a **Measured baselines**
section carrying TL-20 (20,000 ops, 360-char paragraph, reused
`Float32Array(256)`, major 0, minor 0, maxMs 0.000, arrayBuffers growth 0,
`bytesPerCall` 0) and TL-21 (1.14 glyph-table reads per character at 10,150
chars / 550 lines; 1.33 at 6,000 chars), each stamped with `1.0.2` and the node
version that produced it. Findings: TL-18, TL-20, TL-21.
Check: `grep -c 'TL-' CHANGELOG.md` >= 25 and `grep -c 'TL-20\|TL-21' CHANGELOG.md` >= 2.

**D4. `files[]` gains `"CHANGELOG.md"`.** Do **not** rename `LICENSE.txt`.
Check: `npm pack --dry-run 2>&1 | grep -c 'CHANGELOG.md'` is 1.

### Phase E -- the ASCII sweep, last, with a working gate (TL-17)

**E1. The U+4E2D regression -- do this task on its own, before the blind sweep.**
The case `'does NOT NaN-corrupt the width when text contains non-ASCII chars
(regression)'` (was `TextLayout.test.js:341-351`) is test DATA, not decoration:

- Line 346 already passes the escape `'A' + backslash-u-4E2D + 'B'` (backslash-u, six ASCII
  characters -- the file does NOT contain the raw glyph there). **Leave that
  string exactly
  as it is.** Do not "simplify" it, do not replace the escape with a different
  code point, do not delete the case.
- Lines 343 and 350 carry the raw glyph inside comments. Replace those with
  words: `U+4E2D, a CJK ideograph, charCode 20013 -- outside [0..255]` and
  `A(12) + U+4E2D(0) + B(12)`.
- The assertions `assert.equal(Number.isFinite(w), true)` and
  `assert.equal(w, 24)` stay.

A blind sweep that deletes the character leaves this test green while it no
longer touches the hazard it is named for -- the AR-02 pattern. File:
`test/TextLayout.test.js`. Finding: TL-17.
Check: `grep -c '\\u4E2D' test/TextLayout.test.js` is 1 **and**
`LC_ALL=C grep -c '[^ -~\t]' test/TextLayout.test.js` is 0 **and** the case still
asserts `24`.

**E2. U+00D7 goes too, despite the exception.** CLAUDE.md permits U+00D7 and
U+00B5, but the gate in ASSERTIONS is a plain `LC_ALL=C grep -c '[^ -~\t]'`
returning **0** for every shipped file, and a permitted character still matches
that pattern. **Decision: normalise U+00D7 to `x`.** The one occurrence is
`TextLayout.d.ts:23` (`256 x 7`), which reads identically as ASCII. Recording
this here so the gate command needs no exception clause and no second grep.
File: `TextLayout.d.ts`. Finding: TL-17.
Check: `LC_ALL=C grep -c '[^ -~\t]' TextLayout.d.ts` is 0.

**E3. Sweep the remaining distinct characters.** The complete inventory across
the six files is: U+00D7 (E2), U+2013, U+2014, U+2026, U+2192, U+2265, U+2500,
U+4E2D (E1), U+FE0F, and the emoji U+1F4C3, U+1F4CF, U+1F4D0, U+1F4DA, U+1F4E6,
U+1F579, U+1F5D2, U+1F680, U+1F9E0, U+1F9E9, U+1F9EA, U+1F9F9, U+1FAB6.
Replacements: U+2013/U+2014 -> ` -- `, U+2026 -> `...`, U+2192 -> `->`,
U+2265 -> `>=`, U+2500 -> `-` (the box rules become plain `// ---` banners),
emoji + U+FE0F -> deleted, and each emoji README heading becomes the plain word
that follows it (TL4 rebuilds the README anyway). Files: `TextLayout.js`,
`TextLayout.d.ts`, `llms.txt`, `README.md`, `test/TextLayout.test.js`,
`package.json:description`. Finding: TL-17.
Check: the ASSERTIONS grep loop returns 0 for all seven files.

**E4. Prove the sweep did not touch code.**
`diff $SCRATCH/TextLayout.js.pre TextLayout.js` must show **only** the `VERSION`
export addition (D1) and changed characters inside comment lines and docstrings.
Every changed hunk that is not a comment or the VERSION line is a defect.
Finding: TL-17 + HOT PATH.
Check: `diff $SCRATCH/TextLayout.js.pre TextLayout.js | grep '^[<>]' | grep -vc '^[<>] *\(\*\|//\|/\*\|export const VERSION\)'`
is **0**.

### Phase F -- close out

**F1.** Re-run every command in ASSERTIONS in order, capture into
`$SCRATCH/tl0.post.txt`, and compare T6's numbers to `$SCRATCH/tl20.pre.json`.
Check: T6 post numbers equal the pre numbers (major 0, minor 0, `bytesPerCall` 0).

---

## THE HARNESS SPEC

### Layout

```
test/
  TextLayout.test.js     the 31 ported node:test cases
  torture.mjs            entry: tiers in order, prints exactly "ok", exit 0/1
  torture/
    harness.mjs          PRNG, check/die, gc gate wrappers, shared fixtures
    oracle.mjs           brute-force reference wrapper for T5
    t0-laws.mjs  t1-degenerate.mjs  t2-capacity.mjs  t5-fuzz.mjs
    t6-alloc.mjs t7-soak.mjs        t8-cross.mjs     t9-controls.mjs
```

`test/` never enters `files[]`.

### `harness.mjs` exports

Generic (same semantics as `LiteBvh/test/torture/harness.mjs`):

- `SEED` -- `process.env.TORTURE_SEED` as uint32, default `0x9e3779b9`, coerced
  to 1 if 0 (xorshift32 must never be seeded with 0).
- `BREAK` -- `process.env.TEXTLAYOUT_TORTURE_BREAK === '1'`.
- `RULES` -- `{ maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 }`. Unknown
  keys throw on every lane including `checkNoGc`; there is no `maxExternalGrowth`.
  Do not add keys without reading `../LiteGCProfiler/llms.txt`.
- `makePrng(seed)` -- xorshift32, returns a uint32 per call.
- `die(msg)` -- writes `torture: FAIL -- <msg>\n` to **stderr**, `process.exit(1)`.
- `check(cond, msgThunk)` -- thunk, so the happy path builds no string.
- `runOpsGate(fn, { ops, warmup })` -- one `measureOps(fn, { ops, warmup,
  stabilize: 'deep' })` window, returns `{ report: checkNoGc(res.summary, RULES),
  summary: res.summary }`. `stabilize: 'deep'` is what makes
  `maxArrayBuffersGrowth` resolvable; never omit it.

Package-specific, and this is where it diverges from the bvh harness:

- `runAllocGate(fn, { iterations })` -- `measureAllocs(fn, { iterations })` then
  `checkAllocs(a, { maxBytesPerCall: 0 })`, returns `{ report, allocs }`.
  **`iterations` is REQUIRED and must be a positive integer** or it throws
  `RangeError: measureAllocs: opts.iterations must be a positive integer`.
  It requires `--expose-gc` and rejects async functions.
- `FONT` -- the canonical stub, built ONCE at module load: `glyphs`
  `Int16Array(256*7)`, `kerning` `Int16Array(65536)` all zero, `xadvance` 12 for
  every uppercase (65..90) and lowercase (97..122) id, 6 for space (32), 6 for
  `'.'` (46). No other id is populated.
- `GLYPH_IDS` -- `Int32Array` of the populated letter ids, for corpus generation.
- `TL20_TEXT` -- `'The quick brown fox jumps over the lazy dog. '.repeat(8)`,
  360 characters, built once.
- `POISON` -- `-12345`, the read-back sentinel for the T0 no-read-back law.
- `sumWidth(text, font, start, end, scale)` -- an **independent** width
  computation (sum of `glyphs[id*7+6]*scale` plus `kerning[(prev<<8)|id]*scale`,
  `prev` reset at line start and on any id > 255), used by the T0 width law. It
  is written from the documented rules, not lifted from `TextLayout.js`, and it
  is never called inside a measured window.
- `makeCorpus(prng, n)` -- returns an Array of `n` plain case objects
  `{ text, boxWidth, scale }`, **built once, before any loop**, per the generator
  parameters in THE ORACLE.
- `knownFailing(id, stillBrokenFn)` -- runs `stillBrokenFn()`; if it returns
  `true` the bug is still present, so the harness writes
  `torture: KNOWN-FAILING -- <id>\n` to stderr, counts it, and continues. If it
  returns `false` the harness `die()`s with
  `<id> no longer reproduces -- promote it to a passing assertion and delete this entry`.
  A known-failing entry that has silently been fixed is how a session forgets to
  claim its own win.
- `todo(id, msg)` -- writes `torture: TODO -- <id>: <msg>\n` to stderr, counts it.
- `finish()` -- called by the entry point before printing `ok`; writes the
  known-failing and todo counts to stderr. **Nothing but `ok\n` ever reaches
  stdout.**

### Harness rules (non-negotiable)

Fonts, buffers and corpora are allocated once, outside every loop. No
`makeFont()` per iteration, no template literal per iteration, no closure per
iteration -- the subject allocates nothing, and if the harness allocates the
gate measures the harness. lite-gc-profiler is **one measurement at a time**:
`measureOps`, `measureAllocs`, `measureFrames` and `measureOpsAsync` share one
heap and throw "already in flight" if nested, so tiers run strictly
sequentially, never nested, never concurrent. Never resolve an unexpected
`inconclusive` with `allowInconclusive`; triage via the profiler's
`INCONCLUSIVE.md`.

### `run()` contract

Each tier module exports exactly `export function run()`. It takes no arguments,
returns nothing, fails via `die()` (which exits 1), and may throw only on an
unexpected fault -- the entry point catches, names the tier, prints the replay
seed and exits 1.

### Entry point behaviour

```
if (typeof globalThis.gc !== 'function') -> stderr, exit 1
for (const [name, run] of TIERS) try { run() } catch -> stderr + seed, exit 1
if (BREAK) -> stderr 'BREAK set but the gate still passed', exit 1
finish(); stdout.write('ok\n'); exit 0
```

`TIERS` order: T0, T1, T2, T5, T6, T7, T8, T9.

### Minimum case set TL0 ships per tier

**T0 -- laws**, over the shared 512-case corpus (`boxHeight = 0`):
1. Partition: `0 <= start <= end <= len`, `line[k+1].start >= line[k].end`, and
   every skipped character between two lines is code 32 or 10.
2. Width agreement against `sumWidth`, within one f32 ulp.
3. `boxWidth === 0` -> `lineCount === 1 + count('\n')` exactly.
4. Monotonicity in `boxWidth` for `boxWidth >= 24` (the widest scaled glyph).
5. Purity: two calls into two distinct buffers are byte-identical.
6. No read-back: prefill with `POISON`, assert every slot past `lineCount * 4`
   is still `POISON`, and that the result is identical to a zero-filled run.
7. No empty line unless it came from an explicit `\n`.
8. Scale invariance for `scale` in `{0.5, 1, 2}` with `boxHeight = 0`: identical
   ranges, widths multiplied by exactly `s` within one f32 ulp. It passes today
   on this domain; the degenerate scalars that break it are T1's knownFailing rows.
9. `todo('TL-02', 'countLines absent -- the agreement law lands in TL1')`, guarded
   by `check(typeof TextLayout.countLines === 'undefined', ...)` so the todo
   removes itself the moment TL1 lands.

**T1 -- degenerate values.** One named case per value, pinning today's answer:
`boxWidth` in `{0, -0, -1, -100, NaN, Infinity, -Infinity, 1e-7, 3.4e38}` (TL-05
rows knownFailing); `boxHeight` the same set plus `1` and `8` against
`lineHeight = 16` (TL-07 knownFailing); `lineHeight` in `{0, -16, NaN, Infinity}`
(TL-06 knownFailing); `scale` in `{1, 0, -1, NaN, Infinity, 1e-30, 2, 0.5}`
(TL-03, TL-04 knownFailing); `text` in `{'', ' ', '   ', '   AAA', '\n',
'\n\n\n', '\r\n', 'AAA\r\nBBB', '\r', 'A\n', 10k chars with no space, ids
255/256/65535, a lone surrogate}` (TL-13, TL-14 knownFailing); `font` in
`{full stub, glyphs Int16Array(100*7), glyphs Int16Array(4), short kerning,
no '.', {}, null, undefined}` (TL-08, TL-09 knownFailing -- the throwing rows
assert the current raw `TypeError`); non-string `text` in `{12345, null,
undefined, ['A']}` (TL-09); and the f32 index boundary by name:
`Math.fround(16777217) === 16777216` and `Math.fround(16777219) === 16777220`
(TL-15).

**T2 -- output buffer capacity and type.** One named case per row of ROADMAP
section 3's T2 table, ten rows. The `4*n` / `n+1` row is the TL-01 knownFailing
entry and it asserts the **indistinguishability** directly: the 10-word text
into `Float32Array(12)` produces a buffer byte-identical to `'AAA BBB CCC'` into
the same buffer, and both last lines read `FLAG_NORMAL`. `Array(16)`,
`Float64Array` and `Int32Array` are knownFailing TL-10 rows pinning acceptance
(and, for `Int32Array`, the integer truncation of a fractional width). The
`outBuffer` aliasing `font.glyphs`' `ArrayBuffer` row pins the observed result
plus `todo('TL2', 'policy undecided')`.

**T5 -- differential fuzz.** 50,000 seeded cases against the oracle. See below.

**T6 -- the zero-alloc gate.** Lane 1 only in TL0, and it is the exact TL-20
shape:

```js
const out = new Float32Array(256);                       // reused, allocated once
const hot = () => { TextLayout.computeWrap(TL20_TEXT, FONT, 200, 0, 16, out);
                    if (BREAK) leak.push(new Float64Array(64)); };
const { report, summary } = runOpsGate(hot, { ops: 20000, warmup: 1000 });
const { report: allocReport } = runAllocGate(hot, { iterations: 2000 });
```

plus the structural assertion no heap gate substitutes for: `out.buffer.byteLength`
identical before and after both windows. Expect `verdict: 'pass'`, `source: 'gc'`,
major 0, minor 0, `maxMs` 0.000, `bytesPerCall === 0`, `settled === true`. In
BREAK mode both gates must reject; reaching the end of T6 with BREAK set is
itself a `die()`. The header states that lane 2 (`countLines`) arrives in TL1 and
lane 3 (doors on valid input) in TL2, each as a `todo`.

**T7 -- soak and retention.** Pool of 64 strings built once before the loop with
their expected line counts. 4096 cycles: pick `pool[i & 63]`, `computeWrap` into
one reused `Float32Array(256)`, `tracker.track(obj, NOOP, id)` then
`tracker.untrack(h)`, assert the line count matches the pooled expectation.
`createLeakTracker({ name: 'textlayout-soak' })`. After the last cycle:
`tracker.size() === 0`. Sample `heapUsed` at cycle boundaries only, after
`globalThis.gc()`, never inside a cycle; growth across all 4096 under 512 KB.

**T8 -- registered, empty.** Header names TL3 and states the bmfont v1.2.0
blocker. One stderr line, no cases. Not a `die()`, not a silent no-op.

**T9 -- controls.** Shipping now: control 1 (an allocating hot body must be
rejected by `runOpsGate`), control 2 (a corrupted oracle -- drop the last line
and add 1 to one width -- must be flagged divergent by the T5 comparator),
control 5 (the freeze detector: assert `Object.isFrozen(TextLayout) === false`
today as a knownFailing TL-11 entry, and prove the detector works by freezing a
throwaway object and asserting assignment throws in strict mode). Registered as
`todo` with their session named: control 3 (countLines stub, TL1), control 4
(overflow without `FLAG_OVERFLOW`, TL1), control 6 (double-scaled width, TL3).
Control 7 is the whole-suite `TEXTLAYOUT_TORTURE_BREAK=1` run.

---

## THE ORACLE

`test/torture/oracle.mjs` exports:

```js
export function oracleWrap(text, font, boxWidth, scale) // -> Array<{start, end, width}>
```

It is **allowed to allocate freely** -- it builds arrays and slices strings --
and it is never called inside a measured window. It is written **top-down from
the five documented wrapping rules**, never transcribed from `TextLayout.js`; an
oracle copied from the subject proves nothing. The five rules it implements:
split on `\n` into paragraphs; split each paragraph into words on single spaces;
measure a run by summing `glyphs[id*7+6]*scale` plus `kerning[(prev<<8)|id]*scale`
with `prev` reset at line start and on every id > 255; greedily pack words while
the running width plus the next word fits `boxWidth`; hard-break mid-word when a
single word alone exceeds the box, always emitting at least one glyph per line.

**Domain restriction, stated in the file header:** `boxHeight = 0` only, no
truncation. The "latest position where content plus ellipsis still fits" rule is
intricate enough that a second implementation of it is a second chance to be
wrong the same way; truncation is pinned by named cases in T0 and T1 instead.

**Generator parameters** (`makeCorpus`): word lengths 1..12 over `GLYPH_IDS`,
0..40 words per case, 0..4 newlines, words joined by exactly one space with no
leading or trailing space, `boxWidth` uniform in `[0, 300]`, `scale` from
`{0.5, 1, 2}`, `boxHeight = 0`. T5 runs 50,000 such cases; T0 reuses the first
512. Comparison: line ranges exactly, widths within one f32 ulp of the oracle's
f64 sum. On divergence print the seed, the case index and the exact call so it
replays in one line with `TORTURE_SEED=... node --expose-gc test/torture.mjs`.

**The rule that protects the oracle:** if T5 diverges, **do not edit the oracle
to agree with the subject.** Either the divergence is an already-named finding
(TL-24's over-wide single glyph is the likely one at small `boxWidth`), in which
case it becomes a `knownFailing` entry citing the ID, or it is new, in which case
it is appended to ROADMAP section 2 as TL-26 onward with its reproduction and
registered as `knownFailing`. TL0 fixes nothing.

---

## HOT PATH

**TL0 changes no behaviour.** The only permitted edits to `TextLayout.js` are:
the `VERSION` export (D1) and ASCII replacements **inside comments and
docstrings** (E3). Not one byte of the `computeWrap` loop moves -- no rename, no
reorder, no "while I was in there".

With no git in this tree, that is verified by the Phase E4 command against the
`$SCRATCH/TextLayout.js.pre` copy taken in P1: every `diff` hunk line must begin
a comment or be the `VERSION` line. The second, independent witness is the
number: if T6 reports anything other than the TL-20 baseline recorded in P4 at
the end of this session, the ASCII sweep touched code. Two witnesses, because a
comment-shaped diff and a stable number can each be wrong alone.

---

## ASSERTIONS

Each of these is a command with an exact expected result.

1. `node --test test/TextLayout.test.js` -> `# pass 31`, `# fail 0`, exit 0.
2. `npm test` produces the same and its combined output contains **no** line
   matching `torture:` -- proof that `node --test` is not discovering and
   executing the torture files (R2).
3. `node --expose-gc test/torture.mjs` -> stdout is **exactly** `ok\n` (verify
   with `node --expose-gc test/torture.mjs 2>/dev/null | od -c | head -1` ->
   `o k \n`), exit 0.
4. `TEXTLAYOUT_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` -> exit **1**,
   stdout empty.
5. `node test/torture.mjs` (no `--expose-gc`) -> exit 1, stdout empty.
6. **GC budget:** T6 reports `verdict: 'pass'`, `source: 'gc'`, `major === 0`,
   `minor === 0`, `maxMs` < 4 (measured 0.000), `arrayBuffers` growth 0, at
   `ops: 20000, warmup: 1000, stabilize: 'deep'` on the 360-char paragraph into
   a reused `Float32Array(256)` -- byte-identical to `$SCRATCH/tl20.pre.json`.
7. **Bytes per op:** `measureAllocs(hot, { iterations: 2000 })` reports
   `bytesPerCall === 0` and `settled === true`; `checkAllocs(a, { maxBytesPerCall: 0 })`
   reports `verdict: 'pass'`, `violations: []`.
8. **Retention:** T7 runs 4096 cycles and `tracker.size() === 0` at the end;
   `heapUsed` growth measured at cycle boundaries after `globalThis.gc()` is
   under 512 KB.
9. **Structural:** `out.buffer.byteLength` is identical before and after every
   measured window in T6.
10. T9 controls 1, 2 and 5 each fire: with any one of them neutered, a plain
    `node --expose-gc test/torture.mjs` exits 0 -- and that is the failure. Prove
    each by neutering it, observing exit 0, and reverting.
11. T5 reports 50,000 cases, 0 unexplained divergences; the corrupted-oracle
    control is flagged.
12. **ASCII gate:**
    `for f in TextLayout.js TextLayout.d.ts llms.txt README.md test/TextLayout.test.js package.json LICENSE.txt; do LC_ALL=C grep -c '[^ -~\t]' "$f"; done`
    prints `0` seven times. (U+00D7 included -- see E2.)
13. **The U+4E2D regression survives:** `grep -c '\\u4E2D' test/TextLayout.test.js`
    is 1, the case name still contains `non-ASCII`, and the case still asserts
    `w === 24`.
14. **Version sync, three places:** `package.json` `1.0.2`, `llms.txt` line 8
    `Version: 1.0.2`, `import { VERSION }` -> `'1.0.2'`.
15. `npm pack --dry-run` lists `CHANGELOG.md` and lists **no** path beginning
    `test/`: `npm pack --dry-run 2>&1 | grep -c 'test/'` is 0.
16. `grep -rn 'vitest\|@zakksters\|esbuild' package.json test/ *.js *.txt README.md CHANGELOG.md`
    returns nothing. **Scoped to shipped files on purpose.** A bare `*.md` also
    matches `BRIEF.md` and `ROADMAP.md`, which are planning documents, are not
    in `files[]`, and legitimately contain the words `vitest` and `esbuild`
    because they describe findings TL-16 and TL-19. If this assertion ever
    fails on those two files, the assertion is wrong, not the package -- do not
    edit the planning documents to make a grep pass.
17. `diff $SCRATCH/TextLayout.js.pre TextLayout.js | grep '^[<>]' | grep -vc '^[<>] *\(\*\|//\|/\*\|export const VERSION\)'`
    is `0`.
18. The whole torture run completes in under 120 s wall clock
    (`time node --expose-gc test/torture.mjs`). If T5's 50,000 cases alone push
    past it, drop to 20,000 and record the number in both the `t5-fuzz.mjs`
    header and the CHANGELOG -- do not silently shrink it.

---

## NON-GOALS

No behaviour change of any kind. No new exports besides `VERSION`. No fixes:
every finding is recorded in CHANGELOG as a known issue and fixed in TL1/TL2.
Specifically **not** in this session: `FLAG_OVERFLOW` (TL1), `countLines` (TL1),
`Object.freeze(TextLayout)` (TL1), any input door or thrown library error (TL2),
the CRLF range rule (TL2), the `lastSpaceWidth` reset tidy-up (TL2), the
lite-bmfont devDependency and T8's contents (TL3), the README rebuild on the
LiteSepforge spine (TL4), and anything touching the linear pass for performance
(rejected on sight by TL-21). No `decisions/` files -- the first one is TL1's
`0001-flag-overflow.md`.

---

## RISKS AND THEIR CHECKS

**R1 -- the U+4E2D trap.** A blind sweep deletes a regression while leaving it
green. Mitigation: Task E1 runs before E3 and has its own assertion (13). The
string escape at line 346 is explicitly out of the sweep's reach.

**R2 -- `node --test` discovers the torture files. VERIFIED, not assumed.** A
scratch tree containing `test/Thing.test.js` and `test/torture.mjs` was run with
a bare `node --test`: the runner reported `tests 2` and the torture file's
stderr line appeared in the output. It had executed the torture entry point.
Under this package's real files that means `process.exit` from a tier and a
`--expose-gc` guard failure inside `npm test`. Mitigation:
`"test": "node --test test/TextLayout.test.js"` (A3), checked by assertion 2.

**R3 -- the async case under `node:test`.** `node:test` awaits a returned
promise, so the `async` case at former line 373 passes unchanged. The failure
mode is a silent skip if the body is rewritten to use a callback parameter as
well as `async`. Mitigation: keep it `async` with no `done` parameter; assertion
1's `# pass 31` catches a skip (`node --test` reports skipped separately).

**R4 -- a harness that measures itself.** Any allocation inside the T6 hot
closure or inside `runOpsGate` invalidates the gate. Mitigation: the hot closure
captures only `TL20_TEXT`, `FONT` and `out`, all module-level; `check()` takes a
thunk; the corpus is built before any window. Checked by assertion 6 reproducing
the P4 baseline exactly -- a self-measuring harness will not land on major 0,
minor 0, `bytesPerCall` 0.

**R5 -- no network.** The peers install from `registry.npmjs.org` and there is
no `node_modules` today. If `npm install` fails, **do not** vendor the peers, do
not write a local stub `measureOps`, do not add `file:` links, and do not
weaken `RULES` to make an unmeasurable run pass. Write every file exactly as
specified, run Phases A, D and E and their assertions (1, 2, 12, 13, 14, 15, 16,
17 all work offline), and report TL0 as **BLOCKED on install** with the verbatim
npm error, listing assertions 3-11 and 18 as unrun. A gate that was never
executed is not a gate, and claiming `ok` from a stubbed profiler is worse than
reporting blocked.

**R6 -- T5 finds something new.** Likely at small `boxWidth` (TL-24).
Mitigation: the oracle-protection rule above -- register `knownFailing`, append
to ROADMAP section 2, fix nothing.

---

## DONE WHEN

```
node --test test/TextLayout.test.js                      -> 31 pass, 0 fail
node --expose-gc test/torture.mjs                        -> prints exactly "ok", exit 0
TEXTLAYOUT_TORTURE_BREAK=1 \
  node --expose-gc test/torture.mjs                      -> exits non-zero
```

and, at the file level: `test/TextLayout.test.js` holds all 31 cases under
`node:test` with no vitest anywhere; `test/torture.mjs` plus ten files under
`test/torture/` exist (harness, oracle, and eight tiers), with T0, T1, T2, T5, T6, T7, T9 carrying real cases and
T8 registered empty for TL3; every unfixed finding is a `knownFailing` or `todo`
entry naming its ID and its session; `CHANGELOG.md` exists, is in `files[]`, and
carries all twenty-five findings plus the TL-20 and TL-21 baselines; `VERSION`,
`package.json` and `llms.txt` all read `1.0.2`; every shipped file and
`package.json` returns 0 from `LC_ALL=C grep -c '[^ -~\t]'`; `npm pack --dry-run`
excludes `test/`; and `TextLayout.js` differs from its pre-flight copy only in
comments and the `VERSION` line.
