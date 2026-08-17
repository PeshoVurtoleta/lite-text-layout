/**
 * T9 -- controls. Every gate must be provably able to fail.
 *
 * This tier runs deliberately-broken variants IN PROCESS and asserts the
 * matching detector flags each one. A gate that cannot fail is decorative.
 *
 * Shipping now:
 *   - Control 1: an allocating hot body MUST be rejected by runOpsGate.
 *   - Control 2: a corrupted copy of the oracle's output (drop the last line,
 *     add 1 to one width) MUST be flagged divergent by the range/width
 *     comparator. The oracle module is never edited -- only a COPY is corrupted.
 *   - Control 3 (TL1): the countLines agreement law is not vacuous. The SHARED
 *     agreeCount comparator, run against a 1-line stub (computeWrap into a
 *     Float32Array(4)) over a corpus that includes a multi-line case, MUST report
 *     mismatches. Zero mismatches means the law would pass on a stub that always
 *     returns the cap -- a die().
 *   - Control 4 (TL1): the overflow detector, a function of buffer contents
 *     alone, MUST reject a capped-run buffer whose last flag was never written to
 *     FLAG_OVERFLOW, and MUST accept one that was.
 *   - Control 5 (TL1): the freeze detector. TextLayout IS frozen now (TL-11
 *     promoted); assignment and delete throw. The detector itself is still proven
 *     by freezing a throwaway object and asserting a strict-mode write throws.
 *   - Control 8 (TL2): the flags tripwire. `harness.scanFlags` -- the SAME scan
 *     T5 runs over every capped run -- must report a bad flags value and must
 *     report a both-flags output, and must report neither on a clean buffer.
 *
 * NUMBER-TO-NAME MAPPING. Index 6 is RESERVED for TL3 (double-scaled width) and
 * is deliberately skipped, and 7 is the whole-suite BREAK control, so TL2's
 * controls start at 8:
 *
 *     1 alloc gate            2 oracle comparator       3 agreement law
 *     4 overflow detector     5 freeze detector         6 RESERVED -- TL3
 *     7 TEXTLAYOUT_TORTURE_BREAK (whole-suite, out of process)
 *     8 flags tripwire        9 the input door         10 the SHARED door
 *    11 the phantom line     12 the CRLF exclusion     13 CRLF on the trunc arm
 *
 * Controls 9 to 12 gate mechanisms that live in TextLayout.js, which this
 * process cannot edit. Each one therefore feeds the SHARED detector the real
 * tier uses (never a private weaker copy) with an input that simulates the
 * mechanism being broken, and requires the detector to report. The
 * out-of-process half -- actually deleting the mechanism from the source and
 * observing exit 1 -- is the session's drift-mutation procedure, recorded in
 * decisions/0002-input-door.md and in the session notes; these controls are
 * what make that procedure's DETECTORS provably non-vacuous.
 *
 * The whole-suite control is Control 7: TEXTLAYOUT_TORTURE_BREAK=1, which trips
 * the T6 alloc gate and exits non-zero.
 */

import { TextLayout, FLAG_OVERFLOW, FLAG_NORMAL, FLAG_TRUNCATED } from '../../TextLayout.js';
import {
    SEED, FONT, runOpsGate, check, die, todo, makePrng, makeCorpus, agreeCount,
    scanFlags, doorMisses, DOOR_ROWS, countPhantoms, crlfInRange,
} from './harness.mjs';
import { oracleWrap } from './oracle.mjs';
import { linesDiverge } from './t5-fuzz.mjs';

/** 1-line stub buffer for control 3. Widen to Float32Array(4096) to prove the control bites. */
const STUB4 = new Float32Array(4);

/** Retained sink so the control's allocations survive GC (arrayBuffers grows). */
const leak = [];

/** Scratch buffer for the door controls. Never measured, allocated once. */
const CTRL_OUT = new Float32Array(4 * 64);

export function run() {
    // Control 1 -- the alloc gate. A hot body that retains an allocation every
    // iteration MUST be rejected by runOpsGate (maxArrayBuffersGrowth:0).
    const { report } = runOpsGate(() => { leak.push(new Float64Array(64)); }, {
        ops: 4000,
        warmup: 0,
    });
    if (report.ok) {
        die('T9 control 1: an allocating hot loop passed the zero-alloc gate');
    }
    leak.length = 0; // release the control's garbage

    // Control 2 -- the oracle comparator. Corrupt a COPY of the oracle's output
    // and assert the comparator flags it. boxWidth 40 seats each 36-wide word on
    // its own line, so the reference has four lines to perturb.
    const ref = oracleWrap('AAA BBB CCC DDD', FONT, 40, 1);
    if (!(ref.length >= 2)) {
        die('T9 control 2: the oracle produced ' + ref.length + ' lines -- need >= 2 to corrupt');
    }
    // Drop the last line AND add 1 to one width, on a COPY. `linesDiverge` is
    // the exact comparator T5 fuzzes with.
    const corrupted = ref.map((l) => ({ start: l.start, end: l.end, width: l.width }));
    corrupted.pop();
    corrupted[0].width += 1;
    if (!linesDiverge(ref, ref.length, corrupted)) {
        die('T9 control 2: comparator did not flag a corrupted oracle (dropped line + width+1)');
    }
    // And prove the comparator is width-sensitive on its own, not just by count.
    const widthOnly = ref.map((l) => ({ start: l.start, end: l.end, width: l.width }));
    widthOnly[0].width += 1;
    if (!linesDiverge(ref, ref.length, widthOnly)) {
        die('T9 control 2: comparator blind to a 1px width divergence at equal line count');
    }

    // Control 3 -- the countLines agreement law is not vacuous (TL-02). Run the
    // SAME comparator the T0 law uses, but against a stub that caps every layout
    // at one line (computeWrap into STUB4 = Float32Array(4)). Over a 32-case
    // corpus that includes a multi-line case, that stub MUST disagree with the
    // unbounded computeWrap -- a report of 0 mismatches means the agreement law
    // would pass even on a countLines that always returned the cap.
    const countLinesStub = (t, f, bw, bh, lh, s) => TextLayout.computeWrap(t, f, bw, bh, lh, STUB4, s);
    const CTRL_CORPUS = makeCorpus(makePrng(SEED), 32);
    // Case 0 wraps to six lines at boxWidth 40, so a 1-line stub cannot match it.
    CTRL_CORPUS[0] = { text: 'AAA BBB CCC DDD EEE FFF', boxWidth: 40, scale: 1 };
    const stubMism = agreeCount(countLinesStub, CTRL_CORPUS);
    if (stubMism === 0) {
        die('T9 control 3: agreeCount reported 0 mismatches against a 1-line stub -- ' +
            'the agreement law is vacuous (it would pass even if countLines always returned the cap). ' +
            'Widen STUB4 to reproduce this deliberately.');
    }

    // Control 4 -- the overflow detector, a function of buffer contents alone:
    // "the last written line of a capped run carries FLAG_OVERFLOW". Prove it is
    // two-sided so neither an always-true nor an always-false neuter survives.
    const overflowFlagged = (buf, n) => n > 0 && buf[(n - 1) * 4 + 3] === FLAG_OVERFLOW;
    // Positive: a correctly flagged capped run is accepted (catches always-false).
    const goodBuf = new Float32Array(12);
    goodBuf[11] = FLAG_OVERFLOW;
    check(overflowFlagged(goodBuf, 3),
        () => 'T9 control 4: detector blind to a buffer whose last line carries FLAG_OVERFLOW');
    // Negative: a capped run (its countLines would be 10, but only 3 lines were
    // written) whose slot 11 was never written to FLAG_OVERFLOW MUST be rejected.
    // die if the detector accepts it (catches always-true, e.g. `return true`).
    const badBuf = new Float32Array(12);
    badBuf[11] = FLAG_NORMAL;   // the overflow was never signalled
    if (overflowFlagged(badBuf, 3)) {
        die('T9 control 4: detector accepted a capped-run buffer whose FLAG_OVERFLOW was never written');
    }
    // Tie the "countLines would be 10" claim to reality: TEN wraps to 10 lines.
    check(TextLayout.countLines('AAA BBB CCC DDD EEE FFF GGG HHH III JJJ', FONT, 40, 0, 16, 1) === 10,
        () => 'T9 control 4: the reference capped-run text no longer wraps to 10 lines');

    // Control 5 -- the freeze detector. TL-11 is promoted: TextLayout IS frozen.
    check(Object.isFrozen(TextLayout),
        () => 'T9 control 5: TextLayout is not frozen (TL-11 regressed)');
    // A write to the frozen namespace throws a TypeError in strict mode (ESM is
    // already strict) -- assert the throw, not a silent no-op.
    let threwAssign = false;
    try { TextLayout.computeWrap2 = () => {}; } catch (err) { threwAssign = err instanceof TypeError; }
    check(threwAssign,
        () => 'T9 control 5: assigning TextLayout.computeWrap2 did not throw TypeError on the frozen namespace');
    // delete on a frozen own property throws too.
    let threwDelete = false;
    try { delete TextLayout.computeWrap; } catch (err) { threwDelete = err instanceof TypeError; }
    check(threwDelete,
        () => 'T9 control 5: deleting TextLayout.computeWrap did not throw on the frozen namespace');
    // Prove the detector works independent of TextLayout: a write to a freshly
    // frozen throwaway object throws in strict mode.
    const throwaway = Object.freeze({ x: 1 });
    let threw = false;
    try { throwaway.x = 2; } catch (err) { threw = true; }
    check(threw,
        () => 'T9 control 5: assignment to a frozen object did not throw -- the freeze detector is blind');

    // Control 8 (TL2) -- the flags tripwire. T5 walks every capped run through
    // harness.scanFlags and reports badvalue/bothflags; a scan that cannot
    // report is a decorative counter. Gate it on hand-built buffers, both
    // violation classes independently, plus the clean direction.
    const badBuf8 = new Float32Array(12);
    badBuf8[7] = 3;                       // one slot outside {0, 1, 2}
    const badV = scanFlags(badBuf8, 3);
    if ((badV >> 1) < 1) {
        die('T9 control 8: scanFlags reported ' + (badV >> 1) + ' bad values for a buffer whose ' +
            'slot 7 holds 3 -- the T5 badvalue counter cannot fire');
    }
    const bothBuf8 = new Float32Array(12);
    bothBuf8[3] = FLAG_TRUNCATED;
    bothBuf8[11] = FLAG_OVERFLOW;
    const bothV = scanFlags(bothBuf8, 3);
    if ((bothV & 1) !== 1) {
        die('T9 control 8: scanFlags did not report an output carrying both FLAG_TRUNCATED and ' +
            'FLAG_OVERFLOW -- the T5 bothflags counter cannot fire');
    }
    // The two classes are independent: the both-flags buffer holds no bad value.
    check((bothV >> 1) === 0,
        () => 'T9 control 8: scanFlags counted a bad value in a buffer holding only legal flags');
    // Clean direction: an always-true scan would make every T5 case a violation.
    const cleanBuf8 = new Float32Array(12);
    cleanBuf8[3] = FLAG_NORMAL;
    cleanBuf8[7] = FLAG_NORMAL;
    cleanBuf8[11] = FLAG_TRUNCATED;       // legal on its own
    check(scanFlags(cleanBuf8, 3) === 0,
        () => 'T9 control 8: scanFlags reported a violation on a clean buffer (always-true scan)');

    // Control 9 (TL2) -- THE INPUT DOOR. The detector is harness.doorMisses,
    // the same one T1 requires to report 0 against both entry points. Feed it a
    // call that simulates the `scale` finiteness check having been DELETED --
    // it intercepts a non-finite scale and returns a line count instead of
    // letting the door throw, which is exactly what 1.1.0 did -- and the
    // detector must report the scale rows.
    const doorMissingScale = (t, f, bw, bh, lh, s) => {
        if (!Number.isFinite(s)) return 1;   // the deleted check, simulated
        return TextLayout.computeWrap(t, f, bw, bh, lh, CTRL_OUT, s);
    };
    const missScale = doorMisses(doorMissingScale, 'control9-missing-scale-check');
    if (missScale < 2) {
        die('T9 control 9: doorMisses reported ' + missScale + ' misses against a door with the ' +
            'scale finiteness check removed -- expected at least the 2 non-finite scale rows. ' +
            'The door detector is vacuous and T1 would pass on a doorless build.');
    }
    // The clean direction, so an always-true detector cannot survive either:
    // the REAL computeWrap must report zero misses through the same detector.
    check(doorMisses((t, f, bw, bh, lh, s) => TextLayout.computeWrap(t, f, bw, bh, lh, CTRL_OUT, s),
        'control9-real') === 0,
        () => 'T9 control 9: the real computeWrap reports door misses -- the door regressed');

    // Control 10 (TL2) -- THE DOOR IS SHARED. This is the only instrument that
    // proves `countLines` goes through the same validator rather than merely
    // being described as doing so. A countLines with no door does not throw at
    // all, so simulate its absence by swallowing every rejection; the detector
    // must then report EVERY row.
    const doorlessCountLines = (t, f, bw, bh, lh, s) => {
        try { return TextLayout.countLines(t, f, bw, bh, lh, s); } catch (err) { return 0; }
    };
    const missShared = doorMisses(doorlessCountLines, 'control10-doorless-countLines');
    if (missShared !== DOOR_ROWS.length) {
        die('T9 control 10: doorMisses reported ' + missShared + ' of ' + DOOR_ROWS.length +
            ' misses against a countLines whose rejections are swallowed -- the shared-door ' +
            'detector cannot see a missing door');
    }
    check(doorMisses(TextLayout.countLines, 'control10-real') === 0,
        () => 'T9 control 10: the real countLines reports door misses -- the door is not shared');

    // Control 11 (TL2) -- THE PHANTOM LINE. The detector is harness.countPhantoms,
    // the same predicate T1's TL-26 pins use. Hand-build the 1.1.0 output for
    // 'AAA \nBBB' at boxWidth 40 -- three lines, the middle one the phantom
    // [4,4,0,0] -- and require the detector to see it.
    const PH_TEXT = 'AAA \nBBB';
    const phantomBuf = new Float32Array(12);
    phantomBuf.set([0, 3, 36, FLAG_NORMAL, 4, 4, 0, FLAG_NORMAL, 5, 8, 36, FLAG_NORMAL]);
    if (countPhantoms(PH_TEXT, phantomBuf, 3) !== 1) {
        die('T9 control 11: countPhantoms found ' + countPhantoms(PH_TEXT, phantomBuf, 3) +
            ' phantoms in the exact 1.1.0 output for ' + JSON.stringify(PH_TEXT) +
            ' -- the TL-26 detector is blind and reverting the suppression would pass');
    }
    // The DELIBERATE blank line must NOT register, or the detector would demand
    // a regression. 'AAA\n\nBBB' line 1 is [4,4] preceded by a newline, not a space.
    const blankBuf = new Float32Array(12);
    blankBuf.set([0, 3, 36, FLAG_NORMAL, 4, 4, 0, FLAG_NORMAL, 5, 8, 36, FLAG_NORMAL]);
    check(countPhantoms('AAA\n\nBBB', blankBuf, 3) === 0,
        () => 'T9 control 11: countPhantoms counted a DELIBERATE blank line as a phantom -- the ' +
            'discriminator is the character before lineStart, 32 not 10');
    // And the live subject, through the same detector, must be clean.
    const liveBuf = new Float32Array(12);
    const liveN = TextLayout.computeWrap(PH_TEXT, FONT, 40, 0, 16, liveBuf, 1);
    check(liveN === 2 && countPhantoms(PH_TEXT, liveBuf, liveN) === 0,
        () => 'T9 control 11: the live subject still emits a phantom line');

    // Control 12 (TL2) -- THE CR EXCLUSION. The detector is harness.crlfInRange,
    // the same predicate T1's TL-13 pin uses. Hand-build the 1.1.0 output for
    // 'AAA\r\nBBB' -- endIdx 4, putting the CR INSIDE the range -- and require
    // the detector to see it.
    const CR_TEXT = 'AAA\r\nBBB';
    const crBuf = new Float32Array(8);
    crBuf.set([0, 4, 36, FLAG_NORMAL, 5, 8, 36, FLAG_NORMAL]);
    if (crlfInRange(CR_TEXT, crBuf, 2) !== 1) {
        die('T9 control 12: crlfInRange found ' + crlfInRange(CR_TEXT, crBuf, 2) +
            ' CR-in-range lines in the exact 1.1.0 output for AAA-CRLF-BBB -- the TL-13 detector ' +
            'is blind and reverting the CR exclusion would pass');
    }
    // A LONE CR is not a terminator and must NOT register -- otherwise the
    // detector would demand that lone CRs be excluded too, which is a policy
    // this session explicitly rejected (decisions/0002-input-door.md).
    const loneBuf = new Float32Array(4);
    loneBuf.set([0, 7, 72, FLAG_NORMAL]);
    check(crlfInRange('AAA\rBBB', loneBuf, 1) === 0,
        () => 'T9 control 12: crlfInRange flagged a LONE CR -- only a CR followed by LF is a ' +
            'terminator');
    // And the live subject, through the same detector, must be clean.
    const crLive = new Float32Array(8);
    const crN = TextLayout.computeWrap(CR_TEXT, FONT, 0, 0, 16, crLive, 1);
    check(crN === 2 && crlfInRange(CR_TEXT, crLive, crN) === 0 && crLive[1] === 3,
        () => 'T9 control 12: the live subject still puts the CR inside the emitted range');

    // Control 13 (TL3) -- THE CR EXCLUSION ON THE TRUNCATING ARM. This is the
    // control that would have caught TL2's only blocker. The blocker lived on the
    // TRUNCATING newline path (TextLayout.js:406-409): the emitted endIdx carried
    // the CR back INTO the range, and NO differential could see it because the
    // oracle has no boxHeight and never reaches truncation. The detector is the
    // SAME harness.crlfInRange the T5 truncating-arm sweep uses. Hand-build the
    // 1.x-style BROKEN truncating output for 'AAA\r\nBBB' -- endIdx 4, putting the
    // CR inside the range, flagged FLAG_TRUNCATED -- and require the detector to
    // see it.
    const CR_TRUNC_TEXT = 'AAA\r\nBBB';
    const crTruncBad = new Float32Array(4);
    crTruncBad.set([0, 4, 36, FLAG_TRUNCATED]);   // endIdx 4 reincludes the CR
    if (crlfInRange(CR_TRUNC_TEXT, crTruncBad, 1) !== 1) {
        die('T9 control 13: crlfInRange found ' + crlfInRange(CR_TRUNC_TEXT, crTruncBad, 1) +
            ' CR-in-range lines in a truncating output whose endIdx reincludes the CR -- the ' +
            'truncating-arm TL-13 detector is blind and reverting the CR exclusion would pass');
    }
    // A truncating output that correctly EXCLUDES the CR (endIdx 3) must NOT
    // register -- otherwise the control would demand a regression.
    const crTruncGood = new Float32Array(4);
    crTruncGood.set([0, 3, 36, FLAG_TRUNCATED]);
    check(crlfInRange(CR_TRUNC_TEXT, crTruncGood, 1) === 0,
        () => 'T9 control 13: crlfInRange flagged a truncating output whose endIdx already ' +
            'excludes the CR -- the detector is over-eager');
    // And the LIVE subject on the truncating arm must be clean: a box one line
    // tall truncates 'AAA\r\nBBB' to a single FLAG_TRUNCATED line whose range
    // ends at 3 (the CR excluded), so crlfInRange is 0.
    const crTruncLive = new Float32Array(4);
    const crTruncN = TextLayout.computeWrap(CR_TRUNC_TEXT, FONT, 0, 16, 16, crTruncLive, 1);
    check(crTruncN === 1 && crTruncLive[3] === FLAG_TRUNCATED && crTruncLive[1] === 3 &&
          crlfInRange(CR_TRUNC_TEXT, crTruncLive, crTruncN) === 0,
        () => 'T9 control 13: the live truncating subject put the CR inside the emitted range ' +
            '(n=' + crTruncN + ' endIdx=' + crTruncLive[1] + ' flag=' + crTruncLive[3] + ')');

    // Controls deferred to their session.
    todo('control-6', 'double-scaled width -- lands in TL3');
}
