// Drift guard for the RANGE CONTRACT (TL3, BRIEF Phase C / assertion 7).
//
// The range semantics are stated ONCE and must read byte-identically across the
// four surfaces that document them: the source docstring, TextLayout.d.ts,
// llms.txt and README.md. A human comparing four files by eye is how three
// version numbers disagreed in TL0; this test reads the files and fails on any
// divergence in wording so the contract cannot rot into four slightly-different
// sentences.
//
// node:test + node:fs only. No dependencies, no imports outside the package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const START = 'RANGE-CONTRACT v1';
const END = 'END RANGE-CONTRACT';

const SURFACES = [
    ['TextLayout.js', new URL('../TextLayout.js', import.meta.url)],
    ['TextLayout.d.ts', new URL('../TextLayout.d.ts', import.meta.url)],
    ['llms.txt', new URL('../llms.txt', import.meta.url)],
    ['README.md', new URL('../README.md', import.meta.url)],
];

// The canonical range-contract sentences, pinned. Each surface must reproduce
// these verbatim (after its comment/markdown prefix is stripped and whitespace
// normalized). Pinning the TEXT -- not merely "all four agree" -- also catches a
// coordinated edit to all four that drifts from the intended contract.
const CANONICAL = [
    'startIdx is inclusive and endIdx is exclusive, and both are indices into the original string.',
    'The breaking space is excluded from both sides.',
    'Leading whitespace is skipped only after a soft break; it is content at text start and immediately after an explicit newline.',
    'lineWidth is at the rendered scale and includes the ellipsis allowance on a FLAG_TRUNCATED line.',
].join('\n');

// Strip a leading comment/markdown prefix (' * ', '* ', '- '), then collapse
// runs of whitespace and trim. Total and simple, so a real divergence in
// wording cannot normalize away.
function normalize(line) {
    let t = line.trim();
    if (t.startsWith('* ')) t = t.slice(2);
    else if (t === '*') t = '';
    if (t.startsWith('- ')) t = t.slice(2);
    return t.replace(/\s+/g, ' ').trim();
}

function extractBlock(name, url) {
    const raw = readFileSync(url, 'utf8').split(/\r?\n/);
    let start = -1;
    let end = -1;
    for (let i = 0; i < raw.length; i++) {
        const n = normalize(raw[i]);
        if (start === -1 && n === START) { start = i; continue; }
        if (start !== -1 && n === END) { end = i; break; }
    }
    assert.notEqual(start, -1, name + ': no "' + START + '" sentinel found');
    assert.notEqual(end, -1, name + ': no "' + END + '" sentinel found after the start sentinel');
    const body = [];
    for (let i = start + 1; i < end; i++) {
        const n = normalize(raw[i]);
        if (n === '') continue;   // blanks and fence lines carry no contract text
        body.push(n);
    }
    assert.equal(body.length, 4,
        name + ': expected 4 range-contract sentences between the sentinels, got ' + body.length);
    return body.join('\n');
}

test('range contract is byte-identical across all four doc surfaces', () => {
    const blocks = SURFACES.map(([name, url]) => [name, extractBlock(name, url)]);
    const [refName, ref] = blocks[0];
    for (let i = 1; i < blocks.length; i++) {
        const [name, blk] = blocks[i];
        assert.equal(blk, ref,
            name + ' range-contract block diverges from ' + refName + '.\n' +
            '--- ' + refName + ' ---\n' + ref + '\n--- ' + name + ' ---\n' + blk);
    }
});

test('the range contract matches the pinned canonical text', () => {
    for (const [name, url] of SURFACES) {
        assert.equal(extractBlock(name, url), CANONICAL,
            name + ' range-contract block drifted from the pinned canonical sentences');
    }
});
