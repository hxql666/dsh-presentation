# Contributing

Thanks for looking. This is a small project and the process is correspondingly
light, but a few things are non-negotiable because they are what keeps it honest.

## Getting set up

```bash
git clone https://github.com/hxql666/dsh-presentation
cd dsh-presentation
npm install            # fetches the Typst binary for your platform
cd packages/dsh-presentation
npm test               # 27 suites, all platforms
```

`npm install` at the root installs the toolchain (TypeScript, Node types); the
package's own `npm install` pulls the platform Typst binary as an optional
dependency. A test run needs that binary, or a system Typst 0.15.x it can find.

## The rules that matter

**1. Every behaviour change comes with a test that would fail without it.**
Not a test that exercises the code path — a test that demonstrates the defect. The
suite is organised around failure modes that actually bit this project, and each
one names the evidence in a comment. `test/schema-gate.mjs` exists because a
malformed tool schema once took down the whole session; `test/stale-preview-test.mjs`
exists because a render once left old page images behind and the model reviewed
pages that were not in the deck.

**2. A claim in the README must be something you measured.** Where a number or a
property is asserted, the test that establishes it is named. If you cannot measure
it, say what you did not verify rather than stating it plainly — see the
Requirements table, which says outright that five of the six platforms are declared
but untested.

**3. Say when an approach was tried and failed.** `CHANGELOG.md` records refuted
attempts alongside fixes, and so do the code comments. Two examples worth reading
before you change anything nearby: why the density warning uses tonal spread rather
than colour count (the intuition was backwards — a solid-fill image used fewer
colours than a page of Chinese text), and why there is no render cache (measured:
rendering one page costs about what rendering all of them costs).

**4. Layout changes need a rendered check, not a compile check.** A page can compile
and still draw nothing. `test/theme-layout-matrix-test.mjs` builds every page type
under every theme, and `test/visual-title-test.mjs` compares a rendered page against
a control. Both exist because a defect once passed every compile-only test in the
suite.

**5. Run `npm test` before you push.** It runs the type check, then all suites. A
type error fails the run; the type check is `tsc --checkJs` over the source and its
JSDoc, which is how a documented contract is kept from drifting from the code.

**6. A test must not assert one platform's behaviour on another.** CI runs Ubuntu,
Windows and macOS, and the suite has to be green on all three. Three ways this goes
wrong, all of which have happened here:

- **A hardcoded binary path.** `node_modules/@flukxr/typst-cli-win32-x64/vendor/typst.exe`
  works on exactly one platform; use `resolveBinary()` from `lib/engine.ts` instead.
- **A fake executable.** A `.cmd` shim is found through `PATHEXT` on Windows and not at
  all on POSIX, where a command needs an executable bit — write a `#!/bin/sh` script and
  `chmod 0o755` there.
- **A path shape or font that only exists on one platform.** `C:\Windows\Temp` is a
  drive-letter escape on Windows and an ordinary file name on POSIX; and a machine
  without the named font families substitutes them, so two font stacks can legitimately
  render identically. Guard the platform-specific assertion and record the rest.

Anything measured on one machine — a density threshold, a pixel diff, a font list —
belongs in the test as a recorded value, not as a rule another platform must satisfy.

## Adding a page type

The checklist, in order:

1. `lib/render.js` — add the id to `LAYOUTS` and emit its slots in the switch.
2. `templates/layout.typ` — the layout primitive. **Do not name a parameter after a
   builtin**: a parameter called `image` shadows Typst's `image()` function and the
   call inside the layout becomes an attempt to call a string.
3. `templates/deck.typ` — the dispatch branch.
4. `lib/tools.js` — add a row to `LAYOUT_HELP`, to `REQUIRED_CONTENT` (what the page
   needs in order to draw anything), and to `KNOWN_KEYS` (what it reads). The last
   two are what stop a key mistake from failing in silence.
5. `test/theme-layout-matrix-test.mjs` — add the frame. The matrix asserts it covers
   every advertised layout, so forgetting this fails the suite.
6. `README.md` **and** `README_EN.md` — the row in the key table, and the layout
   count. Both, in the same change: `test/readme-parity-test.mjs` compares the two
   documents' heading skeleton, table row counts, code blocks, links and quoted
   measurements, so adding a section to one and not the other fails the suite.
7. `CHANGELOG.md` — under a new version.

## Changing the tool surface

Tool schemas are validated before installation by `test/schema-gate.mjs`, because
one malformed schema rejects the whole catalog rather than one tool. If you add a
parameter, add it to the schema, the description and the test in the same change —
`tsc` will catch a JSDoc contract that drifts, but not a description that lies.

## What will not be accepted

- **A cache of rendered pages.** Measured and rejected; see the README's table.
  Reintroducing one means re-earning the argument, and it has to answer the failure
  that motivated removing the last one.
- **Deleting files by name pattern.** The renderer removes what its own manifest
  records. A pattern is broader than intent — `page-numbers.png` matches `page*.png`.
- **Removing the `outDir` containment check**, or downgrading it to a warning. Typst's
  `--root` does not confine writes, so it is the only boundary there is.
- **A glob import of the themes.** It looks tidier and it breaks five themes: every
  theme module exports its own `slide`, so the last import wins for the whole
  document.

## Reporting a bug

Include the spec if you can, the output of `deck_status`, and the exact compiler
message. A rendered page image is worth more than a description — most defects in
this project were found by looking at the page rather than by reading the code.

Security reports go to [SECURITY.md](SECURITY.md) instead.

## Style

Match what is there. Comments explain *why*, and state the measurement or the
failure that motivated the code. Code and comments are English. Commit messages are
English and describe the defect and the evidence, not the diff.

There are two READMEs: `README.md` is Simplified Chinese and is the default (it is
what npm and GitHub show), `README_EN.md` is English. Chinese is the primary
language for user-facing prose; keep the two in step, and let the parity test tell
you when they are not.
