// Measure where the review loop spends its time, before optimising anything.
//
// A visual self-review renders every page and then looks at them. If a page is
// rebuilt after a one-page fix, the whole render runs again — so the cost of a
// review scales with the deck size even when nothing changed. This measures the
// stages separately so any change is aimed at the real one.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'perf')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const elapsed = async (label, fn) => {
  const started = process.hrtime.bigint()
  const value = await fn()
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms`)
  return { value, ms }
}

for (const pages of [5, 15, 40]) {
  console.log(`=== a ${pages}-page deck ===`)
  const dir = path.join(WORK, `deck-${pages}`)
  fs.mkdirSync(dir, { recursive: true })
  const slides = [{ layout: 'cover' }]
  for (let index = 1; index < pages; index += 1) {
    slides.push({ layout: 'bullets', title: `第 ${index} 页`, items: [{ text: '甲' }, { text: '乙' }] })
  }
  const spec = { title: `perf ${pages}`, locale: 'zh', slides }

  const built = await elapsed('build (spec -> PDF)', () =>
    buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf') }),
  )
  if (built.value.ok !== true) {
    console.log(`    FAILED: ${String(built.value.stderr ?? '').slice(0, 90)}`)
    continue
  }

  await elapsed('render all pages to PNG', () =>
    renderDeckPages({ typFile: built.value.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 72 }),
  )

  // The case that matters: one page changed, and the review runs again.
  await elapsed('re-render all pages (unchanged)', () =>
    renderDeckPages({ typFile: built.value.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 72 }),
  )

  await elapsed('re-render a single page', () =>
    renderDeckPages({ typFile: built.value.typFile, buildDir: dir, outputPattern: path.join(dir, 'q-{p}.png'), ppi: 72, pages: [2] }),
  )
  console.log('')
}

console.log(`artifacts: ${WORK}`)
