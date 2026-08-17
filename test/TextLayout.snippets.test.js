// Runnable-snippet guard (TL4, BRIEF Phase D / assertion 7).
//
// The README shows code. This test EXECUTES that code, so a copied example
// cannot silently rot. Extraction is mechanical: every fenced block preceded by
// a `<!--RUN-->` marker line is pulled out and run. Editing the surrounding
// prose cannot desynchronise the test from the shown code.
//
// THE HEADLESS BOUNDARY: `drawWrapped` needs a canvas 2D context, which does not
// exist under `node --test`. This test proves THIS package's calls run for real
// (computeWrap / countLines over a BitmapFont, with asserted line count, flags
// and widths) and that the pipeline WIRES UP -- the `drawWrapped` line runs
// against a recording `ctx` stub whose `drawImage` counts blits. It does NOT
// prove a real canvas renders pixels; that is bmfont's own test.
//
// node:test + node:fs; imports the real BitmapFont (a devDependency) and this
// package. No DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BitmapFont } from '@zakkster/lite-bmfont';
import * as TL from '../TextLayout.js';

const { TextLayout, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW } = TL;

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

// --- mechanical extraction of the <!--RUN--> fenced blocks --------------------
function extractRunBlocks(md) {
    const lines = md.split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== '<!--RUN-->') continue;
        // The next non-empty line must open a fenced code block.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j >= lines.length || !/^```/.test(lines[j])) continue;
        const body = [];
        for (let k = j + 1; k < lines.length; k++) {
            if (/^```/.test(lines[k])) { blocks.push(body.join('\n')); break; }
            body.push(lines[k]);
        }
    }
    return blocks;
}

// --- a headless font: printable ASCII 32..126 with nonzero advances -----------
function makeFontJson() {
    const chars = [];
    for (let id = 32; id <= 126; id++) {
        const space = id === 32;
        chars.push({
            id,
            x: id, y: 0,
            width: space ? 0 : 6,
            height: space ? 0 : 10,
            xoffset: 0, yoffset: 0,
            xadvance: space ? 5 : 7,
        });
    }
    return { common: { lineHeight: 14, base: 11 }, chars };
}
const atlasImage = { width: 128, height: 16 };   // opaque to drawImage
const fontJson = makeFontJson();

// A recording 2D-context stub: the pipeline blits through here.
function recordingCtx() {
    return { n: 0, drawImage() { this.n++; } };
}

// Independent oracle for the blit count: mirror drawWrapped's per-glyph filter
// (id in [0,256), glyph width and height both > 0) over the emitted ranges.
function expectedBlits(font, text, layout, count) {
    const tlen = text.length;
    let blits = 0;
    for (let l = 0; l < count; l++) {
        let start = layout[l * 4];
        let end = layout[l * 4 + 1];
        if (!(start >= 0)) start = 0;
        if (!(end <= tlen)) end = tlen;
        for (let i = start; i < end; i++) {
            const id = text.charCodeAt(i);
            if (!(id >= 0 && id < 256)) continue;
            const g = id * 7;
            if (font.glyphs[g + 2] > 0 && font.glyphs[g + 3] > 0) blits++;
        }
    }
    return blits;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

async function runBlock(src, ctx) {
    // Strip the import lines; the bindings are injected instead.
    const stripped = src.split('\n').filter((l) => !/^\s*import\s/.test(l)).join('\n');
    const epilogue =
        '\n;return {' +
        ' layout: (typeof layout !== "undefined" ? layout : null),' +
        ' lineCount: (typeof lineCount !== "undefined" ? lineCount : null),' +
        ' written: (typeof written !== "undefined" ? written : null),' +
        ' text: (typeof text !== "undefined" ? text : null),' +
        ' font: (typeof font !== "undefined" ? font : null) };';
    const injected = {
        BitmapFont, TextLayout, FLAG_NORMAL, FLAG_TRUNCATED, FLAG_OVERFLOW,
        atlasImage, fontJson, ctx,
    };
    const fn = new AsyncFunction(...Object.keys(injected), stripped + epilogue);
    return fn(...Object.values(injected));
}

const BLOCKS = extractRunBlocks(README);

test('at least the two runnable README blocks were extracted', () => {
    assert.ok(BLOCKS.length >= 2, 'expected >= 2 <!--RUN--> blocks, got ' + BLOCKS.length);
});

test('each runnable README block executes this package end to end', async () => {
    for (let b = 0; b < BLOCKS.length; b++) {
        const ctx = recordingCtx();
        const r = await runBlock(BLOCKS[b], ctx);

        const count = r.written != null ? r.written : r.lineCount;
        assert.ok(Number.isInteger(count) && count >= 1,
            'block ' + b + ': computeWrap returned no lines (' + count + ')');
        assert.ok(r.layout instanceof Float32Array, 'block ' + b + ': no layout buffer');
        assert.ok(r.layout.length >= count * 4, 'block ' + b + ': layout smaller than lineCount');
        assert.equal(typeof r.text, 'string', 'block ' + b + ': no text bound');

        // Flags are a value space; widths are non-negative.
        for (let l = 0; l < count; l++) {
            const flags = r.layout[l * 4 + 3];
            assert.ok(flags === FLAG_NORMAL || flags === FLAG_TRUNCATED || flags === FLAG_OVERFLOW,
                'block ' + b + ' line ' + l + ': bad flags ' + flags);
            assert.ok(r.layout[l * 4 + 2] >= 0, 'block ' + b + ' line ' + l + ': negative width');
        }

        // The pipeline wired up: the recording ctx received exactly the blits
        // the emitted ranges imply.
        const expected = expectedBlits(r.font, r.text, r.layout, count);
        assert.equal(ctx.n, expected,
            'block ' + b + ': drawWrapped blitted ' + ctx.n + ', expected ' + expected);
        assert.ok(ctx.n > 0, 'block ' + b + ': pipeline drew nothing');
    }
});
