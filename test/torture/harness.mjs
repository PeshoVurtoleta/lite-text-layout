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
import { TextLayout, FLAG_OVERFLOW } from '../../TextLayout.js';

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
 */
export const RULES = { maxMajor: 0, maxPauseMs: 4, maxArrayBuffersGrowth: 0 };

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
                    if (nlLeft > 0 && (prng() % 3) === 0) { parts.push('\n'); nlLeft--; }
                    else parts.push(' '.repeat(1 + (prng() % 4)));   // runs of 1..4 spaces
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
