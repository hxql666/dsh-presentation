// Produce the README's demo image: a real three-page deck, built and rendered by
// the plugin, so the picture in the documentation is the plugin's own output rather
// than a mock-up.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'readme-demo')
const ASSETS = path.join(REPO_ROOT, 'docs')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
fs.mkdirSync(ASSETS, { recursive: true })

// The same spec the README prints, so the image and the text cannot drift.
const SPEC = {
  title: '从单体到三个服务',
  subtitle: '一次拆分复盘',
  author: '示例作者',
  locale: 'zh',
  theme: 'metropolis',
  scene: undefined,
  slides: [
    { layout: 'cover' },
    { layout: 'section', title: '为什么要拆' },
    {
      layout: 'bullets',
      title: '三个信号',
      lead: '我们不是在追时髦，是被三件事逼的',
      items: [
        { text: '发布互相阻塞', detail: '一个改动的发布要等另外两个' },
        { text: '故障域重合', detail: '一处内存泄漏拖垮整站' },
        { text: '团队边界模糊', detail: '没人说得清哪块代码归谁' },
      ],
      takeaway: '拆分的动机是组织问题，不是技术问题',
    },
    {
      layout: 'kpis',
      title: '拆分后的数字',
      items: [
        { value: '3', label: '服务', note: '原为一个' },
        { value: '12', label: '发布/周', note: '原为 2' },
        { value: '99.95%', label: '可用性', note: '原为 99.5%' },
      ],
      takeaway: '发布频率是最先改善的指标',
    },
  ],
}

const built = await buildDeckPdf({ spec: SPEC, buildDir: path.join(WORK, 'build'), outFile: path.join(WORK, 'deck.pdf') })
if (built.ok !== true) {
  console.log(`  FAIL: ${String(built.stderr ?? '').slice(0, 200)}`)
  process.exit(1)
}
console.log(`  built: ${built.pages} pages, ${built.bytes} bytes`)

const rendered = await renderDeckPages({
  typFile: built.typFile,
  buildDir: path.join(WORK, 'build'),
  outputPattern: path.join(WORK, 'page-{p}.png'),
  ppi: 150,
})
console.log(`  rendered: ${rendered.files.length} images`)

// The README shows the content page (page 3) rather than the cover, because a cover
// says nothing about how a content page looks.
const content = rendered.files.find((file) => file.endsWith('page-3.png'))
if (content === undefined) {
  console.log('  FAIL: page 3 was not rendered')
  process.exit(1)
}
const target = path.join(ASSETS, 'example-page.png')
fs.copyFileSync(content, target)
console.log(`  wrote ${path.relative(REPO_ROOT, target)} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`)

// A second image: the same page under a different theme, which is the clearest way
// to show that theme and page type are independent choices.
const alt = await buildDeckPdf({
  spec: { ...SPEC, theme: 'dewdrop' },
  buildDir: path.join(WORK, 'alt'),
  outFile: path.join(WORK, 'alt.pdf'),
})
if (alt.ok === true) {
  const altRendered = await renderDeckPages({
    typFile: alt.typFile,
    buildDir: path.join(WORK, 'alt'),
    outputPattern: path.join(WORK, 'alt-{p}.png'),
    ppi: 150,
  })
  const altContent = altRendered.files.find((file) => file.endsWith('alt-3.png'))
  if (altContent !== undefined) {
    const altTarget = path.join(ASSETS, 'example-page-dewdrop.png')
    fs.copyFileSync(altContent, altTarget)
    console.log(`  wrote ${path.relative(REPO_ROOT, altTarget)} (${(fs.statSync(altTarget).size / 1024).toFixed(0)} KB)`)
  }
}

console.log('')
console.log('  the spec used is the one the README prints')
