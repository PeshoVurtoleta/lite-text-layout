// Docs-drift guard (TL4, BRIEF Phase C / assertion 6).
//
// The public surface is documented in two hand-written files -- README.md and
// llms.txt -- and defined in exactly one place: the module's runtime exports.
// This test pins them to each other in BOTH directions so neither can drift:
//
//   runtime -> docs: every export the module actually has is documented.
//   docs -> runtime: every API name the docs mention exists at runtime.
//
// The runtime surface is READ FROM THE MODULE (import + Object.keys), never a
// hardcoded list -- a hardcoded list would be a third copy that drifts. The
// documented names are parsed out of a DELIMITED region of each file (the
// <!--API-START-->..<!--API-END--> block in README, the "## API Surface"
// section in llms.txt), NOT the whole file, so a name that appears only in
// prose cannot satisfy the docs->runtime direction.
//
// node:test + node:fs only. No dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../TextLayout.js';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const LLMS = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');

// --- the runtime surface, read from the module, never hardcoded ---------------
const MODULE_EXPORTS = Object.keys(m);                 // FLAG_*, TextLayout, TextLayoutError, VERSION
const NAMESPACE_METHODS = Object.keys(m.TextLayout);   // computeWrap, countLines
const RUNTIME_NAMES = [...MODULE_EXPORTS, ...NAMESPACE_METHODS];

// A documented name resolves at runtime iff it is a module export or a method
// on the TextLayout namespace object.
function resolvesAtRuntime(name) {
    return MODULE_EXPORTS.includes(name) || NAMESPACE_METHODS.includes(name);
}

// --- delimited documentation regions ------------------------------------------
function readmeApiRegion() {
    const start = README.indexOf('<!--API-START-->');
    const end = README.indexOf('<!--API-END-->');
    assert.notEqual(start, -1, 'README.md: missing <!--API-START--> delimiter');
    assert.notEqual(end, -1, 'README.md: missing <!--API-END--> delimiter');
    assert.ok(end > start, 'README.md: <!--API-END--> must come after <!--API-START-->');
    return README.slice(start, end);
}

function llmsApiSection() {
    const start = LLMS.indexOf('## API Surface');
    assert.notEqual(start, -1, 'llms.txt: missing "## API Surface" heading');
    // The section runs until the next H2.
    const rest = LLMS.slice(start + '## API Surface'.length);
    const nextH2 = rest.indexOf('\n## ');
    return nextH2 === -1 ? rest : rest.slice(0, nextH2);
}

// --- mechanical extraction of documented API names from a region --------------
// Three sources, each a structural marker -- not free prose:
//   1. `TextLayout.<method>` references (assert <method> is a namespace method)
//   2. H3 headings whose first token is a backticked identifier
//   3. constants-table rows whose first cell is an UPPER_CASE backticked name
function documentedNames(region) {
    const bare = new Set();       // top-level export / constant names
    const methods = new Set();    // names used as TextLayout.<method>
    for (const mm of region.matchAll(/TextLayout\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        methods.add(mm[1]);
    }
    for (const mm of region.matchAll(/^###\s+`([A-Za-z_][A-Za-z0-9_]*)/gm)) {
        bare.add(mm[1]);
    }
    for (const mm of region.matchAll(/^\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|/gm)) {
        bare.add(mm[1]);
    }
    return { bare, methods };
}

// -----------------------------------------------------------------------------
// Direction 1: runtime -> docs. Every export is documented in BOTH files.
// -----------------------------------------------------------------------------
test('every runtime export is documented in the README API region', () => {
    const region = readmeApiRegion();
    for (const name of RUNTIME_NAMES) {
        assert.ok(region.includes(name), 'undocumented export: ' + name + ' in README.md');
    }
});

test('every runtime export is documented in llms.txt', () => {
    for (const name of RUNTIME_NAMES) {
        assert.ok(LLMS.includes(name), 'undocumented export: ' + name + ' in llms.txt');
    }
});

// -----------------------------------------------------------------------------
// Direction 2: docs -> runtime. Every documented API name resolves at runtime.
// -----------------------------------------------------------------------------
test('every API name in the README region resolves at runtime', () => {
    const { bare, methods } = documentedNames(readmeApiRegion());
    for (const name of bare) {
        assert.ok(resolvesAtRuntime(name), 'documented name not at runtime: ' + name + ' in README.md');
    }
    for (const name of methods) {
        assert.ok(NAMESPACE_METHODS.includes(name),
            'documented name not at runtime: TextLayout.' + name + ' in README.md');
    }
    // Guard against a delimited region that parsed to nothing (a vacuous pass).
    assert.ok(bare.size + methods.size >= RUNTIME_NAMES.length,
        'README API region parsed too few names (' + (bare.size + methods.size) + ') to be trusted');
});

test('every API name in the llms.txt API section resolves at runtime', () => {
    const { bare, methods } = documentedNames(llmsApiSection());
    for (const name of bare) {
        assert.ok(resolvesAtRuntime(name), 'documented name not at runtime: ' + name + ' in llms.txt');
    }
    for (const name of methods) {
        assert.ok(NAMESPACE_METHODS.includes(name),
            'documented name not at runtime: TextLayout.' + name + ' in llms.txt');
    }
    assert.ok(bare.size + methods.size >= 1, 'llms.txt API section parsed no names');
});
