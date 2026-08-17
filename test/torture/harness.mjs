/**
 * @zakkster/lite-text-layout -- torture harness.
 *
 * Shared PRNG, fail-closed assertions, the two lite-gc-profiler gate wrappers,
 * and the canonical fixtures (FONT, corpus, TL20 paragraph). Every tier imports
 * from here so the zero-alloc discipline lives in one place:
 *
 *   - All fixtures (FONT, buffers, corpora) are allocated ONCE, at module load
 *     or by the tier outside every loop. This module hands out shared state,
 *     never a per-call allocation on a hot path.
 *   - `check()` builds its message string only on failure -- a template literal
 *     per iteration is an allocation and would fail the T6 gate.
 *   - The PRNG is a seeded xorshift32. On any failure a tier prints the seed so
 *     the case replays with `TORTURE_SEED=... node --expose-gc test/torture.mjs`.
 *   - lite-gc-profiler is one-measurement-at-a-time; tiers run sequentially,
 *     never nested. Each gate wrapper opens and closes a single window per call.
 *
 * @license MIT
 */

import {
    measureOps,
    measureAllocs,
    checkNoGc,
    checkAllocs,
} from '@zakkster/lite-gc-profiler';
import {
    TextLayout,
    TextLayoutError,
    FLAG_NORMAL,
    FLAG_TRUNCATED,
    FLAG_OVERFLOW,
} from '../../TextLayout.js';

/** Seed for every PRNG in the run. Override with TORTURE_SEED for replay. */
export const SEED = (() => {
    const raw = process.env.TORTURE_SEED;
    if (raw === undefined) return 0x9e3779b9;
    const n = Number(raw) >>> 0;
    return n === 0 ? 1 : n; // xorshift32 must not be seeded with 0
})();

/** Deliberately-broken control mode: injects a retained allocation into T6's hot loop. */
export const BREAK = process.env.TEXTLAYOUT_TORTURE_BREAK === '1';

/**
 * Base zero-GC rules. `maxArrayBuffersGrowth` needs measureOps `stabilize:'deep'`.
 * Unknown keys throw on every lane including checkNoGc; there is no
 * `maxExternalGrowth`. Do not add keys without reading ../LiteGCProfiler/llms.txt.
 *
 * `maxMinor: 0` (TL3): a scavenge inside a measured window is transient garbage
 * the hot path is not allowed to make. TL2 asserted `minor === 0` by hand on all
 * three T6 lanes; the gate would not have noticed it move. It is a rule now, so
 * a lane that triggers even one scavenge reddens the gate.
 *
 * `source` is NOT expressible as a checkNoGc rule (it is not a threshold; adding
 * it here would throw as an unknown key). It is pinned instead in `runOpsGate`,
 * which die()s when the profiler source is not 'gc' -- on any other source
 * maxMajor/maxMinor land inconclusive and the gate would pass vacuously.
 */
export const RULES = { maxMajor: 0, maxMinor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 };

/** Seeded xorshift32. Returns a function yielding a uint32 each call. */
export function makePrng(seed) {
    let x = (seed >>> 0) || 1;
    return function next() {
        x ^= x << 13; x >>>= 0;
        x ^= x >> 17;
        x ^= x << 5; x >>>= 0;
        return x >>> 0;
    };
}

/** Fail the whole gate. stdout stays clean; the reason goes to stderr. */
export function die(msg) {
    process.stderr.write('torture: FAIL -- ' + msg + '\n');
    process.exit(1);
}

/**
 * Assertion whose message is built ONLY on failure. Pass a thunk, not a string,
 * so the happy path allocates nothing.
 * @param {boolean} cond
 * @param {() => string} msgThunk
 */
export function check(cond, msgThunk) {
    if (!cond) die(msgThunk());
}

// --- shared fixtures, built ONCE at module load ----------------------------

// Canonical font stub. glyphs Int16Array(256*7) + kerning Int16Array(65536),
// all zero except xadvance (offset id*7+6): 12 for every letter, 6 for space
// and '.'. No other id is populated.
const FONT_GLYPHS = new Int16Array(256 * 7);
const FONT_KERNING = new Int16Array(65536);
for (let id = 65; id <= 90; id++) FONT_GLYPHS[id * 7 + 6] = 12;   // A..Z
for (let id = 97; id <= 122; id++) FONT_GLYPHS[id * 7 + 6] = 12;  // a..z
FONT_GLYPHS[32 * 7 + 6] = 6;   // space
FONT_GLYPHS[46 * 7 + 6] = 6;   // '.'

/** The canonical font stub, built once. */
export const FONT = { glyphs: FONT_GLYPHS, kerning: FONT_KERNING };

// The populated letter ids, for corpus generation.
const GLYPH_ID_LIST = [];
for (let id = 65; id <= 90; id++) GLYPH_ID_LIST.push(id);
for (let id = 97; id <= 122; id++) GLYPH_ID_LIST.push(id);

/** Int32Array of the populated letter ids. */
export const GLYPH_IDS = Int32Array.from(GLYPH_ID_LIST);

/** The TL-20 baseline paragraph: 360 characters, built once. */
export const TL20_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(8);

/** Read-back sentinel for the T0 no-read-back law. */
export const POISON = -12345;

/**
 * Independent width computation, written from the documented rules and never
 * lifted from TextLayout.js. Sums `glyphs[id*7+6]*scale` plus
 * `kerning[(prev<<8)|id]*scale`, with `prev` reset at line start and on any
 * id > 255. Never called inside a measured window.
 *
 * @param {string} text
 * @param {{glyphs:Int16Array, kerning:Int16Array}} font
 * @param {number} start   Inclusive line-start index.
 * @param {number} end     Exclusive line-end index.
 * @param {number} scale
 * @returns {number}
 */
export function sumWidth(text, font, start, end, scale) {
    let w = 0;
    let prev = -1;
    for (let i = start; i < end; i++) {
        const id = text.charCodeAt(i);
        if (id >= 0 && id < 256) {
            if (prev !== -1) w += font.kerning[(prev << 8) | id] * scale;
            w += font.glyphs[id * 7 + 6] * scale;
            prev = id;
        } else {
            prev = -1;
        }
    }
    return w;
}

/**
 * Build a corpus of `n` plain case objects `{ text, boxWidth, scale }`, ONCE,
 * before any loop. Generator parameters: word lengths 1..12 over GLYPH_IDS,
 * 0..40 words per case, 0..4 newlines, RUNS of 1..4 spaces between words,
 * leading and trailing whitespace on roughly a quarter of cases, and roughly one
 * case in 32 built entirely of spaces and newlines. boxWidth uniform in [0, 300],
 * scale from {0.5, 1, 2}. boxHeight is always 0 and is supplied by the tier.
 *
 * The multi-space runs and edge whitespace are deliberate: with exactly one
 * space between words the documented space-eater (skip the leading-space run on
 * the line after a soft break) is never exercised, and a mutant that deletes it
 * escapes the whole suite (the AR-02 blind spot).
 *
 * CRLF (TL3): roughly one in three of the BETWEEN-WORD newlines is emitted as
 * '\r\n' instead of '\n', so a meaningful share of the 50,000 T5 cases (about
 * 40%) carry a CR immediately before an LF -- the character TL2's CRLF gap was
 * blind to. The injection is scoped to the between-word site because that is a
 * simple, sufficient way to reach broad CRLF coverage across both the
 * non-truncating (T5 oracle differential) and truncating (T5 crlfInRange sweep,
 * T9 control 13) arms; it is NOT a claim about where the CR can land in the
 * OUTPUT. A near-degenerate box hard-breaks the last glyph before a CRLF
 * terminator onto its own line, parking the next line's start ON the CR and
 * emitting a legitimate empty range that begins with the CR (code 13). That is
 * correct, symmetric to the LF case, and T0 laws 1 and 7 both account for it (a
 * CR is accepted in a skipped gap and as an empty-line start only when its LF
 * follows at the next index; a lone CR still fails). The oracle models the CR as
 * the zero-advance glyph it is, so the differential is 0 including that case.
 *
 * @param {() => number} prng
 * @param {number} n
 * @returns {Array<{text:string, boxWidth:number, scale:number}>}
 */
export function makeCorpus(prng, n) {
    const scales = [0.5, 1, 2];
    const idCount = GLYPH_IDS.length;
    const out = new Array(n);
    for (let c = 0; c < n; c++) {
        const boxWidth = (prng() / 0xffffffff) * 300;   // [0, 300]
        const scale = scales[prng() % 3];

        // Roughly 1 in 32 cases is nothing but spaces and newlines.
        if ((prng() % 32) === 0) {
            const k = 1 + (prng() % 6);
            let ws = '';
            for (let j = 0; j < k; j++) ws += ((prng() & 3) === 0) ? '\n' : ' ';
            out[c] = { text: ws, boxWidth, scale };
            continue;
        }

        const wordCount = prng() % 41;   // 0..40 words
        const newlines = prng() % 5;     // 0..4 newlines
        const words = new Array(wordCount);
        for (let w = 0; w < wordCount; w++) {
            const wlen = 1 + (prng() % 12);   // 1..12 glyphs
            let s = '';
            for (let g = 0; g < wlen; g++) {
                s += String.fromCharCode(GLYPH_IDS[prng() % idCount]);
            }
            words[w] = s;
        }

        const parts = [];
        // Leading whitespace on ~1 in 4 cases (NOT skipped by the subject -- TL-14).
        if ((prng() % 4) === 0) parts.push(' '.repeat(1 + (prng() % 3)));

        if (wordCount === 0) {
            for (let j = 0; j < newlines; j++) parts.push('\n');
        } else {
            let nlLeft = newlines;
            for (let w = 0; w < wordCount; w++) {
                if (w > 0) {
                    if (nlLeft > 0 && (prng() % 3) === 0) {
                        // TL3: ~1 in 3 between-word newlines carries a CR (CRLF).
                        parts.push((prng() % 3) === 0 ? '\r\n' : '\n');
                        nlLeft--;
                    } else parts.push(' '.repeat(1 + (prng() % 4)));   // runs of 1..4 spaces
                }
                parts.push(words[w]);
            }
        }

        // Trailing whitespace on ~1 in 4 cases.
        if ((prng() % 4) === 0) parts.push(' '.repeat(1 + (prng() % 3)));

        out[c] = { text: parts.join(''), boxWidth, scale };
    }
    return out;
}

// --- the input-door matrix (TL2) -------------------------------------------

/**
 * The two KNOWN-GOOD tuples every door row varies exactly one argument from.
 * AR-02: a door test that does not first prove its base tuple is accepted can
 * pass for the wrong reason (a row that is wrong in two places throws about the
 * other one). `doorMisses` asserts both bases return a line count and do NOT
 * throw before it tests a single rejection.
 *
 * BASE_A has boxHeight 0, so `lineHeight <= 0` is legal there.
 * BASE_B has boxHeight 32 with lineHeight 16 (16 * 1 <= 32, so no zero-line
 * early exit), which is the only regime in which `lineHeight <= 0` is rejected.
 */
export const DOOR_BASE_A = { text: 'AAA BBB', bw: 100, bh: 0, lh: 16, scale: 1 };
export const DOOR_BASE_B = { text: 'AAA BBB', bw: 100, bh: 32, lh: 16, scale: 1 };

const SHORT_GLYPHS = new Int16Array(700);
const TINY_GLYPHS = new Int16Array(4);
const SHORT_KERNING = new Int16Array(4);
const FONT_SHORT_GLYPHS = { glyphs: SHORT_GLYPHS, kerning: FONT_KERNING };
const FONT_TINY_GLYPHS = { glyphs: TINY_GLYPHS, kerning: FONT_KERNING };
const FONT_SHORT_KERNING = { glyphs: FONT_GLYPHS, kerning: SHORT_KERNING };

/**
 * Every door rejection, one row per value, each varying EXACTLY ONE argument
 * from its named base tuple. `needs` lists substrings the message must contain
 * -- the argument name plus the requirement, so a row cannot pass on a message
 * about a different argument.
 *
 * Built ONCE at module load. Never touched inside a measured window.
 */
export const DOOR_ROWS = [
    // TL-09 -- text (4 rows)
    { id: 'TL-09', base: 'A', arg: 'text', value: 12345, needs: ['text', 'string'] },
    { id: 'TL-09', base: 'A', arg: 'text', value: null, needs: ['text', 'string'] },
    { id: 'TL-09', base: 'A', arg: 'text', value: undefined, needs: ['text', 'string'] },
    { id: 'TL-09', base: 'A', arg: 'text', value: ['A'], needs: ['text', 'string'] },
    // TL-09 -- font (3 rows)
    { id: 'TL-09', base: 'A', arg: 'font', value: {}, needs: ['font.glyphs'] },
    { id: 'TL-09', base: 'A', arg: 'font', value: null, needs: ['font'] },
    { id: 'TL-09', base: 'A', arg: 'font', value: undefined, needs: ['font'] },
    // TL-08 -- short tables (3 rows)
    { id: 'TL-08', base: 'A', arg: 'font', value: FONT_SHORT_GLYPHS, needs: ['font.glyphs', '700', '1792'] },
    { id: 'TL-08', base: 'A', arg: 'font', value: FONT_TINY_GLYPHS, needs: ['font.glyphs', '4', '1792'] },
    { id: 'TL-08', base: 'A', arg: 'font', value: FONT_SHORT_KERNING, needs: ['font.kerning', '4', '65536'] },
    // TL-05 -- boxWidth (4 rows)
    { id: 'TL-05', base: 'A', arg: 'bw', value: -1, needs: ['boxWidth', 'negative'] },
    { id: 'TL-05', base: 'A', arg: 'bw', value: -100, needs: ['boxWidth', 'negative'] },
    { id: 'TL-05', base: 'A', arg: 'bw', value: NaN, needs: ['boxWidth', 'finite'] },
    { id: 'TL-05', base: 'A', arg: 'bw', value: -Infinity, needs: ['boxWidth', 'finite'] },
    // boxHeight (2 rows) -- same family as TL-05, the vertical axis
    { id: 'TL-05', base: 'A', arg: 'bh', value: NaN, needs: ['boxHeight', 'finite'] },
    { id: 'TL-05', base: 'A', arg: 'bh', value: -1, needs: ['boxHeight', 'negative'] },
    // TL-06 -- lineHeight (3 rows). NaN throws from EITHER base; 0 and -16 only
    // from base B, where boxHeight > 0 makes the value load-bearing.
    { id: 'TL-06', base: 'A', arg: 'lh', value: NaN, needs: ['lineHeight', 'finite'] },
    { id: 'TL-06', base: 'B', arg: 'lh', value: 0, needs: ['lineHeight', '> 0'] },
    { id: 'TL-06', base: 'B', arg: 'lh', value: -16, needs: ['lineHeight', '> 0'] },
    // TL-03 / TL-04 -- scale (4 rows)
    { id: 'TL-03', base: 'A', arg: 'scale', value: NaN, needs: ['scale', 'finite'] },
    { id: 'TL-03', base: 'A', arg: 'scale', value: Infinity, needs: ['scale', 'finite'] },
    { id: 'TL-04', base: 'A', arg: 'scale', value: 0, needs: ['scale', '> 0'] },
    { id: 'TL-04', base: 'A', arg: 'scale', value: -1, needs: ['scale', '> 0'] },
];

/**
 * Run every DOOR_ROWS row through `call` and count the MISSES -- rows that did
 * not throw a `TextLayoutError` whose message contains every `needs` substring.
 *
 * `call(text, font, bw, bh, lh, scale)` performs one layout attempt; the caller
 * closes over its own buffer (or has none, for `countLines`). This is the ONE
 * door detector: T1 runs it against the real entry points requiring 0, and T9
 * controls 9 and 10 run it against deliberately doorless stubs requiring more
 * than 0. Neither can drift to a weaker predicate than the other.
 *
 * Fails closed on vacuity: if either base tuple throws, the whole matrix would
 * "pass" for the wrong reason, so that is a die() rather than a miss.
 *
 * @param {(text:*, font:*, bw:*, bh:*, lh:*, scale:*)=>number} call
 * @param {string} label   Named in every failure message.
 * @returns {number}       Number of rows the door failed to reject correctly.
 */
export function doorMisses(call, label) {
    // The negative half, first and always: both known-good tuples are accepted.
    const bases = [DOOR_BASE_A, DOOR_BASE_B];
    for (let b = 0; b < bases.length; b++) {
        const g = bases[b];
        let n = -1;
        try {
            n = call(g.text, FONT, g.bw, g.bh, g.lh, g.scale);
        } catch (err) {
            die('doorMisses(' + label + '): the known-good base tuple ' + (b === 0 ? 'A' : 'B') +
                ' threw ' + (err && err.name) + ' -- every rejection below would pass vacuously');
        }
        if (!(n >= 1)) {
            die('doorMisses(' + label + '): base tuple ' + (b === 0 ? 'A' : 'B') + ' returned ' + n +
                ', expected a real line count -- the matrix is measuring nothing');
        }
    }

    let misses = 0;
    for (let r = 0; r < DOOR_ROWS.length; r++) {
        const row = DOOR_ROWS[r];
        const g = row.base === 'B' ? DOOR_BASE_B : DOOR_BASE_A;
        const text = row.arg === 'text' ? row.value : g.text;
        const font = row.arg === 'font' ? row.value : FONT;
        const bw = row.arg === 'bw' ? row.value : g.bw;
        const bh = row.arg === 'bh' ? row.value : g.bh;
        const lh = row.arg === 'lh' ? row.value : g.lh;
        const sc = row.arg === 'scale' ? row.value : g.scale;
        let threw = false;
        let msg = '';
        try {
            call(text, font, bw, bh, lh, sc);
        } catch (err) {
            threw = err instanceof TextLayoutError;
            msg = (err && err.message) || '';
        }
        if (!threw) { misses++; continue; }
        for (let k = 0; k < row.needs.length; k++) {
            if (msg.indexOf(row.needs[k]) === -1) { misses++; break; }
        }
        // TL-09's whole point: the message must not be a raw property read.
        if (msg.indexOf('Cannot read properties') !== -1) misses++;
    }
    return misses;
}

// --- the whitespace/CR detectors (TL-26, TL-13) ----------------------------

/**
 * Count PHANTOM lines in a written layout: zero-length ranges whose preceding
 * character is a space. That is exactly TL-26's signature, and exactly the
 * discriminator that leaves a DELIBERATE blank line (preceded by a newline)
 * alone. Shared so T1's pins and T9 control 11 cannot test different things.
 *
 * @param {string} text
 * @param {Float32Array} buf
 * @param {number} n
 * @returns {number}
 */
export function countPhantoms(text, buf, n) {
    let c = 0;
    for (let k = 0; k < n; k++) {
        const s = buf[k * 4];
        if (s === buf[k * 4 + 1] && s > 0 && text.charCodeAt(s - 1) === 32) c++;
    }
    return c;
}

/**
 * Count emitted ranges that contain a CR immediately followed by an LF. A
 * renderer walking `[start, end)` would draw that CR, and the CR is not in
 * `lineWidth` -- TL-13 exactly. Shared with T9 control 12.
 *
 * @param {string} text
 * @param {Float32Array} buf
 * @param {number} n
 * @returns {number}
 */
export function crlfInRange(text, buf, n) {
    let c = 0;
    for (let k = 0; k < n; k++) {
        const s = buf[k * 4];
        const e = buf[k * 4 + 1];
        for (let j = s; j < e; j++) {
            // `charCodeAt(j + 1)` reads ONE PAST the range end when j === e - 1.
            // That is deliberate and load-bearing: a CR at the very end of an
            // emitted range with its LF sitting just OUTSIDE the range is exactly
            // the bug this hunts (endIdx should have excluded the CR). Past the
            // string end `charCodeAt` is NaN, and `NaN !== 10`, so the last
            // character of the last line can never false-positive. Do not "tidy"
            // this to `j + 1 < e` -- that blinds the detector to the only case
            // it exists for and turns the whole CRLF sweep into a no-op.
            if (text.charCodeAt(j) === 13 && text.charCodeAt(j + 1) === 10) { c++; break; }
        }
    }
    return c;
}

// --- the flags tripwire ----------------------------------------------------

/**
 * Walk the flags slots (3, 7, 11, ...) of the first `n` lines of `buf` and
 * report two INDEPENDENT violation classes as one packed integer:
 *
 *   - bit 1 and above: the number of slots holding a value outside
 *     `{FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW}`. NaN fails all three
 *     equalities and is counted, which is the fail-closed answer.
 *   - bit 0: 1 when this ONE output carries both a FLAG_TRUNCATED line and a
 *     FLAG_OVERFLOW line. The two are documented mutually exclusive in a single
 *     call (decisions/0001-flag-overflow.md); a run carrying both means a
 *     truncating call also overflowed its buffer, which the contract forbids.
 *
 * Unpack as `count >> 1` (bad values) and `count & 1` (both flags).
 *
 * Allocation-free by construction -- four number locals, no arrays, no
 * subarray, no closure. T5 calls it 50,000 times and T9 control 8 gates it, so
 * the control cannot test a weaker predicate than the fuzz does.
 *
 * @param {Float32Array} buf
 * @param {number} n   Number of lines written into `buf`.
 * @returns {number}   `(badValueCount << 1) | bothFlags`
 */
export function scanFlags(buf, n) {
    let bad = 0;
    let hasTrunc = 0;
    let hasOver = 0;
    for (let k = 0; k < n; k++) {
        const f = buf[k * 4 + 3];
        if (f === FLAG_NORMAL) continue;
        if (f === FLAG_TRUNCATED) { hasTrunc = 1; continue; }
        if (f === FLAG_OVERFLOW) { hasOver = 1; continue; }
        bad++;
    }
    return (bad * 2) + (hasTrunc & hasOver);
}

// --- the countLines agreement comparator -----------------------------------

/** Unbounded buffer for agreeCount. Big enough that no corpus case caps here. */
const AGREE_OUT = new Float32Array(4 * 1024);

/**
 * The ONE comparator both the T0 agreement law (law 9) and T9 control 3 run, so
 * control 3 cannot accidentally test a different, weaker comparison. For each
 * case it compares `fnCount(...)` against `computeWrap(..., AGREE_OUT, ...)` and
 * counts mismatches. It fails closed on vacuity: if the computeWrap side ever
 * carries FLAG_OVERFLOW, AGREE_OUT was too small and the comparison proved
 * nothing, so it die()s rather than returning a meaningless 0.
 *
 * `cs` is an array of `{ text, boxWidth, boxHeight, lineHeight, scale }`;
 * boxHeight defaults to 0 and lineHeight to 16 when omitted.
 *
 * @param {(text:string, font:object, bw:number, bh:number, lh:number, s:number)=>number} fnCount
 * @param {Array<{text:string, boxWidth:number, boxHeight?:number, lineHeight?:number, scale:number}>} cs
 * @returns {number} number of cases where fnCount disagreed with computeWrap
 */
export function agreeCount(fnCount, cs) {
    let mism = 0;
    for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const bh = c.boxHeight === undefined ? 0 : c.boxHeight;
        const lh = c.lineHeight === undefined ? 16 : c.lineHeight;
        const cw = TextLayout.computeWrap(c.text, FONT, c.boxWidth, bh, lh, AGREE_OUT, c.scale);
        for (let k = 0; k < cw; k++) {
            if (AGREE_OUT[k * 4 + 3] === FLAG_OVERFLOW) {
                die('agreeCount: OUT_BIG too small, the agreement law is not measuring anything');
            }
        }
        const cl = fnCount(c.text, FONT, c.boxWidth, bh, lh, c.scale);
        if (cl !== cw) mism++;
    }
    return mism;
}

// --- gate wrappers ---------------------------------------------------------

/**
 * Run `fn(i)` under a single measured window and gate it against RULES.
 * Uses measureOps with `stabilize:'deep'` so the `maxArrayBuffersGrowth` rule
 * is resolvable (ArrayBuffer backing stores live outside the V8 heap).
 *
 * @param {(i:number)=>void} fn   Sync, zero-alloc hot body.
 * @param {{ops:number, warmup?:number}} opts
 * @returns {{report:object, summary:object}}
 */
export function runOpsGate(fn, opts) {
    const res = measureOps(fn, {
        ops: opts.ops,
        warmup: opts.warmup === undefined ? 0 : opts.warmup,
        stabilize: 'deep',
    });
    // Pin the source (TL3). maxMajor/maxMinor are only verifiable on the 'gc'
    // source (perf_hooks under --expose-gc); on any other source they land
    // inconclusive and checkNoGc would report a vacuous non-failure. A gate that
    // cannot verify its own metric is not a gate, so this is a die(), not a warn.
    if (res.summary.source !== 'gc') {
        die('runOpsGate: gc-profiler source is "' + res.summary.source + '", not "gc" -- ' +
            'maxMajor/maxMinor are unverifiable and the zero-alloc gate would pass vacuously. ' +
            'Run with node --expose-gc.');
    }
    return { report: checkNoGc(res.summary, RULES), summary: res.summary };
}

/**
 * Run `fn` under a single measureAllocs window and gate bytes-per-call to 0.
 * `iterations` is REQUIRED and must be a positive integer or measureAllocs
 * throws. Requires --expose-gc; rejects async functions.
 *
 * @param {(i:number)=>void} fn   Sync, zero-alloc hot body.
 * @param {{iterations:number}} opts
 * @returns {{report:object, allocs:object}}
 */
export function runAllocGate(fn, opts) {
    const allocs = measureAllocs(fn, { iterations: opts.iterations });
    return { report: checkAllocs(allocs, { maxBytesPerCall: 0 }), allocs };
}

// --- known-failing / todo / finish bookkeeping -----------------------------

let knownFailingCount = 0;
let todoCount = 0;

/**
 * Assert a known bug is STILL present. `stillBrokenFn()` returning true records
 * the entry to stderr and continues; returning false means the bug was fixed
 * without claiming the win, which is a die().
 *
 * @param {string} id
 * @param {() => boolean} stillBrokenFn
 */
export function knownFailing(id, stillBrokenFn) {
    if (stillBrokenFn()) {
        process.stderr.write('torture: KNOWN-FAILING -- ' + id + '\n');
        knownFailingCount++;
    } else {
        die(id + ' no longer reproduces -- promote it to a passing assertion and delete this entry');
    }
}

/**
 * Record a deferred obligation naming the session that lands it.
 * @param {string} id
 * @param {string} msg
 */
export function todo(id, msg) {
    process.stderr.write('torture: TODO -- ' + id + ': ' + msg + '\n');
    todoCount++;
}

/**
 * Called by the entry point before printing `ok`. Writes the known-failing and
 * todo counts to stderr. Nothing but `ok\n` ever reaches stdout.
 */
export function finish() {
    process.stderr.write(
        'torture: known-failing=' + knownFailingCount + ' todo=' + todoCount + '\n');
}
