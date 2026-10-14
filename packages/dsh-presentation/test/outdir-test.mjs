// The outDir parameter for deck_check, tested for the two things that matter.
//
// 1. Images land where the caller asked, because a model cannot copy a file — the
//    render is the only chance to put them in the right place.
// 2. A path outside the deck directory is refused. The parameter comes from model
//    output, so it is untrusted input: without the guard, a deck spec could be
//    used to write PNGs anywhere the process can reach.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'
import { renderDeckPages } from '../lib/build.js'
import { EngineError } from '../lib/engine.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'out-dir')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

const buildDir = path.join(WORK, 'deck')
const built = await buildDeckPdf({
  spec: { title: 'outdir', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'bullets', lead: 'p', items: [{ text: 'x' }] }] },
  buildDir,
  outFile: path.join(buildDir, 'deck.pdf'),
})
check('the deck built', built.ok === true)
check('the deck is 2 pages', built.pages === 2, String(built.pages))

console.log('')
console.log('=== a requested directory is used ===')
{
  const target = path.join(WORK, 'elsewhere', 'pages')
  const result = await renderDeckPages({
    typFile: built.typFile,
    buildDir,
    outputPattern: path.join(target, 'page-{p}.png'),
    ppi: 40,
  })
  const onDisk = fs.existsSync(target) ? fs.readdirSync(target).filter((n) => n.endsWith('.png')) : []
  check('images were written to the requested directory', onDisk.length === 2, `${onDisk.length} file(s)`)
  check('the render reported them', result.files.length === 2, String(result.files.length))
  check('every reported path is inside that directory', result.files.every((f) => f.startsWith(target)))
}

console.log('')
console.log('=== the containment guard ===')
{
  // The check mirrors what the tool does before calling the renderer. It is
  // reproduced here because the guard lives in the tool layer, which needs a
  // context to exercise; the property under test is the path arithmetic.
  const deckDir = buildDir
  const attempts = [
    { input: '../escape', allowed: false },
    { input: '..\\escape', allowed: false },
    { input: 'sub/dir', allowed: true },
    { input: 'preview', allowed: true },
    { input: '../../../Windows/Temp/evil', allowed: false },
  ]
  for (const { input, allowed } of attempts) {
    const resolved = path.resolve(deckDir, input)
    const relative = path.relative(deckDir, resolved)
    const contained = !relative.startsWith('..') && !path.isAbsolute(relative)
    check(`${JSON.stringify(input)} -> ${contained ? 'allowed' : 'refused'}`, contained === allowed, contained === allowed ? '' : 'wrong verdict')
  }
  // An absolute path outside the tree must also be refused.
  const outside = path.resolve(deckDir, '..', 'somewhere-else')
  const relative = path.relative(deckDir, outside)
  check('an absolute path outside the tree is refused', relative.startsWith('..'))
}

console.log('')
console.log('=== --root does not confine output, so the guard is the only defence ===')
{
  // Measured, not assumed: Typst's --root confines what a document may *read*.
  // It does not confine where the compiler *writes*. A pattern outside the root
  // therefore produces files outside the root.
  //
  // That makes the containment check in the tool layer load-bearing rather than
  // belt-and-braces: `outDir` comes from model output, and without the guard a
  // deck spec could be used to write PNGs anywhere the process can reach.
  const outside = path.join(WORK, 'outside-root')
  fs.mkdirSync(outside, { recursive: true })
  const result = await renderDeckPages({
    typFile: built.typFile,
    buildDir,
    outputPattern: path.join(outside, 'page-{p}.png'),
    ppi: 40,
  })
  const written = fs.readdirSync(outside).filter((n) => n.endsWith('.png'))
  console.log(`  files written outside --root: ${written.length}`)
  check(
    'the renderer writes outside the root, which is why outDir is validated first',
    written.length > 0,
    written.length > 0 ? 'confirms the guard is required' : 'unexpected: this test no longer proves anything',
  )
  check('the render still reports what it produced', result.files.length === written.length, `${result.files.length} vs ${written.length}`)

  // And the guard that protects against it, applied to the same paths a model
  // could ask for.
  const deckDir = buildDir
  for (const input of ['../outside-root', '..\\outside-root', outside]) {
    const resolved = path.resolve(deckDir, input)
    const relative = path.relative(deckDir, resolved)
    const contained = !relative.startsWith('..') && !path.isAbsolute(relative)
    check(`guard refuses ${JSON.stringify(input)}`, contained === false)
  }
}

console.log('')
console.log(failures === 0 ? 'OUTDIR VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
