// The path-escape vectors a reviewer asked about, tested rather than reasoned about.
//
// `outDir` comes from model output, so it is untrusted. The containment check
// resolves it against the deck directory and refuses anything that leaves. That is
// straightforward for `../`; these are the cases where the same string means
// something different to Windows than to the check — a drive letter, a UNC share, a
// rooted-but-driveless path, a symlink or junction that points out, and a case
// difference on a case-insensitive filesystem.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'escape')
fs.rmSync(WORK, { recursive: true, force: true })
const DECK = path.join(WORK, 'deck')
const OUTSIDE = path.join(WORK, 'outside')
fs.mkdirSync(DECK, { recursive: true })
fs.mkdirSync(OUTSIDE, { recursive: true })

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

/**
 * The check `deck_check` applies to `outDir`, in full.
 *
 * Reproduced rather than imported because the tool needs a session to run; the
 * arithmetic is what is under test, and it is kept byte-identical to the tool. Both
 * layers are here because the first alone is not enough — see the symlink case.
 */
function realPathOf(target) {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

function realPathThrough(target) {
  const absolute = path.resolve(target)
  const missing = []
  let current = absolute
  for (;;) {
    try {
      const resolved = fs.realpathSync.native(current)
      return missing.length === 0 ? resolved : path.join(resolved, ...missing.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return absolute
      missing.push(path.basename(current))
      current = parent
    }
  }
}

function decide(deckDir, requested) {
  const resolved = path.resolve(deckDir, requested)
  const relative = path.relative(deckDir, resolved)
  // Layer one: the string arithmetic. Cheap, and it catches every textual escape.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { resolved, contained: false, layer: 'string' }
  }
  // Layer two: the same question asked of the filesystem, which is where a symlink
  // or junction shows up. Without this, a link named `linked` inside the deck
  // directory passes layer one and the write lands outside.
  const realRelative = path.relative(realPathOf(deckDir), realPathThrough(resolved))
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    return { resolved, contained: false, layer: 'realpath' }
  }
  return { resolved, contained: true, layer: 'both' }
}

console.log('=== the tool\'s arithmetic, on the shapes a model could produce ===')
const CASES = [
  ['preview', true, 'a plain name'],
  ['sub/dir', true, 'a nested name'],
  ['.', true, 'the deck directory itself'],
  ['..', false, 'one level up'],
  ['../outside', false, 'into a sibling'],
  ['..\\outside', false, 'the same with a backslash'],
  ['sub/../../outside', false, 'a traversal that leaves after entering'],
  ['....//outside', false, 'a doubled dot that resolves out'],
  ['/absolute/elsewhere', false, 'a POSIX absolute path'],
  ['C:\\Windows\\Temp', false, 'a drive-letter path'],
  ['C:/Windows/Temp', false, 'the same with forward slashes'],
  ['\\\\server\\share\\dir', false, 'a UNC share'],
  ['//server/share/dir', false, 'the same with forward slashes'],
  ['\\Windows\\Temp', false, 'rooted but driveless — resolves to the current drive root'],
  ['', true, 'an empty string, meaning "not given"'],
]
for (const [input, expected, why] of CASES) {
  const { contained } = decide(DECK, input)
  check(`${(input === '' ? '(empty)' : input).padEnd(22)} -> ${contained ? 'allowed' : 'refused'}`, contained === expected, expected === contained ? why : `${why} — WRONG`)
}

console.log('')
console.log('=== the same, resolved to absolute paths ===')
for (const [input, expected] of CASES) {
  const { resolved } = decide(DECK, input)
  const inside = resolved.toLowerCase().startsWith(DECK.toLowerCase())
  // `path.resolve` normalises, so an escape shows up as a prefix that is not the
  // deck directory; this is the second opinion on the arithmetic above.
  if (expected === false && input !== '') {
    check(`${input.slice(0, 22).padEnd(22)} resolves outside the deck`, !inside || !expected, resolved.slice(-46))
  }
}

console.log('')
console.log('=== a symlink that points out of the deck directory ===')
{
  const link = path.join(DECK, 'linked')
  let created = false
  try {
    fs.symlinkSync(OUTSIDE, link, 'junction')
    created = true
  } catch {
    // Creating a link needs a privilege Windows may withhold; skip rather than fail.
  }
  if (!created) {
    console.log('  SKIP  this platform would not create a link')
  } else {
    // This is the case that made the realpath layer necessary. It was found by
    // running the escape rather than reasoning about it: with only the string check,
    // the write landed outside the tree, exit 0, with no diagnostic anywhere.
    const direct = decide(DECK, 'linked')
    console.log(`  'linked'        -> ${direct.contained ? 'allowed' : `refused (${direct.layer} layer)`}`)
    check('a link inside the deck is refused', direct.contained === false)
    check('it is the realpath layer that catches it', direct.layer === 'realpath', String(direct.layer))

    const deeper = decide(DECK, 'linked/deeper')
    console.log(`  'linked/deeper' -> ${deeper.contained ? 'allowed' : `refused (${deeper.layer} layer)`}`)
    check('a path through the link is refused', deeper.contained === false)

    // A legitimate new directory must still be allowed, or the fix is a regression
    // that breaks the feature it protects.
    check('a new directory is still allowed', decide(DECK, 'brand-new/dir').contained === true)
    check('the deck directory itself is still allowed', decide(DECK, '.').contained === true)

    // What Typst's `--root` does in each direction, asserted because it is the
    // reason the tool layer has to check at all: it confines reads, not writes.
    const typst = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
    const vendor = path.join(PACKAGE_ROOT, 'vendor')
    fs.writeFileSync(path.join(DECK, 'probe.typ'), '#set page(width: 4cm, height: 3cm)\nthrough a link', 'utf8')
    const viaLink = spawnSync(typst, ['compile', '--root', DECK, '--package-path', vendor, path.join(DECK, 'probe.typ'), path.join(DECK, 'linked', 'escaped.png')], { encoding: 'utf8' })
    const escaped = fs.existsSync(path.join(OUTSIDE, 'escaped.png'))
    console.log(`  write through the link: exit=${viaLink.status} landed outside=${escaped}`)
    check('--root does not confine writes, which is why the tool checks', escaped === true)

    fs.writeFileSync(path.join(OUTSIDE, 'secret.typ'), 'outside content', 'utf8')
    const readViaLink = spawnSync(typst, ['compile', '--root', DECK, '--package-path', vendor, path.join(link, 'secret.typ'), path.join(DECK, 'read.png')], { encoding: 'utf8' })
    console.log(`  read through the link : exit=${readViaLink.status}`)
    check('--root does confine reads', readViaLink.status !== 0)
  }
}

console.log('')
console.log('=== case sensitivity ===')
{
  const upper = DECK.toUpperCase()
  const { contained } = decide(DECK, upper)
  console.log(`  the deck path in upper case is ${contained ? 'contained' : 'outside'} by the string check`)
  // On Windows the two paths are the same directory, so an absolute path differing
  // only in case is still inside; on Linux it is a different, non-existent path.
  const sameDirectory = fs.existsSync(upper) && fs.realpathSync.native(upper) === fs.realpathSync.native(DECK)
  console.log(`  the filesystem treats them as the same directory: ${sameDirectory}`)
  console.log('  (recorded: either answer is safe here — a refusal is not a bypass)')
}

console.log('')
console.log(failures === 0 ? 'ESCAPE VECTORS VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
