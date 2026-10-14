// Reproduce the page-count question directly.
//
// The test report showed a deck of 8 logical frames producing 14 physical PDF
// pages, and one of 6 frames producing 12. The report's own `/Count` reading was
// wrong — a PDF page tree can have several nodes, and grepping the first `/Count`
// gets one of them — so the authoritative numbers are the ones `deck_build`
// returns alongside a real page count from the file itself.
//
// This builds known decks and compares: frames in, pages out.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'pagecount')

/**
 * Count real page objects in a PDF.
 *
 * The obvious regex, `/\/Type\s*\/Page[^s]/`, is wrong: `PageLabel` continues
 * with `L`, not `s`, and Typst emits one PageLabel per page for the viewer's page
 * numbering — so that pattern counts every page twice. This is the same mistake
 * the plugin itself made and that an independent test run reported as a page-count
 * mismatch; requiring a non-alphanumeric character after `Page` is the fix.
 */
function physicalPages(file) {
  const text = fs.readFileSync(file).toString('latin1')
  return (text.match(/\/Type\s*\/Page(?![A-Za-z0-9])/g) ?? []).length
}

/** Every `/Count` in the file, so a multi-node page tree is visible rather than guessed. */
function declaredCounts(file) {
  const text = fs.readFileSync(file).toString('latin1')
  return [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
}

const LAYOUTS = ['cover', 'bullets', 'compare', 'steps', 'cards', 'kpis', 'timeline', 'agenda', 'section', 'quote', 'table', 'columns']

function frame(layout, index) {
  switch (layout) {
    case 'cover':
      return { layout }
    case 'section':
    case 'agenda':
      return { layout, title: `S${index}`, items: ['one', 'two'] }
    case 'bullets':
      return { layout, title: `T${index}`, items: [{ text: 'one', detail: 'detail' }, { text: 'two' }] }
    case 'compare':
      return { layout, title: `T${index}`, left: { title: 'L', items: ['a', 'b'] }, right: { title: 'R', items: ['c', 'd'] } }
    case 'steps':
      return { layout, title: `T${index}`, items: [{ text: 'one' }, { text: 'two' }] }
    case 'cards':
      return { layout, title: `T${index}`, items: [{ title: 'a', body: 'x' }, { title: 'b', body: 'y' }] }
    case 'kpis':
      return { layout, title: `T${index}`, items: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }] }
    case 'timeline':
      return { layout, title: `T${index}`, items: [{ when: 'now', what: 'a' }, { when: 'then', what: 'b' }] }
    case 'quote':
      return { layout, text: 'A quote.', attribution: 'Someone' }
    case 'table':
      return { layout, title: `T${index}`, columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }
    case 'columns':
      return { layout, title: `T${index}`, columns: [{ title: 'a', items: ['x'] }, { title: 'b', items: ['y'] }] }
    default:
      return { layout }
  }
}

fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const report = []

async function measure(label, slides) {
  const dir = path.join(WORK, label.replace(/\W+/g, '-'))
  const pdf = path.join(dir, 'deck.pdf')
  const built = await buildDeckPdf({
    spec: { title: label, locale: 'zh', slides },
    buildDir: dir,
    outFile: pdf,
  })
  if (built.ok !== true) {
    report.push({ label, frames: slides.length, ok: false, stderr: String(built.stderr ?? '').slice(0, 200) })
    return
  }
  report.push({
    label,
    frames: slides.length,
    ok: true,
    reported: built.pages,
    physical: physicalPages(pdf),
    counts: declaredCounts(pdf),
    typFile: built.typFile,
  })
}

// One frame of each layout, so a layout-specific doubling shows up.
for (const layout of LAYOUTS) {
  await measure(`single-${layout}`, [frame(layout, 1)])
}

// Growing decks, to see whether the offset is constant or per-frame.
for (const count of [2, 3, 4, 6, 8]) {
  const slides = [frame('cover', 0)]
  const rest = ['bullets', 'compare', 'steps', 'cards', 'kpis', 'timeline', 'agenda', 'section']
  for (let index = 0; index < count - 1; index += 1) slides.push(frame(rest[index % rest.length], index + 1))
  await measure(`deck-${count}`, slides)
}

// The same deck requested as a handout, which is supposed to collapse subslides.
{
  const slides = [frame('cover', 0), frame('bullets', 1), frame('steps', 2)]
  const dir = path.join(WORK, 'handout')
  const pdf = path.join(dir, 'deck.pdf')
  const built = await buildDeckPdf({ spec: { title: 'handout', locale: 'zh', slides }, buildDir: dir, outFile: pdf, handout: true })
  report.push({ label: 'deck-3-handout', frames: 3, ok: built.ok === true, reported: built.pages, physical: built.ok ? physicalPages(pdf) : null, counts: built.ok ? declaredCounts(pdf) : [] })
}

console.log('label'.padEnd(22) + 'frames'.padEnd(8) + 'reported'.padEnd(10) + 'physical'.padEnd(10) + '/Count values')
console.log('-'.repeat(78))
for (const row of report) {
  const counts = row.counts === undefined ? '' : JSON.stringify(row.counts)
  console.log(
    String(row.label).padEnd(22) +
    String(row.frames).padEnd(8) +
    String(row.reported ?? '-').padEnd(10) +
    String(row.physical ?? '-').padEnd(10) +
    counts,
  )
  if (row.ok === false) console.log(`    FAILED: ${row.stderr}`)
}

const mismatched = report.filter((row) => row.ok === true && row.reported !== row.physical)
console.log('')
console.log(mismatched.length === 0
  ? 'CONSISTENT: the reported page count equals the pages in the file'
  : `MISMATCH in ${mismatched.length} case(s): the report and the file disagree`)
process.exitCode = mismatched.length === 0 ? 0 : 1
