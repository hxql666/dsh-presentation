// Measure the plugin's current state across the properties a deck actually needs.
//
// Each of these was reported or suspected, and none is covered by an assertion:
// whether a page type draws its content, whether overflow is detectable, whether a
// scene's font stack reaches the page, and whether a long deck stays consistent.
// Measurement first, so the work that follows targets real gaps.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'audit')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

/** Build, render, and report the ink a page covers as a fraction of its area. */
async function renderOne(label, frame, extra = {}) {
  const dir = path.join(WORK, label.replace(/\W+/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const spec = { title: 'audit', locale: 'zh', theme: extra.theme ?? 'metropolis', slides: [{ layout: 'cover' }, frame] }
  const built = await buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf'), ...extra.build })
  if (built.ok !== true) {
    return { label, ok: false, error: String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? '' }
  }
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 72 })
  const page = path.join(dir, 'p-2.png')
  return {
    label,
    ok: true,
    pages: built.pages,
    images: rendered.files.length,
    bytes: fs.existsSync(page) ? fs.statSync(page).size : 0,
    warnings: (built.diagnostics ?? []).filter((d) => d.severity === 'warning').length,
    diagnostics: (built.diagnostics ?? []).slice(0, 2).map((d) => d.message),
    dir,
  }
}

console.log('════════ 1. does each page type actually draw its content? ════════')
console.log('  (a page whose image is nearly the size of a blank one is suspicious)')
const BLANK = await renderOne('blank-control', { layout: 'section' }, {})
const blankBytes = BLANK.bytes
console.log(`  blank-ish control (section page): ${blankBytes} bytes`)
console.log('')

const LAYOUTS = {
  agenda: { layout: 'agenda', title: '议程', items: [{ text: '第一项' }, { text: '第二项' }, { text: '第三项' }] },
  bullets: { layout: 'bullets', title: '要点', items: [{ text: '甲', detail: '细节文字' }, { text: '乙' }] },
  steps: { layout: 'steps', title: '步骤', items: [{ text: '第一步' }, { text: '第二步' }] },
  cards: { layout: 'cards', title: '卡片', cards: [{ title: '一', body: '正文' }, { title: '二', body: '正文' }] },
  kpis: { layout: 'kpis', title: '指标', items: [{ value: '12', label: '标签', note: '注释' }] },
  timeline: { layout: 'timeline', title: '时间线', items: [{ when: '一月', what: '事件一' }, { when: '二月', what: '事件二' }, { when: '三月', what: '事件三' }] },
  compare: { layout: 'compare', title: '对比', left: { title: '左', items: ['a', 'b'] }, right: { title: '右', items: ['c', 'd'] } },
  quote: { layout: 'quote', quote: '这是一句引用。', author: '某人' },
  table: { layout: 'table', title: '表格', headers: ['列一', '列二'], rows: [['1', '2'], ['3', '4']] },
  code: { layout: 'code', title: '代码', source: 'let x = 1\nlet y = 2', language: 'typ' },
  columns: { layout: 'columns', title: '分栏', columns: [{ title: '左', items: ['a'] }, { title: '右', items: ['b'] }] },
}

for (const [name, frame] of Object.entries(LAYOUTS)) {
  const result = await renderOne(`layout-${name}`, frame)
  if (result.ok !== true) {
    console.log(`  ${name.padEnd(11)} BUILD FAILED  ${result.error.slice(0, 80)}`)
    continue
  }
  const ratio = blankBytes > 0 ? (result.bytes / blankBytes).toFixed(2) : '?'
  const flag = result.bytes < blankBytes * 1.15 ? '  <-- barely more ink than a blank page' : ''
  console.log(`  ${name.padEnd(11)} image=${String(result.bytes).padStart(6)} B  vs blank=${blankBytes}  ratio=${ratio}${flag}`)
}

console.log('')
console.log('════════ 2. is overflow reported at all? ════════')
{
  const many = Array.from({ length: 14 }, (_, i) => ({ text: `这是第 ${i + 1} 条很长的要点内容，用来把页面塞满，文字足够多以便触发溢出检测机制。` }))
  const result = await renderOne('overflow-bullets', { layout: 'bullets', title: '塞爆测试', items: many })
  console.log(`  bullets with 14 long items : ${result.ok ? `pages=${result.pages} warnings=${result.warnings}` : 'FAILED'}`)
  if (result.ok) {
    console.log(`    diagnostics: ${JSON.stringify(result.diagnostics)}`)
    console.log(`    images rendered: ${result.images} (more than the frames means content flowed onto extra pages)`)
  }
}

console.log('')
console.log('════════ 3. does a scene font stack reach the page? ════════')
{
  const scenes = await import('../lib/scenes.js')
  for (const id of ['academic', 'tech-talk']) {
    const scene = scenes.findScene(id)
    const merged = scenes.applyScene({ title: 'font-check', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'bullets', title: '字体', items: [{ text: '汉字与 Latin 混排 Aa Bb 123' }] }] }, id)
    const dir = path.join(WORK, `font-${id}`)
    fs.mkdirSync(dir, { recursive: true })
    const built = await buildDeckPdf({ spec: merged, buildDir: dir, outFile: path.join(dir, 'deck.pdf') })
    const source = fs.existsSync(path.join(dir, 'body.typ')) ? fs.readFileSync(path.join(dir, 'body.typ'), 'utf8') : ''
    const emitted = /font-stack: "(\w[\w-]*)"/.exec(source)?.[1]
    console.log(`  scene ${id.padEnd(10)} declares fontStack=${scene.fontStack}  emitted=${emitted}  ${emitted === scene.fontStack ? 'OK' : 'MISMATCH'}`)
  }
}

console.log('')
console.log('════════ 4. a long deck: page count and per-page health ════════')
{
  const many = []
  many.push({ layout: 'cover' })
  for (let i = 0; i < 30; i += 1) {
    many.push({ layout: 'bullets', title: `第 ${i + 1} 页`, items: [{ text: `要点 ${i + 1}` }] })
  }
  const result = await renderOne('long-deck', many[1], {})
  const dir = path.join(WORK, 'long-deck-30')
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({ spec: { title: 'long', locale: 'zh', slides: many }, buildDir: dir, outFile: path.join(dir, 'deck.pdf') })
  if (built.ok === true) {
    const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 50 })
    console.log(`  31 frames -> ${built.pages} pages, ${rendered.files.length} images`)
    console.log(`  ${built.pages === 31 ? 'one page per frame' : `DIFFERENT: ${built.pages - 31} extra`}`)
  } else {
    console.log(`  FAILED: ${String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? ''}`)
  }
}

console.log('')
console.log(`artifacts: ${WORK}`)
