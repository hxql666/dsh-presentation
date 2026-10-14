// Render a titled page so the title can be looked at, not just compiled.
//
// A compile that succeeds proves the syntax is accepted; it does not prove the
// heading reaches the page. The bug being fixed was exactly that shape — a `title`
// slot present in the generated source and absent from the PDF — so this renders
// and reports where the images are, for visual confirmation.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'visual')

const CASES = [
  { name: 'simple-bullets', theme: 'simple', frame: { layout: 'bullets', title: '这是页面标题', lead: '引言文字', items: [{ text: '甲要点' }, { text: '乙要点' }], takeaway: '结论' } },
  { name: 'dewdrop-kpis', theme: 'dewdrop', frame: { layout: 'kpis', title: '指标页标题', items: [{ value: '12', label: '标签' }], takeaway: '结论' } },
  { name: 'aqua-compare', theme: 'aqua', frame: { layout: 'compare', title: '对比页标题', left: { title: '左', items: ['a'] }, right: { title: '右', items: ['b'] } } },
  { name: 'default-timeline', theme: 'default', frame: { layout: 'timeline', title: '时间线标题', items: [{ when: '一月', what: '事件' }] } },
]

for (const { name, theme, frame } of CASES) {
  const dir = path.join(WORK, name)
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: { title: 'visual', locale: 'zh', theme, slides: [{ layout: 'cover' }, frame] },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  if (built.ok !== true) {
    console.log(`  FAIL ${name}: ${String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? ''}`)
    continue
  }
  const rendered = await renderDeckPages({
    typFile: built.typFile,
    buildDir: dir,
    outputPattern: path.join(dir, 'page-{p}.png'),
    ppi: 100,
  })
  console.log(`  ${name.padEnd(20)} pages=${built.pages}  images=${rendered.files.length}`)
  for (const file of rendered.files) console.log(`      ${path.relative(PACKAGE_ROOT, file)}`)
}

// The title must appear in the rendered page. Comparing the same page number
// between a titled and an untitled deck is the signal: if the heading is missing
// from the body, the two pages carry identical content.
console.log('')
console.log('=== does the title reach the rendered page? ===')
const withTitle = path.join(WORK, 'simple-bullets')
const without = path.join(WORK, 'simple-untitled')
fs.mkdirSync(without, { recursive: true })
const plain = await buildDeckPdf({
  spec: { title: 'visual', locale: 'zh', theme: 'simple', slides: [{ layout: 'cover' }, { layout: 'bullets', lead: '引言文字', items: [{ text: '甲要点' }, { text: '乙要点' }], takeaway: '结论' }] },
  buildDir: without,
  outFile: path.join(without, 'deck.pdf'),
})
if (plain.ok !== true) {
  console.log(`  FAIL the untitled control did not build: ${String(plain.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? ''}`)
  process.exit(1)
}
await renderDeckPages({ typFile: plain.typFile, buildDir: without, outputPattern: path.join(without, 'page-{p}.png'), ppi: 100 })

const page = (dir, number) => {
  const file = path.join(dir, `page-${number}.png`)
  return fs.existsSync(file) ? fs.readFileSync(file) : undefined
}
const a = page(withTitle, 2)
const b = page(without, 2)
if (a === undefined || b === undefined) {
  console.log(`  FAIL a page-2 image is missing: titled=${a !== undefined} untitled=${b !== undefined}`)
  process.exit(1)
}
console.log(`  titled page-2   : ${a.length} bytes`)
console.log(`  untitled page-2 : ${b.length} bytes`)
console.log(`  identical       : ${a.equals(b)}`)
console.log('')
console.log(a.equals(b)
  ? '  THE TITLE HAS NO EFFECT — it is still not reaching the page'
  : '  THE TITLE CHANGES THE PAGE — it is rendering in the body')
process.exitCode = a.equals(b) ? 1 : 0
