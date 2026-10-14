// Reproduce every claim from the second test run, from the plugin's own source.
//
// The report came from a session that had already run once, so its conclusions are
// regression comparisons rather than fresh observations. Each claim is therefore
// checked here directly: build the case, read the generated Typst, and inspect the
// PDF — rather than trusting the report's account of any of it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'
import { renderDeckSource, normalizeDeckSpec } from '../lib/render.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'repro')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

/** Build, and report the outcome with the generated source kept for inspection. */
async function attempt(label, spec, extra = {}) {
  const dir = path.join(WORK, label.replace(/\W+/g, '-'))
  let built
  try {
    built = await buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf'), ...extra })
  } catch (error) {
    return { label, threw: `${error.code ?? error.name}: ${error.message}` }
  }
  const source = fs.existsSync(path.join(dir, 'body.typ')) ? fs.readFileSync(path.join(dir, 'body.typ'), 'utf8') : ''
  return {
    label,
    ok: built.ok === true,
    pages: built.pages,
    diagnostics: (built.diagnostics ?? []).slice(0, 2).map((d) => `${d.severity}: ${d.message}`),
    stderr: built.ok === true ? '' : String(built.stderr ?? '').split('\n').filter((l) => l.trim() !== '').slice(0, 3).join(' | '),
    source,
    dir,
  }
}

const bullet = (title) => ({ layout: 'bullets', title, items: [{ text: 'one' }, { text: 'two' }] })

console.log('════════ claim 1: the `title` slot never reaches the page ════════')
{
  const withTitle = await attempt('title-yes', { title: 'T', locale: 'zh', slides: [{ layout: 'cover' }, bullet('可见标题'), { layout: 'kpis', title: '指标标题', items: [{ value: '1', label: 'a' }] }] })
  const withoutTitle = await attempt('title-no', { title: 'T', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'bullets', items: [{ text: 'one' }, { text: 'two' }] }, { layout: 'kpis', items: [{ value: '1', label: 'a' }] }] })

  const sizeOf = (dir) => (fs.existsSync(path.join(dir, 'deck.pdf')) ? fs.statSync(path.join(dir, 'deck.pdf')).size : 0)
  console.log(`  with title   : ok=${withTitle.ok} pages=${withTitle.pages} bytes=${sizeOf(withTitle.dir)}`)
  console.log(`  without title: ok=${withoutTitle.ok} pages=${withoutTitle.pages} bytes=${sizeOf(withoutTitle.dir)}`)
  console.log(`  identical bytes: ${sizeOf(withTitle.dir) === sizeOf(withoutTitle.dir)}`)

  // Is the title in the generated source at all?
  const hasTitleInSource = /title:\s*"可见标题"/.test(withTitle.source) || /title:\s*'可见标题'/.test(withTitle.source)
  console.log(`  'title:' present in generated source: ${hasTitleInSource}`)
  const titleLines = withTitle.source.split('\n').filter((l) => l.includes('title')).slice(0, 4)
  console.log('  source lines mentioning title:')
  for (const line of titleLines) console.log(`    ${line.trim().slice(0, 110)}`)

  // Does the template read the slot it is given?
  const template = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'layout.typ'), 'utf8')
  const layoutReads = [...template.matchAll(/page\.at\("(\w[\w-]*)"/g)].map((m) => m[1])
  console.log(`  slots the layout reads: ${[...new Set(layoutReads)].join(', ')}`)
  const renderer = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'render.js'), 'utf8')
  const emitted = [...renderer.matchAll(/^\s*(?:if \([^)]*\) )?(?:out|parts)\.push\(`?\s*(title|lead)[:=]/gm)].map((m) => m[1])
  console.log(`  keys the renderer emits for a titled layout: ${[...new Set(emitted)].join(', ') || '(see normalizeSlide)'}`)
}

console.log('')
console.log('════════ claim 2: **bold** prints literally ════════')
{
  const built = await attempt('bold', {
    title: 'B',
    locale: 'zh',
    slides: [{ layout: 'cover' }, { layout: 'bullets', title: 'bold', items: [{ text: '这是 **加粗** 和 *斜体*' }] }],
  })
  const body = built.source
  const line = body.split('\n').find((l) => l.includes('加粗')) ?? ''
  console.log(`  ok=${built.ok}`)
  console.log(`  emitted slot text: ${line.trim().slice(0, 160)}`)
  console.log(`  contains Typst emphasis (_ or *): ${/[_*]加粗[_*]/.test(line)}`)
  const renderer = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'render.js'), 'utf8')
  const esc = /function esc[\s\S]{0,700}?\n}/.exec(renderer)?.[0] ?? ''
  console.log('  the escaping function:')
  for (const escLine of esc.split('\n').slice(0, 14)) console.log(`    ${escLine.trim().slice(0, 100)}`)
}

console.log('')
console.log('════════ claim 3: simple / aqua / default fail to compile ════════')
for (const theme of ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']) {
  const built = await attempt(`theme-${theme}`, { title: 'T', locale: 'zh', theme, slides: [{ layout: 'cover' }, bullet('page')] })
  console.log(`  ${built.ok === true ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)} pages=${built.pages ?? '-'}${built.ok === true ? '' : `  ${built.stderr || built.threw || ''}`.slice(0, 130)}`)
}

console.log('')
console.log('════════ claim 4: scene + explicit theme fails ════════')
const combos = [
  ['product', undefined],
  ['product', 'dewdrop'],
  ['product', 'aqua'],
  ['tech-talk', 'metropolis'],
  ['academic', 'university'],
  ['pitch', 'stargazer'],
  ['review', 'aqua'],
  ['teaching', 'simple'],
]
for (const [scene, theme] of combos) {
  const spec = { title: 'T', locale: 'zh', slides: [{ layout: 'cover' }, bullet('page')] }
  if (theme !== undefined) spec.theme = theme
  const built = await attempt(`scene-${scene}-${theme ?? 'auto'}`, spec, { scene: undefined })
  // `scene` is a deck_build argument, not a spec field, so it goes through the tool
  // layer; here the equivalent is applying it the way the tool does.
  const applied = await (async () => {
    const scenes = await import('../lib/scenes.js')
    const found = scenes.findScene(scene)
    const merged = scenes.applyScene(spec, scene)
    return attempt(`scene-applied-${scene}-${theme ?? 'auto'}`, merged)
  })()
  console.log(`  scene=${scene.padEnd(10)} theme=${String(theme ?? '(none)').padEnd(12)} -> ${applied.ok === true ? `OK pages=${applied.pages}` : `FAIL ${(applied.stderr || applied.threw || '').slice(0, 120)}`}`)
}

console.log('')
console.log('════════ claim 5: timeline renders three rules only ════════')
{
  const built = await attempt('timeline', { title: 'T', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'timeline', title: 'time', items: [{ when: '1月', what: 'one' }, { when: '2月', what: 'two' }, { when: '3月', what: 'three' }] }] })
  console.log(`  ok=${built.ok} pages=${built.pages}`)
  const template = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'layout.typ'), 'utf8')
  const region = /#let timeline-page[\s\S]{0,1800}?\n}/.exec(template)?.[0] ?? '(timeline-page not found)'
  console.log('  timeline-page implementation:')
  for (const line of region.split('\n').slice(0, 30)) console.log(`    ${line.trim().slice(0, 104)}`)
}

console.log('')
console.log(`artifacts under ${WORK}`)
