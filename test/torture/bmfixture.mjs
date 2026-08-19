/**
 * Shared @zakkster/lite-bmfont test fixtures (TL5).
 *
 * bmfont enters as a TEST-ONLY devDependency (never a runtime dependency, either
 * direction). This module owns the BitmapFont stub and the canvas2d recorders so
 * the cross-package tier (T8) and the zero-alloc pipeline lane (T6 lane 4) share
 * ONE construction of each. Everything here is built ONCE at module load; nothing
 * allocates on a hot path.
 *
 *   - `BF`        the BitmapFont whose glyph advances match harness.FONT.
 *   - `makeCtx()` a capturing ctx that records the FIRST drawImage dx and counts
 *                 all draws (T8 placement detector -- allocates a ctx per call,
 *                 which is fine in the freely-allocating T8 tier).
 *   - `REC_MIN`   a SINGLETON minimal recorder for the T6 lane-4 hot loop: no
 *                 `arguments` access, no closure, allocated once. Its drawImage
 *                 only increments `draws`, so drawWrapped inside a MEASURED window
 *                 allocates nothing on account of the ctx.
 *   - `DX`/`DX2`  the dx-recording buffers + their singleton ctxs for the T8
 *                 pixel-identity lane (drawWrapped vs draw(slice) oracle).
 *
 * @license MIT
 */

import { BitmapFont } from '@zakkster/lite-bmfont';

// A BitmapFont whose glyph ADVANCES match harness.FONT (letters 12, space 6,
// '.' 6) so its `measure`/`measureLine` agree with computeWrap's rendered-scale
// lineWidth on ASCII. Every drawable glyph also carries a 1x1 cell (offsets 2,3),
// which the ellipsis geometry needs (TextLayout.js:330 reads glyphs['.'*7+2] > 0
// before it counts an ellipsis width) and which makes drawWrapped's drawImage
// fire so the placement detector can observe it. Built once, in this realm.
export const BF_GLYPHS = new Int16Array(256 * 7);
for (let id = 65; id <= 90; id++) { BF_GLYPHS[id * 7 + 2] = 1; BF_GLYPHS[id * 7 + 3] = 1; BF_GLYPHS[id * 7 + 6] = 12; }
for (let id = 97; id <= 122; id++) { BF_GLYPHS[id * 7 + 2] = 1; BF_GLYPHS[id * 7 + 3] = 1; BF_GLYPHS[id * 7 + 6] = 12; }
BF_GLYPHS[32 * 7 + 6] = 6;                                                 // space, no cell
BF_GLYPHS[46 * 7 + 2] = 1; BF_GLYPHS[46 * 7 + 3] = 1; BF_GLYPHS[46 * 7 + 6] = 6;   // '.'

/** A bmfont instance carrying those tables. `measure`/`measureLine`/`drawWrapped`
 * read only glyphs, kerning, atlas, base, lineHeight -- all set here; the atlas
 * is never sampled because drawImage is intercepted by the capturing ctx. */
export const BF = Object.create(BitmapFont.prototype);
BF.glyphs = BF_GLYPHS;
BF.kerning = new Int16Array(65536);
BF.atlas = {};
BF.base = 0;
BF.lineHeight = 16;

/** The '.' xadvance at scale 1 (6). */
export const DOT_XADVANCE = BF_GLYPHS[46 * 7 + 6];

/** A canvas2d stub that records the dx of the FIRST drawImage and counts all
 * draws. drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh): dx is arg index 5.
 * Allocates a fresh object per call -- only ever used in the freely-allocating
 * T8 tier, never in a measured window. */
export function makeCtx() {
    return {
        draws: 0,
        firstDx: null,
        drawImage() {
            if (this.firstDx === null) this.firstDx = arguments[5];
            this.draws++;
        },
    };
}

/**
 * The T6 lane-4 recorder. A SINGLETON allocated exactly once: no `arguments`
 * read, no closure, drawImage only bumps `draws`. drawWrapped calling into this
 * inside a measured window must not make the ctx a source of allocation. The
 * signature takes named parameters so V8 never materialises an `arguments`
 * object.
 */
export const REC_MIN = {
    draws: 0,
    drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh) { this.draws++; },
};

/** dx-recording buffers for the T8 pixel-identity lane. Sized generously; a
 * single line's glyph count never approaches 4096. Built once. */
export const DX = new Float64Array(4096);
export const DX2 = new Float64Array(4096);

/** Singleton ctx recording each drawImage dx into DX. `count` is reset by the
 * lane before every call. Named parameters -- no `arguments` object. */
export const DX_CTX = {
    count: 0,
    drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh) { DX[this.count++] = dx; },
};

/** Singleton ctx recording each drawImage dx into DX2 (the oracle side). */
export const DX_CTX2 = {
    count: 0,
    drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh) { DX2[this.count++] = dx; },
};
