// The decisive experiment: import all seven themes as the plugin does, then call
// each one.
//
// Each theme compiles alone, and a document that imports all seven but calls only
// metropolis also compiles. So the failure appears only when a theme is both
// imported alongside the others AND called — which means either the name resolves
// to the wrong function, or a name the theme relies on has been replaced by
// another theme's export.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'theme-call')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const THEMES = ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']
const IMPORTS = THEMES.map((t) => `#import themes.${t}: *`).join('\n')

function compile(name, source) {
  const file = path.join(WORK, `${name}.typ`)
  fs.writeFileSync(file, source, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${name}.pdf`)], { encoding: 'utf8' })
  const errors = (result.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('error'))
  return { ok: result.status === 0, errors: errors.slice(0, 2) }
}

/** Same shape as the plugin's show rule, with all themes imported. */
function callTheme(theme) {
  return `#import "@preview/touying:0.8.0": *
${IMPORTS}

#show: ${theme}-theme.with(
  aspect-ratio: "16-9",
  align: top,
  (info: (title: "call test")),
  (handout: false, enable-pdfpc: true, breakable: true),
)

= Section

== Slide one
Content here.
`
}

console.log('=== all seven imported, then each theme called ===')
for (const theme of THEMES) {
  const result = compile(`call-${theme}`, callTheme(theme))
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)}${result.ok ? '' : result.errors.join(' | ').slice(0, 130)}`)
}

// Does the name resolve to the theme's own function? Comparing functions is not
// possible across bindings, but a name that resolves to another theme's function
// can be detected by calling both and comparing the error, so instead this checks
// whether the *only* difference is the import set.
console.log('')
console.log('=== same call, but importing only that theme ===')
for (const theme of THEMES) {
  const source = `#import "@preview/touying:0.8.0": *
#import themes.${theme}: *

#show: ${theme}-theme.with(
  aspect-ratio: "16-9",
  align: top,
  (info: (title: "call test")),
  (handout: false, enable-pdfpc: true, breakable: true),
)

= Section

== Slide one
Content here.
`
  const result = compile(`only-${theme}`, source)
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)}${result.ok ? '' : result.errors.join(' | ').slice(0, 130)}`)
}

// Which single names does each theme define, and is any of them defined by more
// than one theme with a different meaning? `align` itself is the prime suspect:
// a theme that exports `align` would shadow the builtin for every other theme.
console.log('')
console.log('=== names each theme defines that could shadow a builtin or a shared helper ===')
const suspects = ['align', 'utils', 'components', 'config', 'setting', 'theme', 'touying-slide', 'slide', 'text', 'grid', 'stack', 'block', 'place', 'pad']
for (const theme of THEMES) {
  const file = path.join(VENDOR, 'preview', 'touying', '0.8.0', 'themes', `${theme}.typ`)
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  const defined = new Set([...text.matchAll(/^#let\s+([a-zA-Z][\w-]*)/gm)].map((m) => m[1]))
  const hits = suspects.filter((name) => defined.has(name))
  if (hits.length > 0) console.log(`  ${theme.padEnd(12)} defines: ${hits.join(', ')}`)
}
