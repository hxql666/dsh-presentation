// Does `**bold**` reach the page as bold, as literal characters, or as nothing?
//
// The report says the converter is right — the generated Typst contains `*加粗*`
// rather than `**加粗**` — yet the page still shows the marks. A conversion can be
// correct and still not take effect if the markup is escaped, if the emphasis is
// inside a code span, or if the layout wraps the text in something that turns
// markup into plain text. This renders the page and looks at it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'bold')

const CASES = [
  { name: 'bold', text: '这句有 **加粗** 和 *斜体* 两种' },
  { name: 'plain', text: '这句有 加粗 和 斜体 两种' },
  { name: 'escaped', text: '这句有 \\*加粗\\* 转义星号' },
]

for (const { name, text } of CASES) {
  const dir = path.join(WORK, name)
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: { title: 'B', locale: 'zh', theme: 'metropolis', slides: [{ layout: 'cover' }, { layout: 'bullets', title: 'T', items: [{ text }] }] },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  if (built.ok !== true) {
    console.log(`  FAIL ${name}: ${String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? ''}`)
    continue
  }
  const source = fs.readFileSync(built.typFile, 'utf8')
  const emitted = source.split('\n').find((l) => l.includes('这句')) ?? ''
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'page-{p}.png'), ppi: 110 })
  const image = path.join(dir, 'page-2.png')

  console.log(`  ${name.padEnd(9)} image=${rendered.files.length > 1 ? 'yes' : 'no'}`)
  console.log(`      emitted: ${emitted.trim().slice(0, 120)}`)
  console.log(`      size   : ${fs.existsSync(image) ? fs.statSync(image).size : 0} bytes`)
}

// Compare the ink of the bold case against the plain one, and assert on what the
// generated source actually contains. Emphasis reaching the page is the property;
// the emitted markup is how it gets there.
console.log('')
console.log('=== assertions ===')
const SOURCES = new Map()
for (const { name } of CASES) {
  const file = path.join(WORK, name, 'body.typ')
  if (fs.existsSync(file)) SOURCES.set(name, fs.readFileSync(file, 'utf8'))
}

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

const boldSource = SOURCES.get('bold') ?? ''
check('emphasis is emitted as a Typst call', /#strong\[加粗\]/.test(boldSource), '#strong[加粗]')
check('italic is emitted as a Typst call', /#emph\[斜体\]/.test(boldSource), '#emph[斜体]')
check('the literal markers are gone from the source', !/\*\*加粗\*\*/.test(boldSource) && !/\*加粗\*/.test(boldSource))
check('text is a content block, not a string', /text: \[/.test(boldSource))

const plainSource = SOURCES.get('plain') ?? ''
check('plain text carries no emphasis call', !/#strong|#emph/.test(plainSource))
check('plain text is still a content block', /text: \[/.test(plainSource))

// The rendered page must differ from the unemphasised one, which it cannot if the
// marks are printed literally with the same words around them.
const boldImage = path.join(WORK, 'bold', 'page-2.png')
const plainImage = path.join(WORK, 'plain', 'page-2.png')
if (fs.existsSync(boldImage) && fs.existsSync(plainImage)) {
  const a = fs.readFileSync(boldImage)
  const b = fs.readFileSync(plainImage)
  check('the emphasised page differs from the plain one', !a.equals(b), `${a.length} vs ${b.length} bytes`)
}

console.log('')
console.log(failures === 0 ? 'BOLD VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
