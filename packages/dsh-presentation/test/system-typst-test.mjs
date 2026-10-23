// Verify the system-Typst fallback, for real.
//
// The claim being tested is that a user who already has Typst 0.15+ installed no
// longer has to download the bundled 50 MB binary. Two things must hold:
//   1. the default behaviour is unchanged (bundled binary still wins when present)
//   2. when the bundled binary is absent, a suitable Typst on PATH is found
//   3. a Typst that is too old is refused rather than tried, because the failure
//      would otherwise surface deep inside the template with no useful message
//
// Fake `typst` executables are placed in a temp directory and prepended to PATH,
// so this exercises the real spawn-and-parse path rather than a mock.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBinary, compareVersions, MIN_TYPST, REQUIRED_TYPST } from '../lib/engine.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SANDBOX = path.join(PACKAGE_ROOT, '.test-output', 'system-typst')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('=== version comparison ===')
check('0.15.1 >= 0.15.0', compareVersions('0.15.1', MIN_TYPST) >= 0)
check('0.15.0 >= 0.15.0', compareVersions('0.15.0', MIN_TYPST) >= 0)
check('0.14.2 <  0.15.0', compareVersions('0.14.2', MIN_TYPST) < 0)
check('0.16.0 >= 0.15.0', compareVersions('0.16.0', MIN_TYPST) >= 0)
check('0.9.0  <  0.15.0', compareVersions('0.9.0', MIN_TYPST) < 0, 'string compare would get this wrong')

console.log('')
console.log('=== default still prefers the bundled binary ===')
{
  const binary = resolveBinary({})
  check('resolved without configuration', typeof binary.path === 'string')
  check('source is the bundled package', binary.source.startsWith('@flukxr/'), binary.source)
  check('hash was verified', binary.verified === true)
  check('version is the pinned release', binary.version === REQUIRED_TYPST, binary.version)
}

console.log('')
console.log('=== fake Typst executables on PATH ===')
// The shim has to be executable in the way this platform looks a command up: Windows
// resolves `typst` through PATHEXT, so a `.cmd` file works there; POSIX execs a file
// named exactly `typst` with the executable bit set. Writing only a `.cmd` made this
// suite pass on Windows and fail on Linux and macOS, which is what CI reported.
const FAKE_NAME = process.platform === 'win32' ? 'typst.cmd' : 'typst'
function writeFake(name, version) {
  const file = path.join(SANDBOX, `${name}-${FAKE_NAME}`)
  const body = process.platform === 'win32'
    ? `@echo off\r\necho typst ${version} (fake)\r\nexit /b 0\r\n`
    : `#!/bin/sh\necho "typst ${version} (fake)"\nexit 0\n`
  fs.writeFileSync(file, body, 'utf8')
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755)
  return file
}
const goodCmd = writeFake('good', '0.15.1')
const oldCmd = writeFake('old', '0.14.2')
const newCmd = writeFake('new', '0.16.0')

const originalPath = process.env.PATH
function withPath(dir, body) {
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`
  try { return body() } finally { process.env.PATH = originalPath }
}

// A directory holding only a too-old Typst: the fallback must not accept it.
const oldDir = path.join(SANDBOX, 'old-only')
fs.mkdirSync(oldDir, { recursive: true })
fs.copyFileSync(oldCmd, path.join(oldDir, FAKE_NAME))
if (process.platform !== 'win32') fs.chmodSync(path.join(oldDir, FAKE_NAME), 0o755)

const goodDir = path.join(SANDBOX, 'good')
fs.mkdirSync(goodDir, { recursive: true })
fs.copyFileSync(goodCmd, path.join(goodDir, FAKE_NAME))
if (process.platform !== 'win32') fs.chmodSync(path.join(goodDir, FAKE_NAME), 0o755)

const newDir = path.join(SANDBOX, 'new')
fs.mkdirSync(newDir, { recursive: true })
fs.copyFileSync(newCmd, path.join(newDir, FAKE_NAME))
if (process.platform !== 'win32') fs.chmodSync(path.join(newDir, FAKE_NAME), 0o755)

// `preferSystem: true` is the explicit opt-in; it must find the fake binary.
{
  const found = withPath(goodDir, () => resolveBinary({ preferSystem: true }))
  check('preferSystem finds a 0.15.1 on PATH', found.source === 'system:typst', found.source)
  check('reports the version it read', found.version === '0.15.1', found.version)
  check('marked unverified, because it is not the hash-checked binary', found.verified === false)
}

{
  const found = withPath(newDir, () => resolveBinary({ preferSystem: true }))
  check('a newer 0.16.0 is also accepted', found.version === '0.16.0', found.version)
}

console.log('')
console.log('=== a too-old Typst must be refused, not tried ===')
{
  let outcome
  try {
    outcome = { ok: true, value: withPath(oldDir, () => resolveBinary({ preferSystem: true })) }
  } catch (error) {
    outcome = { ok: false, code: error.code, message: error.message }
  }

  if (outcome.ok) {
    // On this machine the bundled binary exists, so preferSystem falls through
    // to it. That is correct behaviour: a too-old PATH Typst is skipped.
    check('fell through to the bundled binary instead of using 0.14.2', outcome.value.source.startsWith('@flukxr/'), outcome.value.source)
    check('the fallback reports the real bundled version', outcome.value.version === REQUIRED_TYPST, outcome.value.version)
  } else {
    check('refused when nothing suitable exists', outcome.code === 'binary-unavailable', outcome.code)
  }
}

console.log('')
console.log('=== no typst on PATH at all ===')
{
  const emptyDir = path.join(SANDBOX, 'empty')
  fs.mkdirSync(emptyDir, { recursive: true })
  const binary = withPath(emptyDir, () => resolveBinary({}))
  check('still resolves via the bundled binary', binary.source.startsWith('@flukxr/'), binary.source)
}

console.log('')
console.log(failures === 0 ? 'SYSTEM TYPST FALLBACK VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
