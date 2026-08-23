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

// TL-28 / T-3: BF is built through the REAL bmfont 2.x constructor, from a
// descriptor of WHOLE-PIXEL advances (letters 12, space 6, '.' 6). bmfont
// encodes slot 6 to 1/16 fixed point itself (`round(xadvance * 16)`, so 12 ->
// 192), and `advanceOf`/`measure`/`measureLine` decode it back with * 0.0625.
// computeWrap (post-TL-28) detects the 2.x `advanceOf` accessor and decodes to
// the SAME 12px, so the two agree at full magnitude.
//
// The prior fixture hand-poked whole-pixel values (12) straight into an
// `Int16Array` on `BitmapFont.prototype`. That is a 1.x table wearing a 2.x
// prototype: `advanceOf` reads it as 12 * 0.0625 = 0.75px, everything still
// "agrees" at 1/16 magnitude, and every box-size calibration silently means
// nothing. A whole-pixel stub is exactly what hid TL-28 for a full major, so it
// is not used here. Every drawable glyph carries a 1x1 cell (width/height 1) so
// the ellipsis geometry counts it (TextLayout.js reads glyphs['.'*7+2] > 0) and
// drawWrapped's drawImage fires for the placement/pixel lanes. Built once.
const BF_CHARS = [];
for (let id = 65; id <= 90; id++) BF_CHARS.push({ id, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 });
for (let id = 97; id <= 122; id++) BF_CHARS.push({ id, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 12 });
BF_CHARS.push({ id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 6 });   // space, no cell
BF_CHARS.push({ id: 46, x: 0, y: 0, width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 6 });   // '.'

/** A REAL bmfont 2.x instance. The atlas is never sampled -- drawImage is
 * intercepted by the capturing ctxs -- so a bare object satisfies the door. */
export const BF = new BitmapFont({}, { common: { lineHeight: 16, base: 0 }, chars: BF_CHARS });

/** The '.' xadvance in DECODED pixels at scale 1 (6). Read through the font's
 * own accessor so the truncation-allowance math stays in the same pixel space
 * as measureLine, not the raw 1/16 store. */
export const DOT_XADVANCE = BF.advanceOf(46);

// TL-28 / T-4: the 1.x regression witness (A3). A hand-rolled WHOLE-PIXEL font
// with the same logical metrics as BF but NO `advanceOf` accessor -- a plain
// object, deliberately not on `BitmapFont.prototype`. computeWrap must detect
// the absent accessor, take advScale = 1, and read the store as whole pixels,
// producing output BYTE-IDENTICAL to BF's (which decodes 192 -> 12). Forcing
// advScale = 0.0625 unconditionally reddens the A3 lane that pairs them.
const BF_1X_GLYPHS = new Int16Array(256 * 7);
for (let id = 65; id <= 90; id++) { BF_1X_GLYPHS[id * 7 + 2] = 1; BF_1X_GLYPHS[id * 7 + 3] = 1; BF_1X_GLYPHS[id * 7 + 6] = 12; }
for (let id = 97; id <= 122; id++) { BF_1X_GLYPHS[id * 7 + 2] = 1; BF_1X_GLYPHS[id * 7 + 3] = 1; BF_1X_GLYPHS[id * 7 + 6] = 12; }
BF_1X_GLYPHS[32 * 7 + 6] = 6;
BF_1X_GLYPHS[46 * 7 + 2] = 1; BF_1X_GLYPHS[46 * 7 + 3] = 1; BF_1X_GLYPHS[46 * 7 + 6] = 6;
export const BF_1X = { glyphs: BF_1X_GLYPHS, kerning: new Int16Array(65536) };

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
