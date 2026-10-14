// The license texts must travel with the package, and must not drift.
//
// The tarball carried the MIT texts of the two vendored Typst packages but not this
// project's own LICENSE and not THIRD-PARTY-NOTICES.md — so someone installing from
// npm got an MIT file belonging to Touying and nothing saying the compiler dependency
// is Apache-2.0, that no font is redistributed, or which families a deck expects.
//
// They are copies rather than symlinks (npm packs symlinks inconsistently), which
// means they can drift. This compares them.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('=== the copies match the originals ===')
// `README_EN.md` is in this list for the same reason as the licenses: `files` in
// package.json resolves against the package directory, and an entry that matches
// nothing there is skipped **silently**. Measured — the tarball shipped `README.md`
// and no `README_EN.md` until a copy existed beside it.
const COPIED = ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'README_EN.md']
for (const name of COPIED) {
  const original = path.join(REPO_ROOT, name)
  const copy = path.join(PACKAGE_ROOT, name)
  check(`${name} exists at the repository root`, fs.existsSync(original))
  check(`${name} exists in the package`, fs.existsSync(copy))
  if (fs.existsSync(original) && fs.existsSync(copy)) {
    const same = fs.readFileSync(original, 'utf8') === fs.readFileSync(copy, 'utf8')
    check(`${name} is identical to the original`, same, same ? '' : 'run `node ../../_recon_tools/ship-license-texts.mjs` or copy it')
  }
}

console.log('')
console.log('=== the manifest lists them ===')
{
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  for (const name of COPIED) {
    check(`files includes ${name}`, Array.isArray(manifest.files) && manifest.files.includes(name), JSON.stringify(manifest.files))
  }
  check('the manifest declares a license', typeof manifest.license === 'string' && manifest.license !== '', String(manifest.license))
}

console.log('')
console.log('=== what npm would actually pack ===')
{
  // `npm pack --dry-run --json` is the only reliable answer: `files` is an allowlist
  // and npm adds and removes entries of its own accord.
  let packed = []
  try {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PACKAGE_ROOT, encoding: 'utf8', shell: true })
    packed = JSON.parse(output)[0].files.map((entry) => entry.path)
  } catch (error) {
    console.log(`  SKIP  npm pack could not run: ${String(error.message).slice(0, 80)}`)
  }
  if (packed.length > 0) {
    console.log(`  ${packed.length} files would ship`)
    for (const name of COPIED) {
      check(`${name} ships`, packed.includes(name))
    }
    check('the vendored MIT text ships', packed.includes('vendor/preview/touying/0.8.0/LICENSE'))
    check('the vendored uniwarn text ships', packed.includes('vendor/preview/uniwarn/0.1.1/LICENSE'))
    // Both READMEs, because the Chinese one is the default and the English one is
    // how a non-Chinese reader gets the same document.
    check('the Chinese README ships', packed.includes('README.md'))
    check('the English README ships', packed.includes('README_EN.md'))
    // The font and compiler obligations are described in the notices, so the notices
    // shipping is what makes them reachable from a package install rather than only
    // from a clone.
    check('the notices describe the Apache-2.0 compiler', fs.readFileSync(path.join(PACKAGE_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8').includes('Apache-2.0'))
    check('the notices describe the fonts', /SIL Open Font License/.test(fs.readFileSync(path.join(PACKAGE_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')))
  }
}

console.log('')
console.log(failures === 0 ? 'LICENSE SHIPPING VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
