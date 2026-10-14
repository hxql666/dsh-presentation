// Calibrate the colour threshold that separates a picture page from a text page.
//
// The exemption from the density warning turns on this number, so it is measured
// across page types rather than guessed: a page of text with tinted panels uses a
// few dozen colours, a page carrying an image uses hundreds.
import fs from 'node:fs'
import path from 'node:path'
import { inkFraction } from '../lib/png.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')

const CASES = [
  ['bullets (text)', '.test-output/density/bullets-6-long'],
  ['bullets from text', '.test-output/density/bullets-2-items'],
  ['kpis (text)', '.test-output/density/kpis-4-tiles'],
  ['cards (text)', '.test-output/density/cards-3'],
  ['table (text)', '.test-output/density/table-6x4'],
  ['code (text)', '.test-output/density/code-12-lines'],
  ['image page', '.test-output/new-layouts/image'],
  ['sources (text)', '.test-output/new-layouts/sources'],
  ['e2e image page', '..\\_recon_tools\\.e2e\\preview'],
]

console.log('  page type              midtones   colours    ink')
const values = []
for (const [label, relative] of CASES) {
  const dir = path.join(ROOT, relative)
  if (!fs.existsSync(dir)) {
    console.log(`  ${label.padEnd(22)} (missing)`)
    continue
  }
  const pngs = fs.readdirSync(dir).filter((name) => /^p-\d+\.png$/.test(name)).sort()
  if (pngs.length === 0) {
    console.log(`  ${label.padEnd(22)} (no images)`)
    continue
  }
  // The last page is the content page in every fixture.
  const measured = inkFraction(path.join(dir, pngs.at(-1)))
  values.push([label, measured.midtones, measured.colours])
  console.log(
    `  ${label.padEnd(22)} ${(measured.midtones * 100).toFixed(1).padStart(6)}%   ` +
    `${String(measured.colours).padStart(5)}   ${measured.ink.toFixed(3)}`,
  )
}

console.log('')
const text = values.filter(([label]) => !label.includes('image'))
const picture = values.filter(([label]) => label.includes('image'))
const maxText = Math.max(...text.map(([, m]) => m))
const minPicture = Math.min(...picture.map(([, m]) => m))
console.log(`  text pages:    midtones up to ${(maxText * 100).toFixed(1)}%`)
console.log(`  picture pages: midtones from  ${(minPicture * 100).toFixed(1)}%`)
console.log(`  gap between them: ${((minPicture - maxText) * 100).toFixed(1)} points`)
console.log('')
console.log(
  minPicture > maxText
    ? `  A threshold of 25% sits in the gap: text pages stay under it, picture pages over it.`
    : '  the two overlap — the metric does not separate them',
)
