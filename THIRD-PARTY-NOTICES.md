# Third-party notices

This repository redistributes and depends on third-party software. Each item
below is listed with its license and the obligation that comes with it.

---

## Redistributed in this repository

### Touying 0.8.0 — `packages/dsh-presentation/vendor/preview/touying/0.8.0/`

A Typst package for building presentation slides.

- License: MIT
- Copyright: © 2026 OrangeX4 `<orangex4@qq.com>`, © 2026 zral0kh, and the
  Touying authors (enklht, Andreas Kröpelin, ntjess, Enivex, Pol Dellaiera,
  pride7, Coekjan)
- Source: <https://github.com/touying-typ/touying>
- Registry: <https://typst.app/universe/package/touying>
- Obligation: the MIT license text travels with the vendored copy, in
  `vendor/preview/touying/0.8.0/LICENSE`. It is not modified.

Redistributed rather than downloaded at runtime on purpose: the plugin resolves
`@preview/touying` from its own `vendor/` directory so a deck builds offline and
the user's global Typst package store is never written to. Touying's
`compiler = "0.15.0"` requirement is why this plugin pins Typst 0.15.1.

### uniwarn 0.1.1 — `packages/dsh-presentation/vendor/preview/uniwarn/0.1.1/`

A helper that lets Typst packages emit custom warnings. Touying imports it
unconditionally, so it has to be vendored alongside.

- License: MIT
- Copyright: © 2026 fornings-typ
- Source: <https://github.com/fornings-typ/font-warnings>
- Obligation: the MIT license text travels with the vendored copy, in
  `vendor/preview/uniwarn/0.1.1/LICENSE`. It is not modified.

---

## Fetched at install time, not redistributed

### Typst 0.15.1 binary — via `@flukxr/typst-cli-*`

The plugin declares the per-platform binaries as `optionalDependencies`, so the
package manager fetches exactly one for the host platform. **No Typst binary is
committed to this repository.**

- License: Apache-2.0 (the Typst compiler)
- Wrapper package: <https://github.com/flukxr/typst-cli>
- Upstream: <https://github.com/typst/typst>
- Provenance: the wrapper records the release asset it was built from —
  `typst-x86_64-pc-windows-msvc.zip` from the official GitHub release — together
  with the archive digest and the extracted binary digest.

The plugin verifies that binary before running it: `lib/engine.js` hashes the
executable and compares it against the `typst.binarySha256` the wrapper
publishes, refusing to execute on a mismatch. The expected value for 0.15.1 on
win32-x64 is
`081217a463adb006f8894b44227fe4b9c9e91fc85f5463d5948e8370db9bb31e`.

An explicitly configured `typstBinaryPath` is trusted as given and is not
hash-checked, because the user chose that file.

---

## Fonts

No font is redistributed. Decks name font families and rely on the fonts already
installed on the machine, and the plugin never embeds or copies a font file.
The default stacks reference:

- **New Computer Modern**, **Libertinus Serif** — shipped with Typst
- **Noto Sans SC**, **Noto Serif SC** — SIL Open Font License 1.1
- **Microsoft YaHei**, **SimSun** — proprietary Microsoft fonts, referenced by
  name only and never redistributed

A deck's appearance therefore depends on the fonts present on the machine that
compiles it. Pass an explicit `fontStack` if a deck must look identical
everywhere, and install matching fonts on every machine that builds it.
