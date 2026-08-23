# Peer coordination note -- for @zakkster/lite-bmfont (re F-56 / TL-28)

**From:** lite-text-layout TL6 (v1.4.0), 2026-08-23
**To:** lite-bmfont maintainer
**Action required in the peer:** convert one boundary guard; nothing else.

## What changed on this side

lite-text-layout 1.4.0 decodes bmfont's 1/16 fixed-point advance/kerning store
(TL-28, filed in bmfont as **F-56**). As part of it, this repo's bmfont
devDependency moved **`^1.6.0` -> `^2.0.1`** and now installs **2.0.2**. The fix
is entirely in this package; bmfont needs no code change.

## The guard that will now go red (on purpose)

`LiteBmfont/test/packaging.test.js` -- **fork 8, lane 2**
(`the LiteTextLayout peer is wired and read`), the line:

```js
assert.ok(peerMajor < 2,
    'the installed peer lite-bmfont is now ' + peerVersion + ' (>= 2.0.0): ...');
```

It reads *this* repo's INSTALLED bmfont version and asserted it stayed `< 2.0.0`.
That is now false (2.0.2), so the lane reddens -- which is exactly what its own
comment says it exists to do: force whoever crosses the format boundary to
re-verify and convert the lane into a real format-drift check. **Do not just
unpin it to green.**

## The conversion the guard asks for

Replace the `peerMajor < 2` assertion with a check that the peer's installed
bmfont is on the SAME binary format this bmfont ships -- i.e. read the peer's
installed `@zakkster/lite-bmfont` `FORMAT_VERSION` (the module export, value 2)
and assert it equals this package's `FORMAT_VERSION`:

```js
// The peer now crosses onto the 1/16 format. Assert both packages agree on the
// binary format rather than pinning the peer below it.
import { pathToFileURL } from 'node:url';
const peerBmfontMain = /* resolve LiteTextLayout/node_modules/@zakkster/lite-bmfont main */;
const peerModule = await import(pathToFileURL(peerBmfontMain));
assert.equal(peerModule.FORMAT_VERSION, FORMAT_VERSION,
    'LiteTextLayout is wired to a lite-bmfont on a DIFFERENT binary format: peer ' +
    peerModule.FORMAT_VERSION + ' vs ' + FORMAT_VERSION);
```

(Exact resolution mechanics are yours; the point is: format equality, not a
version-range pin.)

## Two facts worth carrying into that change

1. **`FORMAT_VERSION` is a MODULE export, not an instance property.** That is why
   lite-text-layout could NOT gate on `font.FORMAT_VERSION` and instead
   feature-detects the `advanceOf` accessor (present on 2.x, absent on 1.x). The
   peer's test CAN import the module and read the export -- the consumer at
   runtime cannot. Keep the guard reading the module, not a font object.

2. **Sibling finding, already handled on this side (F-49).** bmfont 2.0's
   `drawWrapped` flags-mask door now THROWS on a `FLAG_OVERFLOW` (2) line under a
   default (`checked`) font, where 1.x silently ignored it. lite-text-layout
   1.4.0 documents and pins this (T8 section 4, decision 0001 amendment) and
   considers it correct/fail-closed -- no change requested in the peer. Noted only
   so the two repos share one understanding of the pairing.

## Correct pairings (for both CHANGELOGs)

| lite-text-layout | lite-bmfont | correct? |
|---|---|---|
| `>= 1.4.0` | 1.x or 2.x | yes |
| `<= 1.3.0` | 1.x | yes |
| `<= 1.3.0` | `>= 2.0.0` | NO -- 16x geometry, upgrade text-layout to 1.4.0 |
