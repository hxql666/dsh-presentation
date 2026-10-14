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
check('a partial render must not claim the pages it did not draw', partial.files.length === 2, String(partial.files.length))
check('the reported pages are 1 and 2', partial.files.every((file) => /page-[12]\.png$/.test(file)))
check('no stale page 3 or 4 is claimed', partial.files.every((file) => !/page-[34]\.png$/.test(file)))

console.log('')
console.log('=== cleanup removes only what this renderer wrote ===')
{
  // The first implementation deleted every file matching a `page*.png` prefix. That
  // is too broad: a user's own `page-numbers.png` matches, and a file the renderer
  // did not create is not its to remove. What is deleted now comes from a manifest of
  // the previous render, so a name pattern can never reach a file this plugin did not
  // write.
  const guardDir = path.join(WORK, 'guard')
  const guardPreview = path.join(guardDir, 'preview')
  fs.mkdirSync(guardPreview, { recursive: true })
  const guardSpec = { title: 'guard', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'bullets', lead: 'x', items: [{ text: 'a' }] }] }
  const guardBuilt = await buildDeckPdf({ spec: guardSpec, buildDir: guardDir, outFile: path.join(guardDir, 'deck.pdf') })

  const userFiles = ['page-numbers.png', 'page-mine.png', 'page-1.png.bak']
  for (const name of userFiles) fs.writeFileSync(path.join(guardPreview, name), 'a file the user put here')

  await renderDeckPages({ typFile: guardBuilt.typFile, buildDir: guardDir, outputPattern: path.join(guardPreview, 'page-{p}.png'), ppi: 40 })
  const manifest = fs.readdirSync(guardPreview).find((name) => name.endsWith('.manifest.json'))
  check('a manifest records the render', manifest !== undefined, String(manifest))

  // Shrink the deck so pages 2+ become stale, then render again.
  const smallSpec = { title: 'guard', locale: 'zh', slides: [{ layout: 'cover' }] }
  const smallBuilt = await buildDeckPdf({ spec: smallSpec, buildDir: guardDir, outFile: path.join(guardDir, 'deck.pdf') })
  const second = await renderDeckPages({ typFile: smallBuilt.typFile, buildDir: guardDir, outputPattern: path.join(guardPreview, 'page-{p}.png'), ppi: 40 })

  const left = fs.readdirSync(guardPreview).sort()
  console.log(`  directory now : ${left.join(', ')}`)
  check('the stale page is gone', !left.includes('page-2.png'))
  check('the requested page is there', left.includes('page-1.png'))
  check('the manifest itself is not reported as a page', second.files.every((file) => file.endsWith('page-1.png')), String(second.files.length))
  for (const name of userFiles) {
    check(`the user's ${name} was not removed`, left.includes(name))
  }
}

console.log('')
console.log(failures === 0 ? 'STALE-PREVIEW FIX VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
