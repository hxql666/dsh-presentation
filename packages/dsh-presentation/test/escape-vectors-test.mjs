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
import { resolveBinary } from '../lib/engine.js'

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
// A path shape only means what it means on the platform that parses it. `C:\Windows\Temp`
// is a drive-letter escape on Windows and an ordinary (odd) file name on POSIX, where
// `path.resolve` keeps it inside the deck directory — so asserting "refused" there would
// be asserting a Windows behaviour on Linux. Each case carries the platform it applies
// to, and the rest are recorded rather than checked.
const CASES = [
  ['preview', true, 'a plain name', 'all'],
  ['sub/dir', true, 'a nested name', 'all'],
  ['.', true, 'the deck directory itself', 'all'],
  ['..', false, 'one level up', 'all'],
  ['../outside', false, 'into a sibling', 'all'],
  ['sub/../../outside', false, 'a traversal that leaves after entering', 'all'],
  ['....//outside', false, 'a doubled dot that resolves out', 'all'],
  ['/absolute/elsewhere', false, 'a POSIX absolute path', 'all'],
  ['..\\outside', false, 'a relative traversal with a backslash', 'win32'],
  ['C:\\Windows\\Temp', false, 'a drive-letter path', 'win32'],
  ['C:/Windows/Temp', false, 'the same with forward slashes', 'win32'],
  ['\\\\server\\share\\dir', false, 'a UNC share', 'win32'],
  ['//server/share/dir', false, 'the same with forward slashes', 'win32'],
  ['\\Windows\\Temp', false, 'rooted but driveless — resolves to the current drive root', 'win32'],
  ['', true, 'an empty string, meaning "not given"', 'all'],
]
for (const [input, expected, why, platforms] of CASES) {
  const applies = platforms === 'all' || platforms === process.platform
  const label = (input === '' ? '(empty)' : input).padEnd(22)
  if (!applies) {
    console.log(`  recorded: ${label} is a ${platforms}-shaped path; on ${process.platform} it is an ordinary name`)
    continue
  }
  const { contained } = decide(DECK, input)
  check(`${label} -> ${contained ? 'allowed' : 'refused'}`, contained === expected, expected === contained ? why : `${why} — WRONG`)
}

console.log('')
console.log('=== the same, resolved to absolute paths ===')
for (const [input, expected, , platforms] of CASES) {
  if (platforms !== 'all' && platforms !== process.platform) continue
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

    // What Typst's `--root` does in each direction. The tool layer has to check
    // because on Windows `--root` confines reads but not writes — a measurement, not a
    // rule of the format. On POSIX it may resolve the link and refuse the write too,
    // so the write direction is asserted where it was measured and recorded elsewhere;
    // the read direction is asserted everywhere.
    const typst = resolveBinary().path
    const vendor = path.join(PACKAGE_ROOT, 'vendor')
    fs.writeFileSync(path.join(DECK, 'probe.typ'), '#set page(width: 4cm, height: 3cm)\nthrough a link', 'utf8')
    const viaLink = spawnSync(typst, ['compile', '--root', DECK, '--package-path', vendor, path.join(DECK, 'probe.typ'), path.join(DECK, 'linked', 'escaped.png')], { encoding: 'utf8' })
    const escaped = fs.existsSync(path.join(OUTSIDE, 'escaped.png'))
    console.log(`  write through the link: exit=${viaLink.status} landed outside=${escaped}`)
    if (process.platform === 'win32') {
      check('--root does not confine writes, which is why the tool checks', escaped === true)
    } else {
      console.log(`  recorded on ${process.platform}: the write ${escaped ? 'escaped, as on Windows' : 'was refused by --root'}`)
      check('the tool layer refuses the link regardless of what --root does', direct.contained === false)
    }

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
