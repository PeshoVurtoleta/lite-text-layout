/**
 * T8 -- cross-package conformance, registered but (mostly) empty.
 *
 * lite-bmfont conformance lands in TL3. It is empty now because bmfont v1.2.0
 * exposes no `layoutGlyphs` and no range-aware `measure`, so there is nothing to
 * conform this package's layout buffer against yet. This tier writes one stderr
 * line naming the deferral (and TL-25) and returns -- not a die(), not a silent
 * no-op.
 *
 * Ledger notes for two findings that live at this boundary:
 *
 * - TL-22 (S3): the README does not follow the suite blueprint. Deliberately NO
 *   torture entry -- it is a documentation-structure finding for TL4, not an
 *   executable predicate over computeWrap.
 *
 * - TL-25 (S2): cross-package double-scale. computeWrap's lineWidth is already at
 *   the RENDERED scale (51/102/204 for scale 0.5/1/2); lite-bmfont's drawWrapped
 *   then multiplies by scale AGAIN. The buggy CODE PATH is in bmfont
 *   (BitmapFont.js:295-299), NOT in computeWrap -- computeWrap's scaled width is
 *   correct on its own. An executable die-when-fixed predicate therefore belongs
 *   in the bmfont conformance tier (TL3); asserting a computeWrap value here as a
 *   knownFailing would be the AR-02 trap (a value near the finding, not the code
 *   path it names). So TL-25 is a `todo` naming TL3, with the subject-side fact
 *   pinned as a passing check so a change to computeWrap's scale contract is
 *   still caught.
 */

import { TextLayout } from '../../TextLayout.js';
import { FONT, check, todo } from './harness.mjs';

const OUT = new Float32Array(8);

export function run() {
    // TL-25 subject-side precondition: computeWrap width scales with `scale`.
    TextLayout.computeWrap('AAAA BBBB', FONT, 0, 0, 16, OUT, 1);
    const w1 = OUT[2];
    TextLayout.computeWrap('AAAA BBBB', FONT, 0, 0, 16, OUT, 2);
    const w2 = OUT[2];
    check(w1 === 102 && w2 === 204,
        () => 'TL-25 precondition: computeWrap width must scale with `scale` ' +
            '(102 at s=1, 204 at s=2), got ' + w1 + '/' + w2);
    todo('TL-25', 'cross-package double-scale in lite-bmfont drawWrapped -- conformance lands in TL3');

    process.stderr.write('torture: T8: empty -- TL3 lands lite-bmfont conformance (TL-25); ' +
        'bmfont v1.2.0 exposes no layoutGlyphs and no range-aware measure, nothing to conform against yet\n');
}
