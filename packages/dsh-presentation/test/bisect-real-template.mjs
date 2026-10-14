// Bisect the plugin's real template, not a reconstruction of it.
//
// Reconstructions all passed, which means the cause lives in something the plugin
// does that the reconstructions left out. This copies the actual generated
// document plus the actual templates, then removes one candidate at a time and
// recompiles, so the answer comes from the artifact rather than from a guess.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'bisect-real')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

// Produce a real, failing build and keep its directory as the starting point.
const source = path.join(WORK, 'src')
const built = await buildDeckPdf({
  spec: { title: 'T', locale: 'zh', theme: 'simple', slides: [{ layout: 'cover' }] },
  buildDir: source,
  outFile: path.join(source, 'deck.pdf'),
})
console.log(`  baseline build: ok=${built.ok}`)
console.log(`  ${String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? ''}`)

function compileAt(dir, label) {
  const result = spawnSync(TYPST, ['compile', '--root', dir, '--package-path', VENDOR, '--diagnostic-format', 'short', path.join(dir, 'body.typ'), path.join(dir, 'out.pdf')], { encoding: 'utf8' })
  const error = (result.stderr ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('error'))
  return { ok: result.status === 0, error }
}

/** Copy the working directory, apply an edit to deck.typ, and compile. */
function variant(label, edit) {
  const dir = path.join(WORK, label.replace(/\W+/g, '-'))
  fs.cpSync(source, dir, { recursive: true })
  const deckFile = path.join(dir, 'deck.typ')
  const before = fs.readFileSync(deckFile, 'utf8')
  const after = edit(before)
  if (after === before) {
    console.log(`  SKIP  ${label} — the edit changed nothing`)
    return
  }
  fs.writeFileSync(deckFile, after, 'utf8')
  const result = compileAt(dir, label)
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${label}${result.ok ? '' : `  ${result.error}`}`)
}

console.log('')
console.log('=== candidates removed one at a time ===')

// 1. Our own show rule about fonts, which runs after the theme's.
variant('no font show rule', (text) => text.replace(/  show: it => \{\n[\s\S]*?\n  \}\n/, ''))

// 2. `align` from the deck configuration.
variant('no align option', (text) => text.replace(/\n\s*align: align,/, ''))

// 3. The second configuration dictionary (handout / pdfpc / breakable).
variant('no second dict', (text) => text.replace(/\n\s*\(\n\s*handout: handout,\n\s*enable-pdfpc: true,\n\s*breakable: breakable,\n\s*\),/, ''))

// 4. `enable-pdfpc`, which makes Touying build page labels.
variant('no enable-pdfpc', (text) => text.replace(/\n\s*enable-pdfpc: true,/, ''))

// 5. Our layout.typ import.
variant('no layout import', (text) => text.replace('#import "layout.typ": *\n', ''))

// 6. `render-slides` replaced by a plain Touying slide, to isolate our page code.
variant('plain slide instead of render-slides', (text) => text.replace(/\n\s*render-slides\(slides, info: info\)/, '\n  slide[plain]'))

// 7. Only the selected theme imported.
variant('only the selected theme imported', (text) => text
  .replace(/#import themes\.default: \*\n/, '')
  .replace(/#import themes\.simple: \*\n/, '')
  .replace(/#import themes\.metropolis: \*\n/, '')
  .replace(/#import themes\.dewdrop: \*\n/, '')
  .replace(/#import themes\.university: \*\n/, '')
  .replace(/#import themes\.aqua: \*\n/, '')
  .replace(/#import themes\.stargazer: \*\n/, '#import themes.simple: *\n'))

console.log('')
console.log('=== the same variants applied to the original template ===')
// Applying them to the repo template tells whether the fix belongs in the template.
const TEMPLATE = path.join(PACKAGE_ROOT, 'templates', 'deck.typ')
const original = fs.readFileSync(TEMPLATE, 'utf8')
console.log(`  template length: ${original.length}`)
const themeImports = [...original.matchAll(/^#import themes\.(\w+): \*/gm)].map((m) => m[1])
console.log(`  theme imports in the template: ${themeImports.join(', ')}`)
