// Does the heading mechanism work for themes whose `slide` has no `title:`?
//
// Four themes accept `title:` on `slide` and four do not, so passing it works on
// some and aborts the compile on others. Touying's theme-agnostic mechanism is a
// heading: set `= The title`, and the theme's header picks it up through
// `display-current-heading`. This checks that mechanism on a theme that lacks the
// parameter, and on two that have it, before the template is rewritten around it.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PACKAGE_ROOT = 'E:\\dsh_work\\dsh-presentation-repo\\packages\\dsh-presentation'
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'heading')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

function compile(name, source) {
  const file = path.join(WORK, `${name}.typ`)
  fs.writeFileSync(file, source, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${name}.pdf`)], { encoding: 'utf8' })
  const error = (result.stderr ?? '').split('\n').map((l) => l.trim()).find((l) => l.includes('error'))
  return { ok: result.status === 0, error: error ?? '' }
}

const THEMES = ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']

console.log('=== A: heading before the slide (theme-agnostic) ===')
for (const theme of THEMES) {
  const source = `#import "@preview/touying:0.8.0": *
#import themes.${theme}: ${theme}-theme

#show: ${theme}-theme.with(aspect-ratio: "16-9", (info: (title: "T")))

= Section

== 页面标题

#slide[
  正文
]
`
  const result = compile(`heading-${theme}`, source)
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)}${result.ok ? '' : `  ${result.error.slice(0, 100)}`}`)
}

console.log('')
console.log('=== B: inside the slide, as the template does it ===')
for (const theme of THEMES) {
  const source = `#import "@preview/touying:0.8.0": *
#import themes.${theme}: ${theme}-theme

#show: ${theme}-theme.with(aspect-ratio: "16-9", (info: (title: "T")))

= Section

#slide[
  == 页面标题

  正文
]
`
  const result = compile(`inside-${theme}`, source)
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)}${result.ok ? '' : `  ${result.error.slice(0, 100)}`}`)
}

console.log('')
console.log('=== C: the current form, passing title: ===')
for (const theme of THEMES) {
  const source = `#import "@preview/touying:0.8.0": *
#import themes.${theme}: ${theme}-theme

#show: ${theme}-theme.with(aspect-ratio: "16-9", (info: (title: "T")))

= Section

#slide(title: "页面标题")[
  正文
]
`
  const result = compile(`passing-${theme}`, source)
  console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${theme.padEnd(12)}${result.ok ? '' : `  ${result.error.slice(0, 100)}`}`)
}
