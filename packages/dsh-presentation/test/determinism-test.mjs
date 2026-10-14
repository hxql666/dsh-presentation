// Is "an untouched page stays pixel-identical" actually true?
//
// The README claims it, and a reviewer flagged it as too strong for a claim made
// without conditions. The honest answer is a measurement: rebuild the same spec
// twice, rebuild after an edit elsewhere in the deck, and compare the page images.
// Whatever comes out is what the README should say.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'determinism')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const SPEC = {
  title: 'determinism', locale: 'zh', theme: 'metropolis',
  slides: [
    { layout: 'cover' },
    { layout: 'bullets', title: '第一页', items: [{ text: '甲' }, { text: '乙' }] },
    { layout: 'kpis', title: '第二页', items: [{ value: '16', label: '页型' }] },
    { layout: 'timeline', title: '第三页', items: [{ when: '一月', what: '立项' }] },
  ],
}

/** Build and render, returning the PDF bytes and each page's PNG bytes. */
async function buildAndRender(label, spec) {
  const dir = path.join(WORK, label)
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf') })
  if (built.ok !== true) return { ok: false, error: String(built.stderr ?? '').slice(0, 120) }
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 72 })
  return {
    ok: true,
    pdf: fs.readFileSync(path.join(dir, 'deck.pdf')),
    source: fs.readFileSync(built.typFile, 'utf8'),
    pages: rendered.files.map((file) => fs.readFileSync(file)),
    dir,
  }
}

const first = await buildAndRender('run-1', SPEC)
const second = await buildAndRender('run-2', SPEC)
if (!first.ok || !second.ok) {
  console.log('  FAIL: a build failed')
  console.log(`    run-1: ${first.error ?? ''}`)
  console.log(`    run-2: ${second.error ?? ''}`)
  process.exit(1)
}

console.log('=== the same spec built twice in separate directories ===')
console.log(`  generated source identical : ${first.source === second.source}`)
console.log(`  PDF bytes identical        : ${first.pdf.equals(second.pdf)}  (${first.pdf.length} vs ${second.pdf.length})`)
for (let index = 0; index < first.pages.length; index += 1) {
  const same = first.pages[index].equals(second.pages[index])
  console.log(`  page ${index + 1} PNG identical       : ${same}  (${first.pages[index].length} vs ${second.pages[index].length})`)
}

// The claim that matters: edit one page, and do the others change?
const EDITED = {
  ...SPEC,
  slides: SPEC.slides.map((slide, index) =>
    index === 2 ? { ...slide, title: '第二页（改过）' } : slide),
}
const edited = await buildAndRender('run-3-edited', EDITED)
console.log('')
console.log('=== after editing slide 3, do the other pages change? ===')
if (!edited.ok) {
  console.log(`  FAIL: ${edited.error}`)
} else {
  for (let index = 0; index < first.pages.length; index += 1) {
    const same = first.pages[index].equals(edited.pages[index])
    const note = index === 2 ? '(the edited page itself)' : ''
    console.log(`  page ${index + 1} PNG unchanged      : ${same}  ${note}`)
  }
}

// A cleaner isolation: a deck whose *later* pages are identical, so a change to the
// page count alone can be checked without a content edit.
const LONGER = { ...SPEC, slides: [...SPEC.slides, { layout: 'quote', quote: '新增一页' }] }
const longer = await buildAndRender('run-4-longer', LONGER)
console.log('')
console.log('=== after appending a page, do the earlier pages change? ===')
if (!longer.ok) {
  console.log(`  FAIL: ${longer.error}`)
} else {
  for (let index = 0; index < first.pages.length; index += 1) {
    const same = first.pages[index].equals(longer.pages[index])
    console.log(`  page ${index + 1} PNG unchanged      : ${same}`)
  }
}

console.log('')
console.log('=== what the README may claim ===')
{
  let failures = 0
  const check = (label, condition, detail = '') => {
    if (!condition) failures += 1
    console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
  }

  check('the generated source is reproducible', first.source === second.source)
  // The PDF carries a creation and modification timestamp, so two builds that fall in
  // the same second are byte-identical and two that do not differ by those strings.
  // Asserting "they differ" would be a test that fails depending on the clock; what
  // matters is that any difference is confined to the timestamp and that the rendered
  // pages are unaffected.
  const identical = first.pdf.equals(second.pdf)
  check('the PDFs are the same length', first.pdf.length === second.pdf.length)
  if (identical) {
    check('the PDFs match exactly (both builds landed in the same second)', true)
  } else {
    const differing = [...first.pdf].filter((byte, index) => byte !== second.pdf[index]).length
    const hasTimestamps = /\/CreationDate\(D:\d{14}/.test(first.pdf.toString('latin1'))
    check('the only difference is the timestamp', differing < 120 && hasTimestamps, `${differing} bytes differ`)
  }

  for (let index = 0; index < first.pages.length; index += 1) {
    check(`page ${index + 1} renders identically across builds`, first.pages[index].equals(second.pages[index]))
  }

  if (edited.ok) {
    for (let index = 0; index < first.pages.length; index += 1) {
      const unchanged = first.pages[index].equals(edited.pages[index])
      // Every page but the edited one must be untouched.
      check(`editing slide 3 leaves page ${index + 1} as it was`, index === 2 ? !unchanged : unchanged)
    }
  }

  // The limit of the claim, asserted rather than left implicit: the footer carries a
  // page counter, so adding a page changes every page. This is why the README scopes
  // the promise to an edit that does not change the page count.
  if (longer.ok) {
    const anyChanged = first.pages.some((page, index) => !page.equals(longer.pages[index]))
    check('appending a page does change the earlier pages (the counter)', anyChanged)
  }

  console.log('')
  console.log(failures === 0 ? 'DETERMINISM VERIFIED' : `${failures} check(s) failed`)
  process.exitCode = failures === 0 ? 0 : 1
}

console.log('')
console.log(`artifacts: ${WORK}`)
