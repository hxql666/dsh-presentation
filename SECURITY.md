# Security policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/hxql666/dsh-presentation/security/advisories/new)
rather than a public issue. If that is not available to you, open an issue that says
only that you have a security report and how to reach you — no details.

Expect an acknowledgement within a week. This is a single-maintainer project with no
funding and no response guarantee beyond that.

## What this project considers a vulnerability

The threat model is unusual and worth stating, because it decides what counts.

**The model's output is untrusted input.** A deck spec is written by a language
model, which may be steered by content it read — a web page, an image, a file in the
workspace. Every path in a spec therefore arrives from an untrusted source, and the
plugin's job is to keep that input from reaching anything outside the deck directory.

In scope:

- **A path escaping the deck directory.** `image` on the `image`/`image-text` pages,
  and `outDir` on `deck_check`, both come from model output.
- **Reading an arbitrary file.** If Typst's `--root` confinement can be bypassed, or a
  path can be made to resolve outside the tree through a symlink, a junction, a
  UNC path, a drive-relative path, or a case-insensitive filesystem difference.
- **Writing an arbitrary file.** The same paths, in the output direction. This is the
  one to look at hardest: **Typst's `--root` confines what a document may read, not
  where the compiler writes** — measured, and recorded in
  `test/outdir-test.mjs`. The containment check in the tool layer is therefore the
  only thing between a deck spec and an arbitrary write, and it is a refusal rather
  than a warning.
- **Injection into the generated document.** A spec's text reaches Typst as a content
  block. Everything special is escaped, including `*` and `_`, so a deck cannot emit
  Typst syntax. A way through that would be a vulnerability.
- **Command execution.** The plugin shells out to a Typst binary. Arguments are passed
  as an array, never through a shell.
- **Deleting something the renderer did not create.** Page images are cleaned based on
  a manifest of the previous render, not a name pattern (`test/stale-preview-test.mjs`).
  A file removed that the plugin did not write is a bug worth reporting.

Out of scope:

- **A deck that renders badly.** Overlap, overflow, a missing font — that is a quality
  problem, not a security one. Use a normal issue.
- **The content of a deck.** What a user asks the model to write is their business.
- **Anything requiring the attacker to already run code as the user.** The plugin runs
  in the user's own process with the user's own permissions; it does not claim to
  protect against a local attacker.
- **Supply chain of the Typst compiler.** The binary comes from the
  `@flukxr/typst-cli-*` packages. The plugin verifies its sha256 against a recorded
  value and reports `verified: false` when it does not match — it does not vendor the
  compiler, and it does not vouch for that publisher.

## What the plugin already does

| Boundary | How |
|---|---|
| `outDir` containment | Resolved against the deck directory and refused if it escapes. Asserted on six path shapes including two traversal forms and an absolute path. |
| Image path confinement | Typst compiles with the deck directory as `--root`; escaping paths fail with `would escape the project root`. Asserted. |
| Text injection | Content-block emission with a single-pass escape. Asserted. |
| Schema validity | `test/schema-gate.mjs` compiles and validates every tool schema before installation — a malformed schema takes down the whole session, not one tool. |
| Secrets in the repository | The tracked tree contains no credentials or personal data; `CHANGELOG.md` and the commit history record how that was checked. |
| Encoding damage | `test/encoding-audit.mjs` sweeps for BOMs, invalid UTF-8, mojibake and zero-width characters. |

## Scope note

This is a plugin for a personal-assistant application. It is not hardened software,
it has had no external review, and it ships without any warranty. If you are
considering it for a setting where a wrong path could matter, read the threat model
above and the two path-handling tests first.
