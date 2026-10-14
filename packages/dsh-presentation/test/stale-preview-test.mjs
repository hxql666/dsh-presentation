// The stale-preview bug, reproduced and then checked.
//
// `deck_check` used to render into a directory without clearing it, and to report
// every PNG it found there as the result. A deck edited down from many pages to
// few therefore left images of pages that no longer exist, and the visual
// self-review step read them — inspecting pages outside the current deck and
// possibly "fixing" a problem the deck no longer had.
//
// This builds a large deck, renders it, rebuilds a smaller one into the same
// directory, renders again, and asserts that nothing from the larger run survives
// and that the returned list matches the pages actually requested.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'stale-preview')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const buildDir = path.join(WORK, 'deck')
const previewDir = path.join(WORK, 'preview')
const pattern = path.join(previewDir, 'page-{p}.png')

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

/** A deck with `count` frames. */
function spec(count) {
  const slides = [{ layout: 'cover' }]
  for (let index = 1; index < count; index += 1) {
    slides.push({ layout: 'bullets', lead: `页 ${index + 1}`, items: [{ text: `要点 ${index}` }] })
  }
  return { title: `stale ${count}`, locale: 'zh', slides }
}

console.log('=== 1. build and render a 9-frame deck ===')
const big = await buildDeckPdf({ spec: spec(9), buildDir, outFile: path.join(buildDir, 'deck.pdf') })
check('the large deck built', big.ok === true)
const bigRender = await renderDeckPages({ typFile: big.typFile, buildDir, outputPattern: pattern, ppi: 40 })
const afterBig = fs.readdirSync(previewDir).filter((n) => n.endsWith('.png')).sort()
check('9 images on disk', afterBig.length === 9, String(afterBig.length))
check('the render reported 9 files', bigRender.files.length === 9, String(bigRender.files.length))

console.log('')
console.log('=== 2. rebuild as a 4-frame deck, into the same directory ===')
const small = await buildDeckPdf({ spec: spec(4), buildDir, outFile: path.join(buildDir, 'deck.pdf') })
check('the small deck built', small.ok === true)
check('the small deck is 4 pages', small.pages === 4, String(small.pages))

const smallRender = await renderDeckPages({ typFile: small.typFile, buildDir, outputPattern: pattern, ppi: 40 })
const afterSmall = fs.readdirSync(previewDir).filter((n) => n.endsWith('.png')).sort()

console.log('')
console.log('=== 3. what survived ===')
console.log(`  files on disk : ${afterSmall.join(', ') || '(none)'}`)
console.log(`  reported      : ${smallRender.files.map((f) => path.basename(f)).join(', ') || '(none)'}`)

check('exactly 4 images remain', afterSmall.length === 4, String(afterSmall.length))
check('no image from the 9-frame run survived', !afterSmall.includes('page-5.png') && !afterSmall.includes('page-9.png'))
check('the render reported 4 files', smallRender.files.length === 4, String(smallRender.files.length))
check('every reported file exists', smallRender.files.every((file) => fs.existsSync(file)))
check('nothing beyond page 4 is reported', smallRender.files.every((file) => !/page-([5-9]|\d\d)\.png$/.test(file)))

console.log('')
console.log('=== 4. a partial render must not claim the pages it did not draw ===')
const partial = await renderDeckPages({ typFile: small.typFile, buildDir, outputPattern: pattern, ppi: 40, pages: [1, 2] })
const afterPartial = fs.readdirSync(previewDir).filter((n) => n.endsWith('.png')).sort()
console.log(`  files on disk : ${afterPartial.join(', ') || '(none)'}`)
console.log(`  reported      : ${partial.files.map((f) => path.basename(f)).join(', ') || '(none)'}`)
check('the partial render reported exactly 2 files', partial.files.length === 2, String(partial.files.length))
check('the reported pages are 1 and 2', partial.files.every((file) => /page-[12]\.png$/.test(file)))
check('no stale page 3 or 4 is claimed', partial.files.every((file) => !/page-[34]\.png$/.test(file)))

console.log('')
console.log(failures === 0 ? 'STALE-PREVIEW FIX VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
