// Calibrate the density measurement before anything depends on it.
//
// The decoder is new code and its output is only useful if the numbers separate
// pages that are comfortably full from pages that have been packed. This renders a
// spread of pages — sparse, normal, dense, deliberately overfull — and reports the
// measurement for each, so a threshold can be chosen from evidence.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'
import { inkFraction, decodePng } from '../lib/png.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'density')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

console.log('=== the decoder agrees with the PNG header ===')
{
  const dir = path.join(WORK, 'decoder')
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: { title: 'd', locale: 'zh', slides: [{ layout: 'cover' }] },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 72 })
  const file = path.join(dir, 'p-1.png')
  const buffer = fs.readFileSync(file)
  // The IHDR carries the true size in its first 8 data bytes.
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const decoded = decodePng(buffer)
  console.log(`  IHDR says ${width}x${height}; decoded ${decoded.width}x${decoded.height} with ${decoded.channels} channels`)
  console.log(`  ${decoded.width === width && decoded.height === height ? 'OK  ' : 'FAIL'} dimensions match`)
  console.log(`  pixel buffer: ${decoded.pixels.length} bytes (expected ${width * height * decoded.channels})`)
  console.log(`  ${decoded.pixels.length === width * height * decoded.channels ? 'OK  ' : 'FAIL'} buffer size matches`)
}

const item = (text) => ({ text })
const long = '这是一条相当长的要点内容，用来占据页面上的一整行空间，以便把版面填满。'
async function density(label, frame, { theme = 'metropolis', ppi = 72 } = {}) {
  const dir = path.join(WORK, label.replace(/\W+/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: { title: 'd', locale: 'zh', theme, slides: [{ layout: 'cover' }, frame] },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  if (built.ok !== true) return { label, ok: false, error: String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? '' }
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi })
  const pages = rendered.files.filter((f) => !f.endsWith('p-1.png'))
  const measured = pages.map((file) => inkFraction(file))
  return {
    label,
    ok: true,
    pages: built.pages,
    images: rendered.files.length,
    overflow: (built.overflow ?? []).map((w) => w.message),
    densities: measured.map((m) => m.ink),
  }
}

console.log('')
console.log('=== density across page shapes ===')
console.log('  label                    pages  density of the content page(s)')
const CASES = {
  'empty bullets frame': { layout: 'bullets', title: '空' },
  'bullets 2 items': { layout: 'bullets', title: '两条', items: [item('甲'), item('乙')] },
  'bullets 6 short': { layout: 'bullets', title: '六条', items: Array.from({ length: 6 }, (_, i) => item(`要点 ${i + 1}`)) },
  'bullets 6 long': { layout: 'bullets', title: '六条长的', items: Array.from({ length: 6 }, () => item(long)) },
  'bullets 14 long (packed)': { layout: 'bullets', title: '十四条长的', items: Array.from({ length: 14 }, () => item(long)) },
  'kpis 4 tiles': { layout: 'kpis', title: '四块', items: Array.from({ length: 4 }, (_, i) => ({ value: String(i), label: '标签' })) },
  'cards 3': { layout: 'cards', title: '三卡', cards: Array.from({ length: 3 }, (_, i) => ({ title: `卡 ${i}`, body: ['正文一行'] })) },
  'table 6x4': { layout: 'table', title: '表格', headers: ['一', '二', '三', '四'], rows: Array.from({ length: 6 }, (_, i) => [String(i), 'b', 'c', 'd']) },
  'code 12 lines': { layout: 'code', title: '代码', source: Array.from({ length: 12 }, (_, i) => `let x${i} = ${i}`).join('\n') },
}

const results = {}
for (const [label, frame] of Object.entries(CASES)) {
  const result = await density(label, frame)
  results[label] = result
  if (result.ok !== true) {
    console.log(`  ${label.padEnd(24)} BUILD FAILED  ${result.error.slice(0, 60)}`)
    continue
  }
  const d = result.densities.map((v) => v.toFixed(3)).join(', ')
  console.log(`  ${label.padEnd(24)} ${String(result.pages).padStart(3)}    ${d}`)
}

console.log('')
console.log('=== does a packed page flow onto extra pages? ===')
for (const label of ['bullets 14 long (packed)', 'bullets 6 long', 'code 12 lines', 'table 6x4']) {
  const result = results[label]
  if (result?.ok === true) {
    const extra = result.images - result.pages
    console.log(`  ${label.padEnd(24)} frames+cover=${result.pages} images=${result.images}${extra > 0 ? `  ${extra} EXTRA` : ''}  overflow=${JSON.stringify(result.overflow)}`)
  }
}

console.log('')
console.log(`artifacts: ${WORK}`)
