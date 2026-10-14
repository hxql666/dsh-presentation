// Establish whether each Touying theme works on its own, before blaming our usage.
//
// Our `deck.typ` glob-imports all seven themes, and a glob import across themes
// risks a name collision — several themes export helper names in common. This
// compiles each theme in a document that imports ONLY that theme, with the same
// show-rule shape the plugin uses. A theme that fails here fails on its own; a
// theme that passes here but fails in the plugin means the collision is ours.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'theme-isolation')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const THEMES = ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']

/** The show-rule shape the plugin uses, with one theme imported. */
function document(theme) {
  return `#import "@preview/touying:0.8.0": *
#import themes.${theme}: *

#show: ${theme}-theme.with(
  aspect-ratio: "16-9",
  align: top,
  (info: (title: "isolation")),
  (handout: false, enable-pdfpc: true, breakable: true),
)

= Section

== Slide one
Content here.
`
}

/** All themes glob-imported together, the way deck.typ does it. */
function combinedDocument() {
  return `#import "@preview/touying:0.8.0": *
${THEMES.map((t) => `#import themes.${t}: *`).join('\n')}

#show: metropolis-theme.with(
  aspect-ratio: "16-9",
  align: top,
  (info: (title: "combined")),
  (handout: false, enable-pdfpc: true, breakable: true),
)

= Section

== Slide one
Content here.
`
}

function compile(name, source) {
  const file = path.join(WORK, `${name}.typ`)
  fs.writeFileSync(file, source, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${name}.pdf`)], { encoding: 'utf8' })
  const stderr = (result.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
  return { ok: result.status === 0, errors: stderr.filter((l) => l.startsWith('error')).slice(0, 2) }
}

console.log('=== each theme alone ===')
for (const theme of THEMES) {
  const result = compile(`only-${theme}`, document(theme))
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)}${result.ok ? '' : result.errors.join(' | ').slice(0, 120)}`)
}

console.log('')
console.log('=== all seven glob-imported together, as deck.typ does ===')
{
  const result = compile('combined', combinedDocument())
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} metropolis with seven glob imports${result.ok ? '' : `\n    ${result.errors.join('\n    ')}`}`)
}

// Which names does more than one theme export? A duplicate is the mechanism by
// which a later import can silently replace an earlier one.
console.log('')
console.log('=== exported names shared by more than one theme ===')
const exports = new Map()
for (const theme of THEMES) {
  const file = path.join(VENDOR, 'preview', 'touying', '0.8.0', 'themes', `${theme}.typ`)
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/^#let\s+([a-zA-Z][\w-]*)/gm)) {
    const name = match[1]
    if (!exports.has(name)) exports.set(name, [])
    exports.get(name).push(theme)
  }
}
const shared = [...exports].filter(([, themes]) => themes.length > 1)
if (shared.length === 0) console.log('  (none)')
for (const [name, themes] of shared) {
  console.log(`  ${name.padEnd(26)} ${themes.join(', ')}`)
}
