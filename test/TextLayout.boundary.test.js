// Boundary matrix for @zakkster/lite-text-layout -- node:test only, adopted in
// TL3 from TL2 QA. Imports nothing outside the package. Pins contract corners
// asserted in prose but not previously executable in the shipped tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TextLayout, TextLayoutError, FLAG_NORMAL, FLAG_OVERFLOW, FLAG_TRUNCATED }
    from '../TextLayout.js';

const G = new Int16Array(256 * 7), K = new Int16Array(65536);
for (let i = 65; i <= 90; i++) G[i * 7 + 6] = 12;
G[32 * 7 + 6] = 6; G[46 * 7 + 2] = 4; G[46 * 7 + 6] = 6;
const FONT = { glyphs: G, kerning: K };
const doorMsg = (fn) => { try { fn(); return null; } catch (e) {
    assert.ok(e instanceof TextLayoutError, 'wrong class: ' + e.name + ' ' + e.message);
    assert.doesNotMatch(e.message, /Cannot read properties/); return e.message; } };

test('buffer capacity 0 / 1 / N-1 / N / N+1 lines', () => {
    // 'AAA BBB CCC' at boxWidth 40 is exactly N = 3 lines.
    const N = TextLayout.countLines('AAA BBB CCC', FONT, 40, 0, 16, 1);
    assert.equal(N, 3);
    // capacity 0 (no whole stride): returns 0, writes nothing, no flag slot.
    const z = new Float32Array(3).fill(-1);
    assert.equal(TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, z, 1), 0);
    assert.deepEqual(Array.from(z), [-1, -1, -1]);
    // capacity 1
    const c1 = new Float32Array(4);
    assert.equal(TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, c1, 1), 1);
    assert.equal(c1[3], FLAG_OVERFLOW);
    // capacity N-1 == 2 -> overflow on the last written line
    const cN1 = new Float32Array(8);
    assert.equal(TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, cN1, 1), 2);
    assert.equal(cN1[7], FLAG_OVERFLOW);
    // capacity N -> exact fit, no overflow
    const cN = new Float32Array(12);
    assert.equal(TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, cN, 1), N);
    assert.equal(cN[11], FLAG_NORMAL);
    // capacity N+1 -> identical prefix, spare slots untouched
    const cN2 = new Float32Array(16).fill(-1);
    assert.equal(TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, cN2, 1), N);
    assert.deepEqual(Array.from(cN2.slice(0, 12)), Array.from(cN.slice(0, 12)));
    assert.deepEqual(Array.from(cN2.slice(12)), [-1, -1, -1, -1]);
});

test('empty text is 0 lines on both entry points and writes nothing', () => {
    const b = new Float32Array(8).fill(-7);
    assert.equal(TextLayout.computeWrap('', FONT, 40, 0, 16, b, 1), 0);
    assert.deepEqual(Array.from(b), [-7, -7, -7, -7, -7, -7, -7, -7]);
    assert.equal(TextLayout.countLines('', FONT, 40, 0, 16, 1), 0);
});

test('null / undefined / NaN / -0 at every numeric and object door', () => {
    const out = new Float32Array(16);
    const W = (bw, bh, lh, s, t = 'AAA BBB', f = FONT, b = out) =>
        doorMsg(() => TextLayout.computeWrap(t, f, bw, bh, lh, b, s));
    // null is not zero -- every numeric slot rejects it as non-finite? No:
    // Number.isFinite(null) is false, so null throws "finite", never aliases 0.
    for (const [name, call] of [
        ['boxWidth', () => W(null, 0, 16, 1)], ['boxHeight', () => W(0, null, 16, 1)],
        ['lineHeight', () => W(0, 0, null, 1)], ['scale', () => W(0, 0, 16, null)]]) {
        assert.match(call(), new RegExp(name + '.*finite'), name + ' must reject null as non-finite');
    }
    // undefined likewise (and scale=undefined is the DEFAULT path, so test it explicitly)
    for (const [name, call] of [
        ['boxWidth', () => W(undefined, 0, 16, 1)], ['boxHeight', () => W(0, undefined, 16, 1)],
        ['lineHeight', () => W(0, 0, undefined, 1)]]) {
        assert.match(call(), new RegExp(name + '.*finite'), name + ' must reject undefined');
    }
    // scale === undefined hits the default parameter and is VALID (scale 1).
    assert.equal(TextLayout.computeWrap('AAA BBB', FONT, 0, 0, 16, out, undefined), 1);
    // NaN everywhere
    for (const [name, call] of [
        ['boxWidth', () => W(NaN, 0, 16, 1)], ['boxHeight', () => W(0, NaN, 16, 1)],
        ['lineHeight', () => W(0, 0, NaN, 1)], ['scale', () => W(0, 0, 16, NaN)]]) {
        assert.match(call(), new RegExp(name + '.*finite'), name + ' must reject NaN');
    }
    // -0 aliases 0 on both box axes and is NOT rejected as negative.
    assert.equal(TextLayout.computeWrap('AAA BBB', FONT, -0, -0, 16, out, 1), 1);
    assert.equal(TextLayout.countLines('AAA BBB', FONT, -0, -0, 16, 1), 1);
    // -0 for scale IS rejected: -0 <= 0.
    assert.match(W(0, 0, 16, -0), /scale.*> 0/);
    // text/font null and undefined
    assert.match(doorMsg(() => TextLayout.computeWrap(null, FONT, 0, 0, 16, out, 1)), /text.*string/);
    assert.match(doorMsg(() => TextLayout.computeWrap(undefined, FONT, 0, 0, 16, out, 1)), /text.*string/);
    assert.match(doorMsg(() => TextLayout.computeWrap('A', null, 0, 0, 16, out, 1)), /font/);
    assert.match(doorMsg(() => TextLayout.computeWrap('A', undefined, 0, 0, 16, out, 1)), /font/);
    assert.match(doorMsg(() => TextLayout.computeWrap('A', FONT, 0, 0, 16, null, 1)), /outBuffer/);
    assert.match(doorMsg(() => TextLayout.computeWrap('A', FONT, 0, 0, 16, undefined, 1)), /outBuffer/);
});

test('table length boundaries 1791 / 1792 / 1793 and 65535 / 65536', () => {
    const out = new Float32Array(8);
    const mk = (g, k) => ({ glyphs: new Int16Array(g), kerning: new Int16Array(k) });
    assert.match(doorMsg(() => TextLayout.computeWrap('A', mk(1791, 65536), 0, 0, 16, out, 1)),
        /font\.glyphs.*1791.*1792/s);
    assert.equal(TextLayout.computeWrap('A', mk(1792, 65536), 0, 0, 16, out, 1), 1);
    assert.equal(TextLayout.computeWrap('A', mk(1793, 65536), 0, 0, 16, out, 1), 1);
    assert.match(doorMsg(() => TextLayout.computeWrap('A', mk(1792, 65535), 0, 0, 16, out, 1)),
        /font\.kerning.*65535.*65536/s);
    assert.equal(TextLayout.computeWrap('A', mk(1792, 65537), 0, 0, 16, out, 1), 1);
});

test('zero-line boundary is > not >=, on both entry points', () => {
    const out = new Float32Array(8).fill(-3);
    assert.equal(TextLayout.computeWrap('AAA', FONT, 0, 16, 16, out, 1), 1);   // exactly one line
    assert.equal(TextLayout.computeWrap('AAA', FONT, 0, 15.999, 16, out, 1), 0);
    assert.equal(out[0], 0);                                                   // 15.999 wrote nothing
    assert.equal(TextLayout.countLines('AAA', FONT, 0, 15.999, 16, 1), 0);
    assert.equal(TextLayout.countLines('AAA', FONT, 0, 16, 16, 1), 1);
    // scale participates: lineHeight * scale, not lineHeight.
    assert.equal(TextLayout.computeWrap('AAA', FONT, 0, 31, 16, out, 2), 0);
    assert.equal(TextLayout.computeWrap('AAA', FONT, 0, 32, 16, out, 2), 1);
});

test('repeated identical calls are idempotent; the door is stateless', () => {
    const a = new Float32Array(16), b = new Float32Array(16);
    for (let i = 0; i < 5; i++) TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, a, 1);
    TextLayout.computeWrap('AAA BBB CCC', FONT, 40, 0, 16, b, 1);
    assert.deepEqual(Array.from(a), Array.from(b));
    // A rejected call leaves no residue: the next valid call is unaffected.
    for (let i = 0; i < 5; i++) assert.throws(() => TextLayout.countLines('A', FONT, NaN, 0, 16, 1), TextLayoutError);
    assert.equal(TextLayout.countLines('AAA BBB CCC', FONT, 40, 0, 16, 1), 3);
});

test('CRLF: bare, doubled, trailing, and at index 0', () => {
    const out = new Float32Array(64);
    const s = (n) => Array.from(out.slice(0, n * 4)).join(',');
    assert.equal(TextLayout.computeWrap('\r\n', FONT, 0, 0, 16, out, 1), 1);
    assert.equal(s(1), '0,0,0,0');
    assert.equal(TextLayout.computeWrap('\r\n\r\n', FONT, 0, 0, 16, out, 1), 2);
    assert.equal(s(2), '0,0,0,0,2,2,0,0');
    assert.equal(TextLayout.computeWrap('AAA\r\n', FONT, 0, 0, 16, out, 1), 1);
    assert.equal(s(1), '0,3,36,0');
    // CRLF and LF agree on count and width for every boxHeight.
    for (const bh of [0, 16, 32, 48, 1e9]) {
        const nCr = TextLayout.computeWrap('AAA\r\nBBB\r\nCCC', FONT, 0, bh, 16, out, 1);
        const w = Array.from(out.slice(0, nCr * 4));
        const nLf = TextLayout.computeWrap('AAA\nBBB\nCCC', FONT, 0, bh, 16, out, 1);
        assert.equal(nCr, nLf, 'boxHeight ' + bh);
        for (let k = 0; k < nLf; k++) assert.equal(w[k * 4 + 2], out[k * 4 + 2], 'width bh ' + bh + ' line ' + k);
    }
});

test('ADVERSARIAL 1: a Float32Array VIEW with a non-zero byteOffset', () => {
    // instanceof passes; the writes must land inside the view, and the capacity
    // must be the VIEW length, not the underlying buffer length. A slip here
    // corrupts memory the caller owns for something else. The planner's matrix
    // only ever passes whole-buffer Float32Arrays.
    const arena = new Float32Array(32).fill(-9);
    const view = arena.subarray(8, 20);                 // 12 floats == 3 line slots
    assert.equal(view.byteOffset, 32);
    const n = TextLayout.computeWrap('AAA BBB CCC DDD', FONT, 40, 0, 16, view, 1);
    assert.equal(n, 3, 'capacity must be the view length (3 lines), not the arena');
    assert.equal(view[11], FLAG_OVERFLOW, 'a 4-line layout into 3 slots must flag overflow');
    for (let i = 0; i < 8; i++) assert.equal(arena[i], -9, 'wrote before the view at ' + i);
    for (let i = 20; i < 32; i++) assert.equal(arena[i], -9, 'wrote past the view at ' + i);
});

test('ADVERSARIAL 2: a String object, a boxed Number, and a getter font', () => {
    const out = new Float32Array(16);
    // `new String('AAA')` has .length and .charCodeAt and would sail through a
    // duck-typed door, producing a correct-looking layout for a value the
    // contract says is not a string.
    assert.match(doorMsg(() => TextLayout.computeWrap(new String('AAA'), FONT, 0, 0, 16, out, 1)),
        /text.*string/);
    assert.match(doorMsg(() => TextLayout.computeWrap('AAA', FONT, new Number(40), 0, 16, out, 1)),
        /boxWidth.*finite/);
    // A font whose tables are ACCESSORS. MEASURED, not assumed: the loop
    // indexes `font.glyphs[...]` directly, so with a getter the table is
    // re-read once per character. That is pre-existing (1.1.0 does the same)
    // and costs nothing for a plain-object font, but it means an accessor font
    // can swap its table mid-layout. The DOOR's contribution is exactly ONE
    // extra read of each table per call -- that is the claim
    // decisions/0002 makes ("read at the door and never per character") and
    // this is what pins it. 1.1.0: 12 / 8. 1.2.0: 13 / 9.
    let glyphReads = 0, kernReads = 0;
    const spy = { get glyphs() { glyphReads++; return G; }, get kerning() { kernReads++; return K; } };
    assert.equal(TextLayout.computeWrap('AAA BBB CCC', spy, 40, 0, 16, out, 1), 3);
    // 14 = 1 door + 2 ellipsis probes ('.' has width in this atlas) + 11 chars.
    assert.equal(glyphReads, 14, 'font.glyphs read count moved');
    assert.equal(kernReads, 9, 'font.kerning read count moved');
    // The load-bearing half: reads track TEXT LENGTH, one per character, and the
    // door's contribution is a CONSTANT. Adding three characters adds three reads.
    glyphReads = 0; kernReads = 0;
    TextLayout.computeWrap('AAA BBB CCCDDD', spy, 40, 0, 16, out, 1);
    // 18 = 14 (3 more characters) + 1: 'CCCDDD' HARD-breaks, and the re-seed
    // `cursorX = font.glyphs[id * 7 + 6] * scale` reads the table once more.
    // Linear in characters plus one per hard break -- never quadratic.
    assert.equal(glyphReads, 18, 'the per-character table read is not linear in text length');
    assert.equal(kernReads, 12, 'the per-character kerning read is not linear in text length');
});

test('ADVERSARIAL 3: outBuffer aliasing font.glyphs, the documented caller error', () => {
    // decisions/0002 says: caller error, undefined result, NO runtime check.
    // Pin that it does not throw and does not hang -- the documented claim.
    const g = new Int16Array(256 * 7);
    for (let i = 65; i <= 90; i++) g[i * 7 + 6] = 12;
    g[32 * 7 + 6] = 6;
    const f = { glyphs: g, kerning: new Int16Array(65536) };
    const aliased = new Float32Array(g.buffer);
    assert.doesNotThrow(() => TextLayout.computeWrap('AAA BBB', f, 40, 0, 16, aliased, 1));
    // And the arena counter-example the decision file names must WORK.
    const arena = new ArrayBuffer(1024 * 64);
    const glyphs = new Int16Array(arena, 0, 256 * 7);
    for (let i = 65; i <= 90; i++) glyphs[i * 7 + 6] = 12;
    glyphs[32 * 7 + 6] = 6;
    const layout = new Float32Array(arena, 4096, 256);
    assert.equal(TextLayout.computeWrap('AAA BBB', { glyphs, kerning: new Int16Array(65536) },
        40, 0, 16, layout, 1), 2);
});

test('ADVERSARIAL 4: truncation and overflow can never both appear', () => {
    const out = new Float32Array(8);
    // A truncating run that also has too small a buffer: TRUNCATED wins and
    // OVERFLOW must not appear, because a truncating run fits its own cap.
    const n = TextLayout.computeWrap('AAAA BBBB CCCC DDDD EEEE', FONT, 60, 40, 16, out, 1);
    const flags = [];
    for (let k = 0; k < n; k++) flags.push(out[k * 4 + 3]);
    assert.ok(!(flags.includes(FLAG_TRUNCATED) && flags.includes(FLAG_OVERFLOW)), flags.join(','));
});

test('frozen namespace and error identity', () => {
    assert.ok(Object.isFrozen(TextLayout));
    assert.throws(() => { TextLayout.computeWrap = null; }, TypeError);
    const e = new TextLayoutError('x');
    assert.ok(e instanceof Error && e.name === 'TextLayoutError');
});
