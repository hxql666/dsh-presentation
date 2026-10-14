// Every page type under every theme.
//
// The plugin shipped seven themes and fourteen page types, but only two themes
// could render a titled page: the rest do not declare a `title` parameter on
// `slide`, so the named argument reached `touying-slide` and aborted the compile.
// Nothing caught it because no test built a page under more than one theme.
//
// This builds the whole matrix, which is the property the README claims: a theme
// and a page type are independent choices.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'matrix')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const THEMES = ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']

/** One frame per layout, with every slot the layout documents filled. */
const FRAMES = [
  { layout: 'cover' },
  { layout: 'section', title: '章节标题' },
  { layout: 'agenda', title: '议程', items: [{ text: '第一项' }, { text: '第二项' }] },
  { layout: 'bullets', title: '要点', lead: '引言', items: [{ text: '甲', detail: '细节' }, { text: '乙' }], takeaway: '结论' },
  { layout: 'steps', title: '步骤', items: [{ text: '第一步' }, { text: '第二步' }], takeaway: '结论' },
  { layout: 'cards', title: '卡片', cards: [{ title: '一', body: '正文' }, { title: '二', body: '正文' }], takeaway: '结论' },
  { layout: 'kpis', title: '指标', items: [{ value: '12', label: '标签', note: '注释' }], takeaway: '结论' },
  { layout: 'timeline', title: '时间线', items: [{ when: '一月', what: '事件' }, { when: '二月', what: '事件' }], takeaway: '结论' },
  { layout: 'compare', title: '对比', left: { title: '左', items: ['a'] }, right: { title: '右', items: ['b'] } },
  { layout: 'quote', quote: '一句话引用。', author: '某人' },
  { layout: 'table', title: '表格', headers: ['列一', '列二'], rows: [['1', '2']] },
  { layout: 'code', title: '代码', source: 'let x = 1', language: 'typ', takeaway: '结论' },
  { layout: 'image-text', title: '图文', body: ['正文'], caption: '图注' },
  { layout: 'columns', title: '分栏', columns: [{ title: '左', items: ['a'] }, { title: '右', items: ['b'] }] },
]

let failures = 0
const rows = []

for (const theme of THEMES) {
  for (const frame of FRAMES) {
    const label = `${theme}-${frame.layout}`
    const dir = path.join(WORK, label)
    let built
    try {
      built = await buildDeckPdf({
        spec: { title: 'matrix', locale: 'zh', theme, slides: [{ layout: 'cover' }, frame] },
        buildDir: dir,
        outFile: path.join(dir, 'deck.pdf'),
      })
    } catch (error) {
      built = { ok: false, stderr: `${error.code ?? error.name}: ${error.message}` }
    }
    if (built.ok !== true) {
      failures += 1
      const error = String(built.stderr ?? '').split('\n').find((line) => line.includes('error')) ?? String(built.stderr ?? '').slice(0, 90)
      rows.push(`  FAIL ${theme.padEnd(12)} ${frame.layout.padEnd(12)} ${error.slice(0, 100)}`)
    }
  }
}

console.log(`  combinations tried: ${THEMES.length * FRAMES.length}`)
console.log(`  failures: ${failures}`)
for (const row of rows) console.log(row)

console.log('')
console.log(failures === 0
  ? 'MATRIX VERIFIED: every page type renders under every theme'
  : `${failures} combination(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
