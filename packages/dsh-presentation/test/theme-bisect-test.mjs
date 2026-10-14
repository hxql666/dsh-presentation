// Bisect the plugin's own use of a theme until the failure is one difference wide.
//
// Neither the theme alone nor all seven together reproduce it, so the cause is
// something the plugin does beyond importing and calling a theme. This walks the
// plugin's render path one option at a time: a bare one-slide deck per theme, then
// progressively closer to the real thing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'theme-bisect')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const THEMES = ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']

async function build(label, spec) {
  const dir = path.join(WORK, label.replace(/\W+/g, '-'))
  try {
    const built = await buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf') })
    return { ok: built.ok === true, pages: built.pages, stderr: built.ok === true ? '' : String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? '' }
  } catch (error) {
    return { ok: false, stderr: `${error.code ?? error.name}: ${error.message}` }
  }
}

const cases = {
  'cover only': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'cover' }] }),
  'bullets only': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'bullets', title: 'x', items: [{ text: 'a' }] }] }),
  'cover + bullets': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'cover' }, { layout: 'bullets', title: 'x', items: [{ text: 'a' }] }] }),
  'section layout': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'section', title: 'S' }, { layout: 'bullets', title: 'x', items: [{ text: 'a' }] }] }),
  'agenda layout': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'agenda', title: 'A', items: ['one'] }] }),
  'quote layout': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'quote', text: 'q', attribution: 'a' }] }),
  'with takeaway': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'bullets', title: 'x', items: [{ text: 'a' }], takeaway: 't' }] }),
  'with lead': (theme) => ({ title: 'T', locale: 'zh', theme, slides: [{ layout: 'bullets', lead: 'l', items: [{ text: 'a' }] }] }),
}

for (const [label, make] of Object.entries(cases)) {
  const line = []
  for (const theme of THEMES) {
    const result = await build(`${label}-${theme}`, make(theme))
    line.push(`${theme.slice(0, 4)}:${result.ok ? 'ok' : 'FAIL'}`)
  }
  console.log(`  ${label.padEnd(18)} ${line.join('  ')}`)
}

console.log('')
console.log('=== the first failing case, in full ===')
for (const [label, make] of Object.entries(cases)) {
  for (const theme of THEMES) {
    const result = await build(`full-${label}-${theme}`, make(theme))
    if (!result.ok) {
      console.log(`  ${label} + ${theme}`)
      console.log(`    ${result.stderr}`)
      const dir = path.join(WORK, `${label}-${theme}`.replace(/\W+/g, '-'))
      const source = path.join(dir, 'body.typ')
      if (fs.existsSync(source)) {
        console.log('  generated source:')
        for (const line of fs.readFileSync(source, 'utf8').split('\n').slice(0, 22)) console.log(`    ${line}`)
      }
      process.exit(0)
    }
  }
}
console.log('  no case failed')
